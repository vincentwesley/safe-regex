// Shared pieces of the differential fuzzer: seeded generators and the comparison logic.
// Used by scripts/fuzz.mjs (worker pool) and by test/fuzz-smoke.test.mjs.

/** mulberry32: small, fast, seedable PRNG. */
export function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Derives an independent seed for case i (so any case can be regenerated on its own). */
export function caseSeed(seed, i) {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ i, 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

// Characters chosen to exercise case folding, word boundaries, line terminators, surrogates.
const CHAR_POOL = [
  'a', 'b', 'c', 'x', 'A', 'B', 'X', '0', '1', '9', ' ', '-', '_', '.', ',', '\n', '\r', '\t',
  ' ', 'é', 'É', 'ß', 'ẞ', 'ſ', 's', 'S', 'K', 'K', 'k', 'ı', 'i', 'I', 'İ', 'σ', 'ς', 'Σ',
  ' ', '﻿', '😀', '\ud83d', '\ude00', '\u{10400}', '\u{10428}', '/', '$', '(', ')', '[', ']',
  '{', '}', '*', '+', '?', '|', '^', '\\', 'µ', 'Μ', 'μ', 'İ', 'ǅ', 'Ǆ', 'ǆ',
];
const SYNTAX = new Set(['^', '$', '\\', '.', '*', '+', '?', '(', ')', '[', ']', '{', '}', '|', '/']);

function pick(r, arr) {
  return arr[Math.floor(r() * arr.length)];
}
function int(r, lo, hi) {
  return lo + Math.floor(r() * (hi - lo + 1));
}

function escapeLiteral(ch, inClass) {
  if (ch === '\n') return '\\n';
  if (ch === '\r') return '\\r';
  if (ch === '\t') return '\\t';
  if (inClass) return ch === ']' || ch === '\\' || ch === '-' || ch === '^' ? '\\' + ch : ch;
  return SYNTAX.has(ch) ? '\\' + ch : ch;
}

/**
 * Generates a random pattern from the grammar SafeRegExp supports.
 * The alphabet is shared with the input generator so matches are frequent.
 */
export function genPattern(r, alphabet, unicode) {
  let groups = 0;
  let names = 0;
  const lit = (inClass) => {
    const ch = pick(r, alphabet);
    // In non-unicode mode, astral characters in a pattern are two code units; fine either way,
    // but inside a class without u they'd be split — that is valid JS too, so keep it.
    const roll = r();
    const cp = ch.codePointAt(0);
    if (roll < 0.08 && cp <= 0xffff) return '\\u' + cp.toString(16).padStart(4, '0');
    if (roll < 0.12 && cp <= 0xff) return '\\x' + cp.toString(16).padStart(2, '0');
    if (roll < 0.14 && unicode) return '\\u{' + cp.toString(16) + '}';
    return escapeLiteral(ch, inClass);
  };
  const classAtom = () => {
    const roll = r();
    if (roll < 0.15) return pick(r, ['\\d', '\\w', '\\s', '\\D', '\\W', '\\S']);
    if (roll < 0.2) return '\\b';
    if (roll < 0.45) {
      const a = pick(r, alphabet);
      const b = pick(r, alphabet);
      const ca = unicode ? a.codePointAt(0) : a.charCodeAt(0);
      const cb = unicode ? b.codePointAt(0) : b.charCodeAt(0);
      const [x, y] = ca <= cb ? [a, b] : [b, a];
      if (!unicode && (x.length > 1 || y.length > 1)) return lit(true);
      return escapeLiteral(x, true) + '-' + escapeLiteral(y, true);
    }
    return lit(true);
  };
  const atom = (depth) => {
    const roll = r();
    if (roll < 0.35) return lit(false);
    if (roll < 0.45) return '.';
    if (roll < 0.55) {
      let s = '[' + (r() < 0.3 ? '^' : '');
      const n = int(r, 0, 3);
      for (let i = 0; i < n; i++) s += classAtom();
      return s + ']';
    }
    if (roll < 0.62) return pick(r, ['\\d', '\\w', '\\s', '\\D', '\\W', '\\S']);
    if (roll < 0.66 && !unicode) return pick(r, ['\\a', '\\e', '\\-', '\\z', '\\c', '\\cJ', '\\ca', ']', '{', '}', 'x{', 'x{1', '{,2}']);
    if (depth <= 0) return lit(false);
    const kind = r();
    const body = disj(depth - 1);
    if (kind < 0.5) {
      groups++;
      return '(' + body + ')';
    }
    if (kind < 0.65) {
      groups++;
      return '(?<n' + names++ + '>' + body + ')';
    }
    return '(?:' + body + ')';
  };
  const quant = () => {
    const roll = r();
    let q;
    if (roll < 0.3) q = '*';
    else if (roll < 0.5) q = '+';
    else if (roll < 0.7) q = '?';
    else if (roll < 0.8) q = '{' + int(r, 0, 3) + '}';
    else if (roll < 0.9) q = '{' + int(r, 0, 2) + ',}';
    else {
      const a = int(r, 0, 2);
      q = '{' + a + ',' + int(r, a, 4) + '}';
    }
    if (r() < 0.3) q += '?';
    return q;
  };
  const term = (depth) => {
    const roll = r();
    if (roll < 0.08) return pick(r, ['^', '$', '\\b', '\\B']);
    let a = atom(depth);
    if (r() < 0.35) {
      // Don't quantify an Annex B literal brace sequence that could form a quantifier.
      if (/[{}]$/.test(a) && !/\\[{}]$/.test(a)) return a;
      a += quant();
    }
    return a;
  };
  const alternative = (depth) => {
    const n = int(r, 0, 4);
    let s = '';
    for (let i = 0; i < n; i++) s += term(depth);
    return s;
  };
  const disj = (depth) => {
    const n = r() < 0.7 ? 1 : int(r, 2, 3);
    const parts = [];
    for (let i = 0; i < n; i++) parts.push(alternative(depth));
    return parts.join('|');
  };
  const pattern = disj(int(r, 0, 3));
  return { pattern, groups };
}

/** Random syntax soup, to compare error handling and Annex B quirks. */
export function genSoup(r) {
  const pieces = [
    'a', 'b', '(', ')', '[', ']', '{', '}', '{1}', '{2,1}', '{1,', ',', '*', '+', '?', '|', '^', '$',
    '\\', '\\c', '\\c1', '\\c_', '\\x4', '\\x41', '\\u12', '\\u0041', '\\u{41}', '\\-', '\\/', '\\k',
    '(?:', '(?<a>', '(?<1>', '(?', '-', '\\b', '\\B', '\\d', '.', '\\0', '\\8', '\\q', ']', '\\]',
  ];
  let s = '';
  const n = int(r, 1, 7);
  for (let i = 0; i < n; i++) s += pick(r, pieces);
  return s;
}

export function genFlags(r) {
  let f = '';
  for (const c of 'dgimsuy') if (r() < (c === 'g' || c === 'y' ? 0.25 : 0.3)) f += c;
  return f;
}

export function genAlphabet(r) {
  const n = int(r, 2, 5);
  const set = new Set();
  while (set.size < n) set.add(pick(r, CHAR_POOL));
  return [...set];
}

export function genInput(r, alphabet) {
  const len = int(r, 0, 16);
  let s = '';
  for (let i = 0; i < len; i++) s += r() < 0.85 ? pick(r, alphabet) : pick(r, CHAR_POOL);
  return s;
}

// ---------------- comparison ----------------

function normExec(m) {
  if (m === null) return null;
  const o = { arr: Array.from(m), index: m.index };
  o.groups = m.groups === undefined ? undefined : { ...m.groups };
  if (m.indices !== undefined) {
    o.indices = Array.from(m.indices);
    o.indicesGroups = m.indices.groups === undefined ? undefined : { ...m.indices.groups };
  }
  return o;
}

function same(a, b) {
  return JSON.stringify(a, (k, v) => (v === undefined ? '__undef__' : v)) ===
    JSON.stringify(b, (k, v) => (v === undefined ? '__undef__' : v));
}

/** Runs one operation against both engines; returns null if equal, or a description. */
function compareOp(name, fNative, fSafe) {
  let a;
  let b;
  let ea = null;
  let eb = null;
  try { a = fNative(); } catch (e) { ea = String(e && e.name); }
  try { b = fSafe(); } catch (e) { eb = String(e && e.name); }
  if (ea || eb) {
    if (ea && eb) return null;
    return { op: name, native: ea ? `throws ${ea}` : a, safe: eb ? `throws ${eb}` : b };
  }
  if (!same(a, b)) return { op: name, native: a, safe: b };
  return null;
}

/** Positions strictly inside a surrogate pair (lead at i-1, trail at i). */
function insidePair(s, i) {
  if (i <= 0 || i >= s.length) return false;
  const a = s.charCodeAt(i - 1);
  const b = s.charCodeAt(i);
  return a >= 0xd800 && a <= 0xdbff && b >= 0xdc00 && b <= 0xdfff;
}

/**
 * Spec oracle for unicode mode. V8 sometimes reports zero-width matches *between the two halves
 * of a surrogate pair* (e.g. /\B/u), which ECMA-262 rules out: with the u flag the input is a
 * sequence of code points. This oracle is RegExp-shaped and spec-conforming: its exec runs the
 * native matcher, sticky, only at code-point boundaries (RegExpBuiltinExec's search loop), and
 * replace/split/match/matchAll/search are the built-in generic algorithms from
 * RegExp.prototype, which call this exec. A mismatch where SafeRegExp agrees with the oracle is
 * reported as a V8 deviation, not as a SafeRegExp bug.
 */
export class SpecOracle {
  constructor(pattern, flags) {
    const src = pattern instanceof SpecOracle ? pattern.pattern : pattern;
    const f = flags === undefined && pattern instanceof SpecOracle ? pattern.flags : flags ?? '';
    this.pattern = src;
    this.inner = new RegExp(src, [...f].filter((c) => c !== 'g' && c !== 'y').join('') + 'y');
    this.flags = [...'dgimsuvy'].filter((c) => f.includes(c)).join('');
    this.global = f.includes('g');
    this.sticky = f.includes('y');
    this.unicode = f.includes('u');
    this.hasIndices = f.includes('d');
    this.lastIndex = 0;
  }
  static get [Symbol.species]() {
    return SpecOracle;
  }
  exec(str) {
    const s = String(str);
    const gy = this.global || this.sticky;
    let i = gy ? Math.max(0, Math.trunc(Number(this.lastIndex)) || 0) : 0;
    if (i > s.length) {
      if (gy) this.lastIndex = 0;
      return null;
    }
    if (this.unicode && insidePair(s, i)) i--;
    while (i <= s.length) {
      this.inner.lastIndex = i;
      const m = this.inner.exec(s);
      if (m) {
        if (gy) this.lastIndex = this.inner.lastIndex;
        return m;
      }
      if (this.sticky) break;
      i += this.unicode && insidePair(s, i + 1) ? 2 : 1;
    }
    if (gy) this.lastIndex = 0;
    return null;
  }
  test(s) {
    return this.exec(s) !== null;
  }
}
SpecOracle.prototype.constructor = SpecOracle;
for (const sym of [Symbol.match, Symbol.matchAll, Symbol.replace, Symbol.search, Symbol.split]) {
  SpecOracle.prototype[sym] = RegExp.prototype[sym];
}

/**
 * Compares SafeRegExp with RegExp for one pattern, flags and input. `phase` is a callback used
 * by the watchdog to know which engine is running.
 * Returns { comparisons, mismatch } where mismatch is null or details.
 */
export function compareCase(SafeRegExp, pattern, flags, input, lastIndex, phase = () => {}) {
  const ops = [];
  const mk = (C) => new C(pattern, flags);
  // exec with lastIndex
  ops.push(['exec', (C) => {
    const re = mk(C);
    re.lastIndex = lastIndex;
    const m = re.exec(input);
    return { m: normExec(m), lastIndex: re.lastIndex };
  }]);
  // exec twice in a row (global/sticky iteration state)
  if (flags.includes('g') || flags.includes('y')) {
    ops.push(['exec-twice', (C) => {
      const re = mk(C);
      const m1 = re.exec(input);
      const li = re.lastIndex;
      const m2 = re.exec(input);
      return { m1: normExec(m1), li, m2: normExec(m2), li2: re.lastIndex };
    }]);
  }
  ops.push(['replace', (C) => input.replace(mk(C), '<$&|$1|$`>')]);
  ops.push(['replace-fn', (C) => {
    const calls = [];
    const out = input.replace(mk(C), (...args) => {
      calls.push(args.map((x) => (x && typeof x === 'object' ? { ...x } : x)));
      return '#';
    });
    return { out, calls };
  }]);
  ops.push(['split', (C) => input.split(mk(C))]);
  ops.push(['search', (C) => input.search(mk(C))]);
  ops.push(['match', (C) => {
    const m = input.match(mk(C));
    return flags.includes('g') ? m : normExec(m);
  }]);
  if (flags.includes('g')) {
    ops.push(['matchAll', (C) => [...input.matchAll(mk(C))].map(normExec)]);
  }
  let comparisons = 0;
  for (const [name, f] of ops) {
    comparisons++;
    const res = compareOp(
      name,
      () => { phase(1); const v = f(RegExp); phase(0); return v; },
      () => { phase(2); const v = f(SafeRegExp); phase(0); return v; },
    );
    if (res) {
      // Is this one of V8's known unicode-mode deviations from the spec?
      if (flags.includes('u')) {
        try {
          const ref = f(SpecOracle);
          if (same(ref, res.safe)) return { comparisons, mismatch: null, v8Deviation: { op: name, pattern, flags, input, lastIndex, v8: res.native, spec: ref } };
        } catch { /* fall through: report as mismatch */ }
      }
      return { comparisons, mismatch: res };
    }
  }
  return { comparisons, mismatch: null };
}

/** Builds case i deterministically from the seed. */
export function buildCase(seed, i) {
  const r = prng(caseSeed(seed, i));
  const flags = genFlags(r);
  const unicode = flags.includes('u');
  const alphabet = genAlphabet(r);
  const soup = r() < 0.08;
  const pattern = soup ? genSoup(r) : genPattern(r, alphabet, unicode).pattern;
  const inputs = [];
  const nInputs = 4;
  for (let k = 0; k < nInputs; k++) {
    const s = genInput(r, alphabet);
    inputs.push({ input: s, lastIndex: r() < 0.7 ? 0 : int(r, 0, s.length + 1) });
  }
  return { pattern, flags, inputs, soup };
}
