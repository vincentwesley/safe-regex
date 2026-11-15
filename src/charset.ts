/**
 * Sets of code points (or UTF-16 code units in non-unicode mode) represented as a sorted
 * array of inclusive, non-overlapping, non-adjacent ranges: [lo0, hi0, lo1, hi1, ...].
 */
export type CharSet = number[];

export const MAX_UNIT = 0xffff;
export const MAX_CODE_POINT = 0x10ffff;

export function single(c: number): CharSet {
  return [c, c];
}

export function range(lo: number, hi: number): CharSet {
  return [lo, hi];
}

/** Normalises an arbitrary list of ranges (any order, may overlap). */
export function normalize(ranges: number[]): CharSet {
  const pairs: [number, number][] = [];
  for (let i = 0; i < ranges.length; i += 2) pairs.push([ranges[i]!, ranges[i + 1]!]);
  pairs.sort((a, b) => a[0] - b[0]);
  const out: number[] = [];
  for (const [lo, hi] of pairs) {
    const n = out.length;
    if (n > 0 && lo <= out[n - 1]! + 1) {
      if (hi > out[n - 1]!) out[n - 1] = hi;
    } else {
      out.push(lo, hi);
    }
  }
  return out;
}

export function union(...sets: CharSet[]): CharSet {
  const all: number[] = [];
  for (const s of sets) for (const v of s) all.push(v);
  return normalize(all);
}

export function negate(set: CharSet, max: number): CharSet {
  const out: number[] = [];
  let next = 0;
  for (let i = 0; i < set.length; i += 2) {
    const lo = set[i]!;
    const hi = set[i + 1]!;
    if (lo > max) break;
    if (lo > next) out.push(next, lo - 1);
    next = hi + 1;
  }
  if (next <= max) out.push(next, max);
  return out;
}

export function intersect(a: CharSet, b: CharSet): CharSet {
  const out: number[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const lo = Math.max(a[i]!, b[j]!);
    const hi = Math.min(a[i + 1]!, b[j + 1]!);
    if (lo <= hi) out.push(lo, hi);
    if (a[i + 1]! < b[j + 1]!) i += 2;
    else j += 2;
  }
  return out;
}

export function has(set: CharSet, c: number): boolean {
  let lo = 0;
  let hi = (set.length >> 1) - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (c < set[2 * mid]!) hi = mid - 1;
    else if (c > set[2 * mid + 1]!) lo = mid + 1;
    else return true;
  }
  return false;
}

export function isEmpty(set: CharSet): boolean {
  return set.length === 0;
}

export function size(set: CharSet): number {
  let n = 0;
  for (let i = 0; i < set.length; i += 2) n += set[i + 1]! - set[i]! + 1;
  return n;
}

export function equals(a: CharSet, b: CharSet): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ---- Predefined classes (ECMAScript definitions) ----

export const DIGIT: CharSet = [0x30, 0x39];
export const WORD: CharSet = normalize([0x30, 0x39, 0x41, 0x5a, 0x5f, 0x5f, 0x61, 0x7a]);
/** WordCharacters under /iu: also U+017F (ſ) and U+212A (K), which case-fold into [a-z]. */
export const WORD_IU: CharSet = normalize([...WORD, 0x17f, 0x17f, 0x212a, 0x212a]);
/** WhiteSpace and LineTerminator code points, as used by \s. */
export const SPACE: CharSet = normalize([
  0x09, 0x0d, 0x20, 0x20, 0xa0, 0xa0, 0x1680, 0x1680, 0x2000, 0x200a, 0x2028, 0x2029, 0x202f,
  0x202f, 0x205f, 0x205f, 0x3000, 0x3000, 0xfeff, 0xfeff,
]);
export const LINE_TERMINATOR: CharSet = normalize([0x0a, 0x0a, 0x0d, 0x0d, 0x2028, 0x2029]);

/**
 * Fast membership test for a CharSet: a 256-entry table for Latin-1 plus binary search above.
 */
export class SetMatcher {
  private readonly latin = new Uint8Array(256);
  private readonly ranges: Int32Array;
  private readonly allAbove: boolean;
  constructor(readonly set: CharSet) {
    for (let i = 0; i < set.length; i += 2) {
      const lo = set[i]!;
      const hi = Math.min(set[i + 1]!, 255);
      for (let c = lo; c <= hi; c++) this.latin[c] = 1;
    }
    this.ranges = Int32Array.from(set);
    this.allAbove = false;
  }
  has(c: number): boolean {
    if (c < 256) return this.latin[c] === 1;
    if (this.allAbove) return true;
    const r = this.ranges;
    let lo = 0;
    let hi = (r.length >> 1) - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (c < r[2 * mid]!) hi = mid - 1;
      else if (c > r[2 * mid + 1]!) lo = mid + 1;
      else return true;
    }
    return false;
  }
}
