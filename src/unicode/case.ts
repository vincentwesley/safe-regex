/**
 * Case canonicalisation exactly as ECMAScript's Canonicalize(rer, ch) defines it.
 *
 *  - unicode (u) + ignoreCase: simple case folding from CaseFolding.txt (status C and S).
 *  - non-unicode + ignoreCase: toUpperCase of the single code unit, unless the result is not a
 *    single code unit, or it would map a non-ASCII character to an ASCII one.
 *
 * The non-unicode table is computed from the host's String.prototype.toUpperCase, so it
 * always agrees with the host's own Unicode data. Neither path uses a regular expression.
 */
import { CASEFOLD_DELTAS } from './casefold-data.js';
import { type CharSet, has, normalize } from '../charset.js';

let nonUnicodeTable: Uint16Array | undefined;

function nonUnicodeCanon(): Uint16Array {
  if (nonUnicodeTable) return nonUnicodeTable;
  const t = new Uint16Array(0x10000);
  for (let c = 0; c < 0x10000; c++) {
    const u = String.fromCharCode(c).toUpperCase();
    if (u.length !== 1) {
      t[c] = c;
      continue;
    }
    const cu = u.charCodeAt(0);
    t[c] = c >= 128 && cu < 128 ? c : cu;
  }
  nonUnicodeTable = t;
  return t;
}

let foldMap: Map<number, number> | undefined;

function unicodeFold(): Map<number, number> {
  if (foldMap) return foldMap;
  const m = new Map<number, number>();
  let cp = 0;
  for (let i = 0; i < CASEFOLD_DELTAS.length; i += 2) {
    cp += CASEFOLD_DELTAS[i]!;
    m.set(cp, cp + CASEFOLD_DELTAS[i + 1]!);
  }
  foldMap = m;
  return m;
}

export function canonicalize(c: number, unicode: boolean): number {
  if (unicode) return unicodeFold().get(c) ?? c;
  if (c > 0xffff) return c;
  return nonUnicodeCanon()[c]!;
}

/** Equivalence classes (size >= 2) of characters with the same canonical value. */
const classesCache = new Map<boolean, number[][]>();

function equivalenceClasses(unicode: boolean): number[][] {
  const cached = classesCache.get(unicode);
  if (cached) return cached;
  const groups = new Map<number, number[]>();
  const add = (canon: number, c: number) => {
    let g = groups.get(canon);
    if (!g) groups.set(canon, (g = []));
    g.push(c);
  };
  if (unicode) {
    for (const [c, f] of unicodeFold()) add(f, c);
    for (const [canon, g] of groups) if (!g.includes(canon)) g.push(canon);
  } else {
    const t = nonUnicodeCanon();
    for (let c = 0; c < 0x10000; c++) if (t[c] !== c) add(t[c]!, c);
    for (const [canon, g] of groups) {
      // The canonical value itself belongs to the class only if it canonicalises to itself.
      if (t[canon] === canon && !g.includes(canon)) g.push(canon);
    }
  }
  const out: number[][] = [];
  for (const g of groups.values()) if (g.length > 1) out.push(g.sort((a, b) => a - b));
  classesCache.set(unicode, out);
  return out;
}

/**
 * Closes a set under case equivalence: the result contains every character whose canonical
 * form equals the canonical form of some member. Matching "Canonicalize(ch) is the canonical form
 * of some member" (the spec's CharacterSetMatcher) is then plain membership in the closed set.
 */
export function caseClose(set: CharSet, unicode: boolean): CharSet {
  if (set.length === 0) return set;
  const extra: number[] = [];
  for (const cls of equivalenceClasses(unicode)) {
    let hit = false;
    for (const c of cls) {
      if (has(set, c)) {
        hit = true;
        break;
      }
    }
    if (hit) for (const c of cls) extra.push(c, c);
  }
  if (extra.length === 0) return set;
  return normalize([...set, ...extra]);
}
