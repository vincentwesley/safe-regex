/**
 * Parser for ECMAScript regular expression syntax (ES2025), including the Annex B
 * web-compatibility grammar used when the u flag is absent.
 *
 * Produces an AST in which every character test is already resolved to a CharSet with the
 * flags applied (case folding, dotAll, unicode range), so later stages never look at flags
 * except for assertions.
 */
import type { Flags, Node, ParsedPattern, Span } from './ast.js';
import {
  type CharSet,
  DIGIT,
  LINE_TERMINATOR,
  MAX_CODE_POINT,
  MAX_UNIT,
  SPACE,
  WORD,
  WORD_IU,
  negate,
  normalize,
  single,
} from './charset.js';
import { SafeRegexSyntaxError, SafeRegexUnsupportedError, type UnsupportedFeature } from './errors.js';
import { caseClose } from './unicode/case.js';

const SYNTAX_CHARS = '^$\\.*+?()[]{}|';

export function parseFlags(flags: string, pattern: string): Flags {
  const f: Flags = {
    hasIndices: false,
    global: false,
    ignoreCase: false,
    multiline: false,
    dotAll: false,
    unicode: false,
    sticky: false,
  };
  const seen = new Set<string>();
  for (const ch of flags) {
    if (seen.has(ch) || !'dgimsuyv'.includes(ch)) {
      throw new SafeRegexSyntaxError(`Invalid flags supplied to RegExp constructor '${flags}'`, pattern, -1);
    }
    seen.add(ch);
    switch (ch) {
      case 'd': f.hasIndices = true; break;
      case 'g': f.global = true; break;
      case 'i': f.ignoreCase = true; break;
      case 'm': f.multiline = true; break;
      case 's': f.dotAll = true; break;
      case 'u': f.unicode = true; break;
      case 'y': f.sticky = true; break;
      case 'v': throw new SafeRegexUnsupportedError('unicode-sets-flag', pattern, -1);
    }
  }
  return f;
}

function isHex(c: number): boolean {
  return (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);
}
function hexVal(c: number): number {
  if (c <= 0x39) return c - 0x30;
  if (c <= 0x46) return c - 0x41 + 10;
  return c - 0x61 + 10;
}
function isDigit(c: number): boolean {
  return c >= 0x30 && c <= 0x39;
}
function isAsciiLetter(c: number): boolean {
  return (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
}
function isLead(c: number): boolean {
  return c >= 0xd800 && c <= 0xdbff;
}
function isTrail(c: number): boolean {
  return c >= 0xdc00 && c <= 0xdfff;
}

/** Result of parsing one class atom: a single character or a set (from \d etc.). */
type ClassAtom = { kind: 'char'; value: number } | { kind: 'set'; set: CharSet };

/**
 * Pre-scan: counts capturing groups and detects named groups, as the spec requires the total
 * group count (for \N disambiguation) and the presence of GroupName (Annex B N parameter)
 * before parsing.
 */
function prescan(p: string): { groups: number; named: boolean } {
  let groups = 0;
  let named = false;
  let inClass = false;
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (inClass) {
      if (c === ']') inClass = false;
      continue;
    }
    if (c === '[') {
      inClass = true;
    } else if (c === '(') {
      if (p[i + 1] !== '?') groups++;
      else if (p[i + 2] === '<' && p[i + 3] !== '=' && p[i + 3] !== '!') {
        groups++;
        named = true;
      }
    }
  }
  return { groups, named };
}

class Parser {
  private pos = 0;
  private groupIndex = 0;
  private repeatId = 0;
  private readonly groupNames: (string | null)[] = [null];
  private readonly nameSet = new Set<string>();
  private readonly referencedNames: { name: string; at: number }[] = [];
  private readonly unicode: boolean;
  private readonly maxChar: number;
  private readonly namedMode: boolean;
  private readonly totalGroups: number;

  constructor(private readonly src: string, private readonly flags: Flags) {
    this.unicode = flags.unicode;
    this.maxChar = flags.unicode ? MAX_CODE_POINT : MAX_UNIT;
    const scan = prescan(src);
    this.totalGroups = scan.groups;
    this.namedMode = flags.unicode || scan.named;
  }

  // ---------- helpers ----------

  private error(message: string, at = this.pos): never {
    throw new SafeRegexSyntaxError(message, this.src, at);
  }
  private unsupported(feature: UnsupportedFeature, at: number): never {
    throw new SafeRegexUnsupportedError(feature, this.src, at);
  }
  private eof(): boolean {
    return this.pos >= this.src.length;
  }
  /** Code unit at pos (or -1). */
  private peek(offset = 0): number {
    const i = this.pos + offset;
    return i < this.src.length ? this.src.charCodeAt(i) : -1;
  }
  private peekIs(s: string): boolean {
    return this.src.startsWith(s, this.pos);
  }
  /** Reads one pattern character: a code point in unicode mode, a code unit otherwise. */
  private readSourceChar(): number {
    const c = this.src.charCodeAt(this.pos++);
    if (this.unicode && isLead(c) && this.pos < this.src.length) {
      const d = this.src.charCodeAt(this.pos);
      if (isTrail(d)) {
        this.pos++;
        return (c - 0xd800) * 0x400 + (d - 0xdc00) + 0x10000;
      }
    }
    return c;
  }
  private span(start: number): Span {
    return { start, end: this.pos };
  }

  /** Turns a literal character into a node, applying case-insensitivity. */
  private charNode(value: number, start: number): Node {
    if (this.flags.ignoreCase) {
      const set = caseClose(single(value), this.unicode);
      if (set.length > 2 || set[0] !== set[1]) return { type: 'set', set, span: this.span(start) };
    }
    return { type: 'char', value, span: this.span(start) };
  }

  /** Applies case closure (if i) to a set built from class contents. */
  private closeSet(set: CharSet): CharSet {
    return this.flags.ignoreCase ? caseClose(set, this.unicode) : set;
  }

  private wordSet(): CharSet {
    return this.flags.ignoreCase && this.unicode ? WORD_IU : WORD;
  }

  private classEscapeSet(letter: string): CharSet {
    switch (letter) {
      case 'd': return DIGIT;
      case 'D': return negate(DIGIT, this.maxChar);
      case 's': return SPACE;
      case 'S': return negate(SPACE, this.maxChar);
      case 'w': return this.wordSet();
      case 'W': return negate(this.wordSet(), this.maxChar);
    }
    throw new Error('unreachable');
  }

  // ---------- grammar ----------

  parse(): ParsedPattern {
    const ast = this.parseDisjunction();
    if (!this.eof()) {
      // Only an unmatched ')' can stop the top-level disjunction early.
      this.error("Unmatched ')'");
    }
    for (const ref of this.referencedNames) {
      if (!this.nameSet.has(ref.name)) this.error('Invalid named capture referenced', ref.at);
    }
    return {
      ast,
      groupCount: this.groupIndex,
      groupNames: this.groupNames,
      repeatCount: this.repeatId,
      flags: this.flags,
      source: this.src,
    };
  }

  private parseDisjunction(): Node {
    const start = this.pos;
    const alts: Node[] = [this.parseAlternative()];
    while (this.peek() === 0x7c /* | */) {
      this.pos++;
      alts.push(this.parseAlternative());
    }
    if (alts.length === 1) return alts[0]!;
    return { type: 'alt', alternatives: alts, span: this.span(start) };
  }

  private parseAlternative(): Node {
    const start = this.pos;
    const items: Node[] = [];
    while (!this.eof()) {
      const c = this.peek();
      if (c === 0x7c /* | */ || c === 0x29 /* ) */) break;
      items.push(this.parseTerm());
    }
    if (items.length === 0) return { type: 'empty', span: this.span(start) };
    if (items.length === 1) return items[0]!;
    return { type: 'concat', items, span: this.span(start) };
  }

  private parseTerm(): Node {
    const start = this.pos;
    const c = this.peek();

    // Assertions (not quantifiable).
    if (c === 0x5e /* ^ */ || c === 0x24 /* $ */ || this.peekIs('\\b') || this.peekIs('\\B')) {
      let kind: 'start' | 'end' | 'word-boundary' | 'not-word-boundary';
      if (c === 0x5e) { kind = 'start'; this.pos++; }
      else if (c === 0x24) { kind = 'end'; this.pos++; }
      else { kind = this.src[this.pos + 1] === 'b' ? 'word-boundary' : 'not-word-boundary'; this.pos += 2; }
      const node: Node = { type: 'assert', kind, span: this.span(start) };
      if (this.atQuantifier()) this.error('Nothing to repeat');
      return node;
    }
    if (this.peekIs('(?=') || this.peekIs('(?!')) this.unsupported('lookahead', start);
    if (this.peekIs('(?<=') || this.peekIs('(?<!')) this.unsupported('lookbehind', start);

    const atom = this.parseAtom();
    return this.parseQuantifier(atom, start);
  }

  /** True if a quantifier starts at pos (used to reject quantified assertions / empty atoms). */
  private atQuantifier(): boolean {
    const c = this.peek();
    if (c === 0x2a || c === 0x2b || c === 0x3f) return true;
    if (c === 0x7b /* { */) {
      const save = this.pos;
      const q = this.tryBraceQuantifier();
      this.pos = save;
      return q !== null;
    }
    return false;
  }

  /** Parses {n}, {n,}, {n,m} at pos. Returns null (pos unchanged) if not a valid quantifier. */
  private tryBraceQuantifier(): { min: number; max: number } | null {
    const save = this.pos;
    if (this.peek() !== 0x7b) return null;
    this.pos++;
    const min = this.readDecimal();
    if (min === null) { this.pos = save; return null; }
    let max = min;
    if (this.peek() === 0x2c /* , */) {
      this.pos++;
      const m = this.readDecimal();
      max = m === null ? Infinity : m;
    }
    if (this.peek() !== 0x7d /* } */) { this.pos = save; return null; }
    this.pos++;
    return { min, max };
  }

  private readDecimal(): number | null {
    const s = this.pos;
    let v = 0;
    while (isDigit(this.peek())) {
      v = v * 10 + (this.peek() - 0x30);
      this.pos++;
    }
    return this.pos === s ? null : v;
  }

  private parseQuantifier(atom: Node, start: number): Node {
    const c = this.peek();
    let min: number;
    let max: number;
    const qStart = this.pos;
    if (c === 0x2a) { min = 0; max = Infinity; this.pos++; }
    else if (c === 0x2b) { min = 1; max = Infinity; this.pos++; }
    else if (c === 0x3f) { min = 0; max = 1; this.pos++; }
    else if (c === 0x7b) {
      const q = this.tryBraceQuantifier();
      if (!q) {
        if (this.unicode) this.error('Incomplete quantifier');
        return atom; // Annex B: '{' is a literal; parsed as the next atom.
      }
      ({ min, max } = q);
      if (min > max) this.error('numbers out of order in {} quantifier', qStart);
    } else {
      return atom;
    }
    let greedy = true;
    if (this.peek() === 0x3f) { greedy = false; this.pos++; }
    return { type: 'repeat', min, max, greedy, body: atom, span: this.span(start), id: this.repeatId++ };
  }

  private parseAtom(): Node {
    const start = this.pos;
    const c = this.peek();
    switch (c) {
      case 0x2e: { // .
        this.pos++;
        const set = this.flags.dotAll
          ? [0, this.maxChar]
          : negate(LINE_TERMINATOR, this.maxChar);
        return { type: 'set', set, span: this.span(start) };
      }
      case 0x28: return this.parseGroup();
      case 0x5b: return this.parseClass();
      case 0x5c: return this.parseAtomEscape();
      case 0x2a: case 0x2b: case 0x3f:
        this.error('Nothing to repeat');
      // falls through (unreachable)
      case 0x7b: { // {
        if (this.unicode) this.error('Nothing to repeat');
        if (this.tryBraceQuantifier()) this.error('Nothing to repeat', start);
        this.pos++;
        return this.charNode(0x7b, start);
      }
      case 0x7d: case 0x5d: // } ]
        if (this.unicode) this.error('Lone quantifier brackets');
        this.pos++;
        return this.charNode(c, start);
      default: {
        const v = this.readSourceChar();
        return this.charNode(v, start);
      }
    }
  }

  private parseGroup(): Node {
    const start = this.pos;
    this.pos++; // (
    let index: number | null = null;
    let name: string | null = null;
    if (this.peekIs('?:')) {
      this.pos += 2;
    } else if (this.peekIs('?<')) {
      this.pos += 2;
      name = this.parseGroupName();
      if (this.nameSet.has(name)) this.error('Duplicate capture group name', start);
      this.nameSet.add(name);
      index = ++this.groupIndex;
      this.groupNames[index] = name;
    } else if (this.peek() === 0x3f) {
      this.error('Invalid group');
    } else {
      index = ++this.groupIndex;
      this.groupNames[index] = null;
    }
    const body = this.parseDisjunction();
    if (this.peek() !== 0x29) this.error('Unterminated group', start);
    this.pos++;
    return { type: 'group', index, name, body, span: this.span(start) };
  }

  /** Parses `name>` after `(?<` or `\k<`. Only ASCII identifiers are supported. */
  private parseGroupName(): string {
    const start = this.pos;
    let name = '';
    while (!this.eof() && this.peek() !== 0x3e /* > */) {
      const c = this.peek();
      if (c === 0x5c || c >= 0x80) this.unsupported('group-name', start);
      const ok = c === 0x24 || c === 0x5f || isAsciiLetter(c) || (name.length > 0 && isDigit(c));
      if (!ok) this.error('Invalid capture group name', start);
      name += String.fromCharCode(c);
      this.pos++;
    }
    if (this.eof() || name.length === 0) this.error('Invalid capture group name', start);
    this.pos++; // >
    return name;
  }

  private parseAtomEscape(): Node {
    const start = this.pos;
    this.pos++; // backslash
    if (this.eof()) this.error('\\ at end of pattern');
    const c = this.peek();
    const ch = String.fromCharCode(c);

    if ('dDsSwW'.includes(ch)) {
      this.pos++;
      return { type: 'set', set: this.closeSet(this.classEscapeSet(ch)), span: this.span(start) };
    }
    if (ch === 'p' || ch === 'P') {
      if (this.unicode) this.unsupported('unicode-property', start);
      this.pos++;
      return this.charNode(c, start);
    }
    if (c >= 0x31 && c <= 0x39) {
      // DecimalEscape: backreference, or (Annex B) legacy octal / identity escape.
      const save = this.pos;
      const n = this.readDecimal()!;
      if (n <= this.totalGroups) this.unsupported('backreference', start);
      if (this.unicode) this.error('Invalid escape', start);
      this.pos = save;
      if (c >= 0x38) { // \8 \9 are identity escapes
        this.pos++;
        return this.charNode(c, start);
      }
      this.unsupported('legacy-octal', start);
    }
    if (ch === 'k') {
      if (this.namedMode) {
        this.pos++;
        if (this.peek() !== 0x3c /* < */) this.error('Invalid named reference', start);
        this.pos++;
        const name = this.parseGroupName();
        this.referencedNames.push({ name, at: start });
        // Validate the name exists (anywhere in the pattern) before reporting unsupported,
        // so an invalid pattern is still a SyntaxError.
        if (!this.nameExistsAnywhere(name)) this.error('Invalid named capture referenced', start);
        this.unsupported('named-backreference', start);
      }
      this.pos++;
      return this.charNode(c, start);
    }
    const v = this.parseCharacterEscape(false);
    if (v === -1) return this.charNode(0x5c, start); // Annex B: "\c" → literal backslash
    return this.charNode(v, start);
  }

  private nameExistsAnywhere(name: string): boolean {
    return this.src.includes(`(?<${name}>`);
  }

  /**
   * Parses a CharacterEscape after the backslash (pos at the escape letter); returns the
   * character value. Shared by atoms and classes. Returns -1 for Annex B "\c" not followed by
   * a control letter, which denotes a literal backslash (pos is left at 'c').
   */
  private parseCharacterEscape(inClass: boolean): number {
    const start = this.pos - 1;
    const c = this.peek();
    const ch = String.fromCharCode(c);
    switch (ch) {
      case 'f': this.pos++; return 0x0c;
      case 'n': this.pos++; return 0x0a;
      case 'r': this.pos++; return 0x0d;
      case 't': this.pos++; return 0x09;
      case 'v': this.pos++; return 0x0b;
      case 'c': {
        const d = this.peek(1);
        if (isAsciiLetter(d)) { this.pos += 2; return d % 32; }
        if (!this.unicode && inClass && (isDigit(d) || d === 0x5f)) { this.pos += 2; return d % 32; }
        if (this.unicode) this.error('Invalid unicode escape', start);
        return -1;
      }
      case '0': {
        if (isDigit(this.peek(1))) {
          if (this.unicode) this.error('Invalid decimal escape', start);
          this.unsupported('legacy-octal', start);
        }
        this.pos++;
        return 0;
      }
      case 'x': {
        if (isHex(this.peek(1)) && isHex(this.peek(2))) {
          const v = hexVal(this.peek(1)) * 16 + hexVal(this.peek(2));
          this.pos += 3;
          return v;
        }
        if (this.unicode) this.error('Invalid escape', start);
        this.pos++;
        return 0x78;
      }
      case 'u': {
        const v = this.tryUnicodeEscape();
        if (v >= 0) return v;
        if (this.unicode) this.error('Invalid Unicode escape', start);
        this.pos++;
        return 0x75;
      }
    }
    if (this.unicode) {
      if (SYNTAX_CHARS.includes(ch) || ch === '/') { this.pos++; return c; }
      if (inClass && ch === '-') { this.pos++; return c; }
      this.error('Invalid escape', start);
    }
    // Annex B IdentityEscape: any source character except 'c' (handled) and, in N mode, 'k'.
    if (ch === 'k' && this.namedMode) this.error('Invalid escape', start);
    return this.readSourceChar();
  }

  /** Parses `uXXXX`, `u{X...}` (u mode) and surrogate pairs (u mode). Returns -1 if invalid. */
  private tryUnicodeEscape(): number {
    const p = this.pos; // at 'u'
    if (this.unicode && this.peek(1) === 0x7b /* { */) {
      let i = 2;
      let v = 0;
      while (isHex(this.peek(i))) {
        v = v * 16 + hexVal(this.peek(i));
        if (v > MAX_CODE_POINT) return -1;
        i++;
      }
      if (i === 2 || this.peek(i) !== 0x7d) return -1;
      this.pos += i + 1;
      return v;
    }
    const hex4 = (o: number): number => {
      for (let k = 0; k < 4; k++) if (!isHex(this.peek(o + k))) return -1;
      let v = 0;
      for (let k = 0; k < 4; k++) v = v * 16 + hexVal(this.peek(o + k));
      return v;
    };
    const v = hex4(1);
    if (v < 0) return -1;
    this.pos = p + 5;
    if (this.unicode && isLead(v) && this.peek() === 0x5c && this.peek(1) === 0x75) {
      const w = hex4(2);
      if (w >= 0 && isTrail(w)) {
        this.pos += 6;
        return (v - 0xd800) * 0x400 + (w - 0xdc00) + 0x10000;
      }
    }
    return v;
  }

  // ---------- character classes ----------

  private parseClass(): Node {
    const start = this.pos;
    this.pos++; // [
    let negated = false;
    if (this.peek() === 0x5e) { negated = true; this.pos++; }
    const parts: number[] = [];
    const addAtom = (a: ClassAtom) => {
      if (a.kind === 'char') parts.push(a.value, a.value);
      else for (const v of a.set) parts.push(v);
    };
    while (true) {
      if (this.eof()) this.error('Unterminated character class', start);
      if (this.peek() === 0x5d) { this.pos++; break; }
      const atomStart = this.pos;
      const a = this.parseClassAtom();
      if (this.peek() === 0x2d /* - */ && this.peek(1) !== 0x5d && this.peek(1) !== -1) {
        this.pos++; // -
        const b = this.parseClassAtom();
        if (a.kind === 'set' || b.kind === 'set') {
          if (this.unicode) this.error('Invalid character class', atomStart);
          addAtom(a);
          parts.push(0x2d, 0x2d);
          addAtom(b);
          continue;
        }
        if (a.value > b.value) this.error('Range out of order in character class', atomStart);
        parts.push(a.value, b.value);
        continue;
      }
      addAtom(a);
    }
    let set = this.closeSet(normalize(parts));
    if (negated) set = negate(set, this.maxChar);
    return { type: 'set', set, span: this.span(start) };
  }

  private parseClassAtom(): ClassAtom {
    const start = this.pos;
    const c = this.peek();
    if (c !== 0x5c) return { kind: 'char', value: this.readSourceChar() };
    this.pos++; // backslash
    if (this.eof()) this.error('\\ at end of pattern');
    const e = this.peek();
    const ch = String.fromCharCode(e);
    if ('dDsSwW'.includes(ch)) {
      this.pos++;
      return { kind: 'set', set: this.classEscapeSet(ch) };
    }
    if (ch === 'b') { this.pos++; return { kind: 'char', value: 0x08 }; }
    if (ch === '-' && this.unicode) { this.pos++; return { kind: 'char', value: 0x2d }; }
    if (ch === 'p' || ch === 'P') {
      if (this.unicode) this.unsupported('unicode-property', start);
      this.pos++;
      return { kind: 'char', value: e };
    }
    if (e >= 0x31 && e <= 0x39) {
      if (this.unicode) this.error('Invalid class escape', start);
      if (e >= 0x38) { this.pos++; return { kind: 'char', value: e }; }
      this.unsupported('legacy-octal', start);
    }
    if (ch === 'k' && !this.namedMode) { this.pos++; return { kind: 'char', value: e }; }
    const v = this.parseCharacterEscape(true);
    if (v === -1) return { kind: 'char', value: 0x5c }; // Annex B: "\c" → literal backslash
    return { kind: 'char', value: v };
  }
}

export function parse(source: string, flags: Flags): ParsedPattern {
  return new Parser(source, flags).parse();
}
