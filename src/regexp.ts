import type { Flags } from './ast.js';
import { type CompileOptions, type Program, compile } from './compiler.js';
import { parse, parseFlags } from './parser.js';
import { PikeVM } from './pikevm.js';

export type SafeRegExpOptions = CompileOptions;

/** Result of `SafeRegExp#exec`, shaped exactly like the built-in `RegExpExecArray`. */
export interface SafeRegExpExecArray extends Array<string | undefined> {
  0: string;
  index: number;
  input: string;
  groups: Record<string, string | undefined> | undefined;
  indices?: SafeRegExpIndicesArray;
}

export interface SafeRegExpIndicesArray extends Array<[number, number] | undefined> {
  groups: Record<string, [number, number] | undefined> | undefined;
}

const FLAG_ORDER: [keyof Flags, string][] = [
  ['hasIndices', 'd'],
  ['global', 'g'],
  ['ignoreCase', 'i'],
  ['multiline', 'm'],
  ['dotAll', 's'],
  ['unicode', 'u'],
  ['sticky', 'y'],
];

function toLength(v: unknown): number {
  const n = Math.trunc(Number(v));
  if (!(n > 0)) return 0; // also handles NaN
  return Math.min(n, Number.MAX_SAFE_INTEGER);
}

/** AdvanceStringIndex from the spec: steps over a surrogate pair in unicode mode. */
function advance(s: string, index: number, unicode: boolean): number {
  if (!unicode || index + 1 >= s.length) return index + 1;
  const c = s.charCodeAt(index);
  if (c >= 0xd800 && c <= 0xdbff) {
    const d = s.charCodeAt(index + 1);
    if (d >= 0xdc00 && d <= 0xdfff) return index + 2;
  }
  return index + 1;
}

/** EscapeRegExpPattern, mirroring V8's output (`/` outside classes and line terminators). */
function escapeSource(p: string): string {
  if (p === '') return '(?:)';
  let out = '';
  let inClass = false;
  for (let i = 0; i < p.length; i++) {
    const ch = p[i]!;
    if (ch === '\\' && i + 1 < p.length) {
      const next = p[i + 1]!;
      i++;
      out += '\\' + (next === '\n' ? 'n' : next === '\r' ? 'r' : next === ' ' ? 'u2028' : next === ' ' ? 'u2029' : next);
      continue;
    }
    if (ch === '[') inClass = true;
    else if (ch === ']') inClass = false;
    if (ch === '/' && !inClass) out += '\\/';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === ' ') out += '\\u2028';
    else if (ch === ' ') out += '\\u2029';
    else out += ch;
  }
  return out;
}

/**
 * A regular expression with the same API and the same results as the built-in `RegExp`, but
 * matched by a linear-time Pike VM, so no input can make it take more than
 * O(input length × pattern size) time.
 *
 * Throws `SafeRegexSyntaxError` for invalid patterns, `SafeRegexUnsupportedError` for valid
 * JavaScript features that cannot be matched in linear time by this engine (backreferences,
 * lookaround, ...), and `SafeRegexLimitError` for patterns that are too large.
 */
export class SafeRegExp {
  /** Position where the next search starts (used with the g and y flags), like `RegExp`. */
  lastIndex = 0;
  readonly #pattern: string;
  readonly #flags: Flags;
  readonly #flagString: string;
  readonly #program: Program;
  readonly #vm: PikeVM;
  readonly #options: SafeRegExpOptions;

  constructor(pattern?: string | RegExp | SafeRegExp, flags?: string, options: SafeRegExpOptions = {}) {
    let source: string;
    let flagStr: string;
    if (pattern instanceof SafeRegExp) {
      source = pattern.#pattern;
      flagStr = flags === undefined ? pattern.flags : String(flags);
      if (options === undefined || Object.keys(options).length === 0) options = pattern.#options;
    } else if (pattern instanceof RegExp) {
      source = pattern.source;
      flagStr = flags === undefined ? pattern.flags : String(flags);
    } else {
      source = pattern === undefined ? '' : String(pattern);
      flagStr = flags === undefined ? '' : String(flags);
    }
    this.#pattern = source;
    this.#options = options;
    this.#flags = parseFlags(flagStr, source);
    this.#flagString = FLAG_ORDER.filter(([k]) => this.#flags[k]).map(([, c]) => c).join('');
    const parsed = parse(source, this.#flags);
    this.#program = compile(parsed, options);
    this.#vm = new PikeVM(this.#program);
  }

  get source(): string { return escapeSource(this.#pattern); }
  get flags(): string { return this.#flagString; }
  get global(): boolean { return this.#flags.global; }
  get ignoreCase(): boolean { return this.#flags.ignoreCase; }
  get multiline(): boolean { return this.#flags.multiline; }
  get dotAll(): boolean { return this.#flags.dotAll; }
  get unicode(): boolean { return this.#flags.unicode; }
  get unicodeSets(): boolean { return false; }
  get sticky(): boolean { return this.#flags.sticky; }
  get hasIndices(): boolean { return this.#flags.hasIndices; }

  /** The compiled program (for tools such as the playground); treat as read-only. */
  get program(): Program { return this.#program; }

  toString(): string {
    return `/${this.source}/${this.flags}`;
  }

  /**
   * Runs the match without touching `lastIndex`: returns capture slots (start/end pairs,
   * -1 = unset) or null. `exec` is built on this.
   */
  matchAt(input: string, start: number, sticky = this.#flags.sticky): Int32Array | null {
    return this.#vm.exec(input, start, sticky);
  }

  exec(string: string): SafeRegExpExecArray | null {
    const s = String(string);
    const f = this.#flags;
    const globalOrSticky = f.global || f.sticky;
    let lastIndex = toLength(this.lastIndex);
    if (!globalOrSticky) lastIndex = 0;
    if (lastIndex > s.length) {
      if (globalOrSticky) this.lastIndex = 0;
      return null;
    }
    if (f.unicode && lastIndex > 0 && lastIndex < s.length) {
      // Never start inside a surrogate pair (matches V8, which steps back to the lead).
      const c = s.charCodeAt(lastIndex);
      const p = s.charCodeAt(lastIndex - 1);
      if (c >= 0xdc00 && c <= 0xdfff && p >= 0xd800 && p <= 0xdbff) lastIndex--;
    }
    const caps = this.#vm.exec(s, lastIndex, f.sticky);
    if (caps === null) {
      if (globalOrSticky) this.lastIndex = 0;
      return null;
    }
    if (globalOrSticky) this.lastIndex = caps[1]!;
    return this.#buildResult(s, caps);
  }

  #buildResult(s: string, caps: Int32Array): SafeRegExpExecArray {
    const prog = this.#program;
    const n = prog.groupCount;
    const arr = [] as unknown as SafeRegExpExecArray;
    for (let g = 0; g < n; g++) {
      const a = caps[2 * g]!;
      const b = caps[2 * g + 1]!;
      arr.push(a >= 0 && b >= 0 ? s.slice(a, b) : undefined);
    }
    arr.index = caps[0]!;
    arr.input = s;
    const names = prog.groupNames;
    let hasNames = false;
    for (let g = 1; g < n; g++) if (names[g]) hasNames = true;
    let groups: Record<string, string | undefined> | undefined;
    if (hasNames) {
      groups = Object.create(null) as Record<string, string | undefined>;
      for (let g = 1; g < n; g++) if (names[g]) groups[names[g]!] = arr[g];
    }
    arr.groups = groups;
    if (this.#flags.hasIndices) {
      const indices = [] as unknown as SafeRegExpIndicesArray;
      for (let g = 0; g < n; g++) {
        const a = caps[2 * g]!;
        const b = caps[2 * g + 1]!;
        indices.push(a >= 0 && b >= 0 ? [a, b] : undefined);
      }
      let ig: Record<string, [number, number] | undefined> | undefined;
      if (hasNames) {
        ig = Object.create(null) as Record<string, [number, number] | undefined>;
        for (let g = 1; g < n; g++) if (names[g]) ig[names[g]!] = indices[g];
      }
      indices.groups = ig;
      arr.indices = indices;
    }
    return arr;
  }

  test(string: string): boolean {
    return this.exec(string) !== null;
  }

  [Symbol.match](string: string): SafeRegExpExecArray | string[] | null {
    const s = String(string);
    if (!this.flags.includes('g')) return this.exec(s);
    const unicode = this.flags.includes('u');
    this.lastIndex = 0;
    const out: string[] = [];
    while (true) {
      const r = this.exec(s);
      if (r === null) return out.length === 0 ? null : out;
      out.push(r[0]);
      if (r[0] === '') this.lastIndex = advance(s, toLength(this.lastIndex), unicode);
    }
  }

  [Symbol.matchAll](string: string): IterableIterator<SafeRegExpExecArray> {
    const s = String(string);
    const flags = this.flags;
    const matcher = new SafeRegExp(this, flags);
    matcher.lastIndex = toLength(this.lastIndex);
    const global = flags.includes('g');
    const unicode = flags.includes('u');
    let done = false;
    const it: IterableIterator<SafeRegExpExecArray> = {
      next(): IteratorResult<SafeRegExpExecArray> {
        if (done) return { value: undefined, done: true };
        const m = matcher.exec(s);
        if (m === null) {
          done = true;
          return { value: undefined, done: true };
        }
        if (!global) {
          done = true;
          return { value: m, done: false };
        }
        if (m[0] === '') matcher.lastIndex = advance(s, toLength(matcher.lastIndex), unicode);
        return { value: m, done: false };
      },
      [Symbol.iterator]() {
        return it;
      },
    };
    return it;
  }

  [Symbol.search](string: string): number {
    const s = String(string);
    const previous = this.lastIndex;
    if (!Object.is(previous, 0)) this.lastIndex = 0;
    const r = this.exec(s);
    if (!Object.is(this.lastIndex, previous)) this.lastIndex = previous;
    return r === null ? -1 : r.index;
  }

  [Symbol.split](string: string, limit?: number): string[] {
    const s = String(string);
    const unicode = this.#flags.unicode;
    const out: string[] = [];
    const lim = limit === undefined ? 0xffffffff : limit >>> 0;
    if (lim === 0) return out;
    if (s.length === 0) return this.#vm.exec(s, 0, true) === null ? [s] : out;
    // The spec's @@split tries a sticky match at every position q, which costs O(n) per
    // position and O(n^2) overall even for a linear matcher. A single leftmost search from q
    // finds the first position where that sticky match would succeed, with the same match,
    // so the result is identical and the whole split stays linear.
    let p = 0;
    let q = 0;
    while (q < s.length) {
      const z = this.#vm.exec(s, q, false);
      if (z === null) break;
      const at = z[0]!;
      if (at >= s.length) break;
      const e = Math.min(z[1]!, s.length);
      if (e === p) {
        q = advance(s, at, unicode);
        continue;
      }
      out.push(s.slice(p, at));
      if (out.length === lim) return out;
      p = e;
      const n = this.#program.groupCount;
      for (let g = 1; g < n; g++) {
        const a = z[2 * g]!;
        const b = z[2 * g + 1]!;
        out.push((a >= 0 && b >= 0 ? s.slice(a, b) : undefined) as string);
        if (out.length === lim) return out;
      }
      q = p;
    }
    out.push(s.slice(p));
    return out;
  }

  [Symbol.replace](
    string: string,
    replaceValue: string | ((substring: string, ...args: any[]) => string), // eslint-disable-line @typescript-eslint/no-explicit-any
  ): string {
    const s = String(string);
    const functional = typeof replaceValue === 'function';
    const template = functional ? '' : String(replaceValue);
    const flags = this.flags;
    const global = flags.includes('g');
    const unicode = flags.includes('u');
    if (global) this.lastIndex = 0;
    const results: SafeRegExpExecArray[] = [];
    while (true) {
      const r = this.exec(s);
      if (r === null) break;
      results.push(r);
      if (!global) break;
      if (r[0] === '') this.lastIndex = advance(s, toLength(this.lastIndex), unicode);
    }
    let acc = '';
    let nextPos = 0;
    for (const r of results) {
      const matched = r[0];
      const position = Math.max(Math.min(r.index, s.length), 0);
      const captures = r.slice(1);
      const named = r.groups;
      let replacement: string;
      if (functional) {
        const args: unknown[] = [matched, ...captures, position, s];
        if (named !== undefined) args.push(named);
        replacement = String((replaceValue as (...a: unknown[]) => unknown)(...args));
      } else {
        replacement = getSubstitution(matched, s, position, captures, named, template);
      }
      if (position >= nextPos) {
        acc += s.slice(nextPos, position) + replacement;
        nextPos = position + matched.length;
      }
    }
    return nextPos >= s.length ? acc : acc + s.slice(nextPos);
  }
}

/** GetSubstitution from the spec: expands $$, $&, $`, $', $n, $nn and $<name>. */
export function getSubstitution(
  matched: string,
  str: string,
  position: number,
  captures: (string | undefined)[],
  named: Record<string, string | undefined> | undefined,
  template: string,
): string {
  let out = '';
  const m = captures.length;
  const tailPos = Math.min(position + matched.length, str.length);
  for (let i = 0; i < template.length; i++) {
    const ch = template[i]!;
    if (ch !== '$' || i + 1 >= template.length) {
      out += ch;
      continue;
    }
    const n = template[i + 1]!;
    if (n === '$') { out += '$'; i++; continue; }
    if (n === '&') { out += matched; i++; continue; }
    if (n === '`') { out += str.slice(0, position); i++; continue; }
    if (n === "'") { out += str.slice(tailPos); i++; continue; }
    if (n >= '0' && n <= '9') {
      const n2 = template[i + 2];
      let digits = 1;
      let index = n.charCodeAt(0) - 48;
      if (n2 !== undefined && n2 >= '0' && n2 <= '9') {
        const two = index * 10 + (n2.charCodeAt(0) - 48);
        if (two >= 1 && two <= m) {
          digits = 2;
          index = two;
        }
      }
      if (index >= 1 && index <= m) {
        out += captures[index - 1] ?? '';
        i += digits;
      } else {
        out += '$';
      }
      continue;
    }
    if (n === '<') {
      if (named === undefined) { out += '$'; continue; }
      const close = template.indexOf('>', i + 2);
      if (close < 0) { out += '$'; continue; }
      const name = template.slice(i + 2, close);
      const v = named[name];
      out += v === undefined ? '' : String(v);
      i = close;
      continue;
    }
    out += '$';
  }
  return out;
}
