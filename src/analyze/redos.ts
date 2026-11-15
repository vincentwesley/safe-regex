/**
 * ReDoS checker: predicts whether a pattern makes a *backtracking* engine (such as the one
 * built into JavaScript) take exponential or polynomial time, explains why, and produces an
 * attack string. Method: Weideman, van der Merwe, Berglund & Watson (CIAA 2016), using NFA
 * ambiguity. See docs/DECISIONS.md D10.
 *
 *  - exponential: some state can return to itself on the same word along two different paths
 *    (an EDA cycle). Each repetition of that word doubles the number of paths.
 *  - polynomial, degree k: a chain of k-1 "IDA" pairs p ≠ q with p→p, p→q and q→q all on one
 *    word w. The engine tries every way to split a run of w's between the loops.
 *
 * The analysis is an over-approximation (assertions other than ^ and $ are ignored), so every
 * finding is checked by running the attack string through SafeRegExp to confirm the overall
 * match fails, which is what forces a backtracking engine to explore every path.
 */
import type { Node } from '../ast.js';
import { type CharSet, has, intersect, union } from '../charset.js';
import { SafeRegexLimitError, SafeRegexSyntaxError, SafeRegexUnsupportedError } from '../errors.js';
import { parse, parseFlags } from '../parser.js';
import { SafeRegExp } from '../regexp.js';
import { type Nfa, buildNfa } from './nfa.js';

export type RedosStatus = 'safe' | 'polynomial' | 'exponential' | 'too-complex' | 'unsupported' | 'invalid';

export interface Snippet {
  start: number;
  end: number;
  text: string;
}

export interface Attack {
  prefix: string;
  pump: string;
  suffix: string;
}

export interface RedosReport {
  pattern: string;
  flags: string;
  status: RedosStatus;
  /** For polynomial: estimated degree k of O(n^k). */
  degree?: number;
  /** One line, e.g. "Exponential backtracking in (a+)+". */
  summary: string;
  /** A few sentences explaining the cause in plain words. */
  explanation: string;
  /** The quantifier(s) responsible. */
  culprits: Snippet[];
  /** prefix + pump × n + suffix makes a backtracking engine slow. */
  attack?: Attack;
  /** True if SafeRegExp confirmed the attack string fails to match (forcing full backtracking). */
  validated: boolean;
}

/** Builds the attack string with the pump repeated n times. */
export function attackString(a: Attack, n: number): string {
  return a.prefix + a.pump.repeat(n) + a.suffix;
}

const NODE_BUDGET = 400_000;
const TRIPLE_BUDGET = 3_000_000;

class Budget extends Error {}

function pickChar(set: CharSet): number {
  // Prefer a readable ASCII character.
  for (const c of [0x61, 0x30, 0x41, 0x20, 0x5f, 0x2d, 0x2e]) if (has(set, c)) return c;
  for (let i = 0; i < set.length; i += 2) {
    const lo = Math.max(set[i]!, 0x21);
    if (lo <= set[i + 1]! && lo < 0x7f) return lo;
  }
  return set[0]!;
}

function repeatSpans(ast: Node): [number, number][] {
  const out: [number, number][] = [];
  const walk = (n: Node) => {
    switch (n.type) {
      case 'repeat':
        if (n.max > 1) out.push([n.span.start, n.span.end]);
        walk(n.body);
        break;
      case 'group': walk(n.body); break;
      case 'concat': n.items.forEach(walk); break;
      case 'alt': n.alternatives.forEach(walk); break;
    }
  };
  walk(ast);
  return out;
}

/** Tarjan's SCC (iterative). Returns component id per node and the components. */
function scc(count: number, succ: (v: number) => number[]): { comp: Int32Array; comps: number[][] } {
  const index = new Int32Array(count).fill(-1);
  const low = new Int32Array(count);
  const onStack = new Uint8Array(count);
  const comp = new Int32Array(count).fill(-1);
  const comps: number[][] = [];
  const stack: number[] = [];
  let idx = 0;
  for (let root = 0; root < count; root++) {
    if (index[root] !== -1) continue;
    const work: [number, number[], number][] = [[root, succ(root), 0]];
    index[root] = low[root] = idx++;
    stack.push(root);
    onStack[root] = 1;
    while (work.length) {
      const top = work[work.length - 1]!;
      const [v, ss] = top;
      if (top[2] < ss.length) {
        const w = ss[top[2]++]!;
        if (index[w] === -1) {
          index[w] = low[w] = idx++;
          stack.push(w);
          onStack[w] = 1;
          work.push([w, succ(w), 0]);
        } else if (onStack[w]) {
          low[v] = Math.min(low[v]!, index[w]!);
        }
      } else {
        work.pop();
        if (work.length) {
          const u = work[work.length - 1]![0];
          low[u] = Math.min(low[u]!, low[v]!);
        }
        if (low[v] === index[v]) {
          const c: number[] = [];
          let w: number;
          do {
            w = stack.pop()!;
            onStack[w] = 0;
            comp[w] = comps.length;
            c.push(w);
          } while (w !== v);
          comps.push(c);
        }
      }
    }
  }
  return { comp, comps };
}

export function analyze(pattern: string, flags = ''): RedosReport {
  const base = { pattern, flags, culprits: [] as Snippet[], validated: false };
  let re: SafeRegExp;
  try {
    re = new SafeRegExp(pattern, flags);
  } catch (e) {
    if (e instanceof SafeRegexUnsupportedError) {
      return { ...base, status: 'unsupported', summary: `Cannot analyse: uses ${e.feature}`, explanation: e.message };
    }
    if (e instanceof SafeRegexSyntaxError) {
      return { ...base, status: 'invalid', summary: 'Invalid regular expression', explanation: e.message };
    }
    if (e instanceof SafeRegexLimitError) {
      return { ...base, status: 'too-complex', summary: 'Pattern too large to analyse', explanation: e.message };
    }
    throw e;
  }
  const prog = re.program;
  const ast = parse(pattern, parseFlags(flags, pattern)).ast;
  const loops = repeatSpans(ast);
  const nfa = buildNfa(prog, { unanchoredRetry: !prog.flags.sticky });
  if (nfa.truncated) {
    return { ...base, status: 'too-complex', summary: 'Too complex to analyse', explanation: 'The pattern has too many alternative paths for the analysis budget. This says nothing about whether it is vulnerable; SafeRegExp still matches it in linear time.' };
  }
  try {
    return analyzeNfa(nfa, pattern, flags, loops, base);
  } catch (e) {
    if (e instanceof Budget) {
      return { ...base, status: 'too-complex', summary: 'Too complex to analyse', explanation: 'The automaton is too large for the ambiguity analysis budget. This says nothing about whether it is vulnerable; SafeRegExp still matches it in linear time.' };
    }
    throw e;
  }
}

function analyzeNfa(
  nfa: Nfa,
  pattern: string,
  flags: string,
  loops: [number, number][],
  base: { pattern: string; flags: string; culprits: Snippet[]; validated: boolean },
): RedosReport {
  const S = nfa.states.length;
  const sets = nfa.states.map((s) => s.set);
  const interMemo = new Map<number, CharSet>();
  const inter = (a: number, b: number): CharSet => {
    const k = a < b ? a * S + b : b * S + a;
    let v = interMemo.get(k);
    if (!v) interMemo.set(k, (v = intersect(sets[a]!, sets[b]!)));
    return v;
  };

  const snippetFor = (stateIds: number[]): Snippet => {
    const real = stateIds.filter((s) => s !== nfa.retry && s !== nfa.start);
    if (real.length === 0) return { start: 0, end: pattern.length, text: pattern };
    const lo = Math.min(...real.map((s) => nfa.states[s]!.span[0]));
    const hi = Math.max(...real.map((s) => nfa.states[s]!.span[1]));
    let best: [number, number] | null = null;
    for (const [a, b] of loops) {
      if (a <= lo && b >= hi && (!best || b - a < best[1] - best[0])) best = [a, b];
    }
    const [a, b] = best ?? [lo, hi];
    return { start: a, end: b, text: pattern.slice(a, b) };
  };

  // Shortest single-run path start → target (as a string).
  const prefixTo = (target: number): string => {
    if (target === nfa.start || target === nfa.retry) return '';
    const prev = new Int32Array(S).fill(-2);
    prev[nfa.start] = -1;
    const q = [nfa.start];
    while (q.length) {
      const v = q.shift()!;
      if (v === target) break;
      for (const e of nfa.out[v]!) {
        if (e.to === nfa.retry || prev[e.to] !== -2) continue;
        prev[e.to] = v;
        q.push(e.to);
      }
    }
    if (prev[target] === -2) return '';
    const chars: number[] = [];
    for (let v = target; v !== nfa.start; v = prev[v]!) chars.push(pickChar(sets[v]!));
    return String.fromCodePoint(...chars.reverse());
  };

  // ---------- exponential: pair graph ----------
  const pairId = new Map<number, number>();
  const pairs: [number, number][] = [];
  const pairSucc: { to: number; div: boolean; ch: number }[][] = [];
  const getPair = (p: number, q: number): number => {
    const k = p * S + q;
    let id = pairId.get(k);
    if (id === undefined) {
      if (pairs.length > NODE_BUDGET) throw new Budget();
      id = pairs.length;
      pairId.set(k, id);
      pairs.push([p, q]);
      pairSucc.push([]);
    }
    return id;
  };
  getPair(nfa.start, nfa.start);
  let edges = 0;
  for (let i = 0; i < pairs.length; i++) {
    const [p, q] = pairs[i]!;
    for (const e1 of nfa.out[p]!) {
      for (const e2 of nfa.out[q]!) {
        const x = inter(e1.to, e2.to);
        if (x.length === 0) continue;
        if (++edges > NODE_BUDGET * 10) throw new Budget();
        const to = getPair(e1.to, e2.to);
        pairSucc[i]!.push({ to, div: p === q && e1.to === e2.to && e1.mult >= 2, ch: pickChar(x) });
      }
    }
  }
  const P = pairs.length;
  const { comp: pcomp, comps: pcomps } = scc(P, (v) => pairSucc[v]!.map((e) => e.to));
  for (let c = 0; c < pcomps.length; c++) {
    const members = pcomps[c]!;
    const diag = members.find((v) => pairs[v]![0] === pairs[v]![1]);
    if (diag === undefined) continue;
    const offDiag = members.find((v) => pairs[v]![0] !== pairs[v]![1]);
    let divEdge: [number, number] | null = null;
    if (offDiag === undefined) {
      for (const v of members) {
        for (const e of pairSucc[v]!) if (e.div && pcomp[e.to] === c) { divEdge = [v, e.to]; break; }
        if (divEdge) break;
      }
      if (!divEdge) continue;
    }
    // Witness: cycle from diag through offDiag (or through the divergent edge) back to diag.
    const pathWithin = (from: number, to: number, firstEdge?: number): number[] | null => {
      // BFS over pair graph inside component c; returns chars.
      const prev = new Map<number, [number, number]>();
      const startNodes: number[] = [];
      if (firstEdge !== undefined) {
        const e = pairSucc[from]!.find((x) => x.to === firstEdge)!;
        prev.set(firstEdge, [from, e.ch]);
        startNodes.push(firstEdge);
        if (firstEdge === to) return [e.ch];
      } else {
        startNodes.push(from);
        prev.set(from, [-1, 0]);
      }
      const q = [...startNodes];
      while (q.length) {
        const v = q.shift()!;
        for (const e of pairSucc[v]!) {
          if (pcomp[e.to] !== c || (prev.has(e.to) && e.to !== to)) continue;
          if (e.to === to && v !== from && prev.has(to) && firstEdge === undefined) continue;
          if (!prev.has(e.to) || e.to === to) prev.set(e.to, [v, e.ch]);
          if (e.to === to) {
            const chars: number[] = [];
            let cur = to;
            let guard = 0;
            do {
              const [pv, ch] = prev.get(cur)!;
              chars.push(ch);
              cur = pv;
              if (++guard > P + 2) return null;
            } while (cur !== from && cur !== -1);
            return chars.reverse();
          }
          q.push(e.to);
        }
      }
      return null;
    };
    let pumpChars: number[] | null;
    if (offDiag !== undefined) {
      const a = pathWithin(diag, offDiag);
      const b = pathWithin(offDiag, diag);
      pumpChars = a && b ? [...a, ...b] : null;
    } else {
      const [u, w] = divEdge!;
      const a = u === diag ? [] : pathWithin(diag, u);
      const b = pathWithin(u, diag, w);
      pumpChars = a && b ? [...a, ...b] : null;
    }
    if (!pumpChars || pumpChars.length === 0) continue;
    const s = pairs[diag]![0];
    const pump = String.fromCodePoint(...pumpChars);
    const prefix = prefixTo(s);
    const cycleStates = new Set<number>();
    for (const v of members) { cycleStates.add(pairs[v]![0]); cycleStates.add(pairs[v]![1]); }
    const culprit = snippetFor([...cycleStates]);
    const found = findSuffix(pattern, flags, prefix, pump, sets);
    const shown = JSON.stringify(pump);
    return {
      ...base,
      status: 'exponential',
      summary: `Exponential backtracking in ${culprit.text}`,
      explanation:
        `${culprit.text} can match a run of ${shown} in more than one way (nested or overlapping quantifiers), ` +
        `and every extra ${shown} at least doubles the number of ways. When the rest of the pattern then fails` +
        (found.suffix ? ` (for example on ${JSON.stringify(found.suffix)})` : '') +
        `, a backtracking engine tries every one of them before giving up: time grows like 2^n.`,
      culprits: [culprit],
      attack: { prefix: found.prefix, pump, suffix: found.suffix },
      validated: found.validated,
    };
  }

  // ---------- polynomial: IDA between NFA components ----------
  const { comp, comps } = scc(S, (v) => nfa.out[v]!.map((e) => e.to));
  const cyclic = comps.map((c) => c.length > 1 || nfa.out[c[0]!]!.some((e) => e.to === c[0]));
  const reach = (from: number): Set<number> => {
    const seen = new Set<number>([from]);
    const q = [from];
    while (q.length) {
      const v = q.shift()!;
      for (const e of nfa.out[v]!) if (!seen.has(e.to)) { seen.add(e.to); q.push(e.to); }
    }
    return seen;
  };
  let tripleWork = 0;
  /** Is there w with p→p, p→q, q→q? Returns the word or null. */
  const ida = (p: number, q: number, A: number, B: number): number[] | null => {
    const key = (a: number, b: number, c: number) => (a * S + b) * S + c;
    const prev = new Map<number, [number, number]>();
    const startK = key(p, p, q);
    const goal = key(p, q, q);
    prev.set(startK, [-1, 0]);
    const queue: [number, number, number][] = [[p, p, q]];
    while (queue.length) {
      const [a, b, c] = queue.shift()!;
      for (const ea of nfa.out[a]!) {
        if (comp[ea.to] !== A) continue;
        for (const eb of nfa.out[b]!) {
          const xab = inter(ea.to, eb.to);
          if (xab.length === 0) continue;
          for (const ec of nfa.out[c]!) {
            if (comp[ec.to] !== B) continue;
            if (++tripleWork > TRIPLE_BUDGET) throw new Budget();
            const x = intersect(xab, sets[ec.to]!);
            if (x.length === 0) continue;
            const k = key(ea.to, eb.to, ec.to);
            if (prev.has(k)) continue;
            prev.set(k, [key(a, b, c), pickChar(x)]);
            if (k === goal) {
              const chars: number[] = [];
              let cur = k;
              while (cur !== startK) {
                const [pv, ch] = prev.get(cur)!;
                chars.push(ch);
                cur = pv;
              }
              return chars.reverse();
            }
            queue.push([ea.to, eb.to, ec.to]);
          }
        }
      }
    }
    return null;
  };
  // Relation between cyclic components: A ⇒ B with a witness.
  const rel = new Map<number, { to: number; p: number; q: number; word: number[] }[]>();
  for (let A = 0; A < comps.length; A++) {
    if (!cyclic[A]) continue;
    const fromA = new Set<number>();
    for (const p of comps[A]!) for (const v of reach(p)) fromA.add(comp[v]!);
    for (const B of fromA) {
      if (B === A || !cyclic[B]) continue;
      search: for (const p of comps[A]!) {
        const rp = reach(p);
        for (const q of comps[B]!) {
          if (!rp.has(q)) continue;
          const w = ida(p, q, A, B);
          if (w) {
            if (!rel.has(A)) rel.set(A, []);
            rel.get(A)!.push({ to: B, p, q, word: w });
            break search;
          }
        }
      }
    }
  }
  if (rel.size > 0) {
    // Longest chain in the (acyclic) relation = degree - 1.
    const memo = new Map<number, number>();
    const longest = (A: number): number => {
      if (memo.has(A)) return memo.get(A)!;
      let best = 0;
      for (const r of rel.get(A) ?? []) best = Math.max(best, 1 + longest(r.to));
      memo.set(A, best);
      return best;
    };
    let bestA = -1;
    let bestLen = 0;
    for (const A of rel.keys()) {
      const l = longest(A);
      if (l > bestLen || (l === bestLen && A !== comp[nfa.retry] && bestA === comp[nfa.retry])) {
        bestLen = l;
        bestA = A;
      }
    }
    const degree = bestLen + 1;
    const link = rel.get(bestA)!.reduce((x, y) => (longest(y.to) > longest(x.to) ? y : x));
    const pump = String.fromCodePoint(...link.word);
    const prefix = prefixTo(link.p);
    const fromRetry = link.p === nfa.retry;
    const cq = snippetFor(comps[comp[link.q]!]!);
    const cp = fromRetry ? null : snippetFor(comps[bestA]!);
    const found = findSuffix(pattern, flags, prefix, pump, sets, fromRetry);
    const shown = JSON.stringify(pump);
    const big = degree === 2 ? 'quadratic' : degree === 3 ? 'cubic' : `degree ${degree}`;
    const explanation = fromRetry
      ? `The pattern is not anchored, so a backtracking engine retries the match at every start position, and ${cq.text} re-reads the whole run of ${shown} from each of them before failing` +
        (found.suffix ? ` (for example at ${JSON.stringify(found.suffix)})` : '') +
        `. That is O(n^${degree}) work (${big}). Anchoring the pattern or making the repeated part unable to fail late removes it.`
      : `${cp!.text} and ${cq.text} can both match ${shown}, so for a run of n ${shown}s a backtracking engine tries every way of splitting the run between them when the rest of the pattern fails` +
        (found.suffix ? ` (for example on ${JSON.stringify(found.suffix)})` : '') +
        `. That is O(n^${degree}) work (${big}).`;
    return {
      ...base,
      status: 'polynomial',
      degree,
      summary: `Polynomial (${big}) backtracking in ${fromRetry ? cq.text : `${cp!.text} … ${cq.text}`}`,
      explanation,
      culprits: fromRetry ? [cq] : [cp!, cq],
      attack: { prefix: found.prefix, pump, suffix: found.suffix },
      validated: found.validated,
    };
  }
  return {
    ...base,
    status: 'safe',
    summary: 'No super-linear backtracking found',
    explanation: 'Every way a backtracking engine can read the input is essentially unique, so the built-in engine should run in linear time on this pattern (assertions other than ^ and $ are ignored, which can only add false alarms, never hide one).',
  };
}

/** Finds a suffix that makes prefix + pump×k + suffix fail to match, verified with SafeRegExp. */
function findSuffix(
  pattern: string,
  flags: string,
  prefix: string,
  pump: string,
  sets: CharSet[],
  tryPrefixes = false,
): { prefix: string; suffix: string; validated: boolean } {
  const plain = [...flags].filter((c) => c !== 'g' && c !== 'y' && c !== 'd').join('');
  const anywhere = new SafeRegExp(pattern, plain);
  const atStart = new SafeRegExp(pattern, plain + 'y');
  const max = flags.includes('u') ? 0x10ffff : 0xffff;
  const all = union(...sets);
  const singles = ['!', '\n', '\u0000', ' ', '=', '"', '/', 'a', '0', 'A', '_', '-', '\uffff'];
  // A character no state can consume is a sure way to make the run fail.
  for (let i = 0, next = 0; i <= all.length; i += 2) {
    const lo = i < all.length ? all[i]! : max + 1;
    if (lo > next && next >= 0x20 && next < 0x7f) { singles.unshift(String.fromCharCode(next)); break; }
    if (i < all.length) next = all[i + 1]! + 1;
  }
  const suffixes = ['', ...singles];
  for (const a of singles) for (const b of singles) suffixes.push(a + b);
  const prefixes = tryPrefixes ? [prefix, ...singles.map((c) => prefix + c)] : [prefix];
  // Best: the whole search fails, so the engine also retries every start position.
  // With the g flag (replace/split/matchAll loops), it is enough that no match starts inside the
  // pumped region: the loop then searches from every position in it.
  const global = flags.includes('g') ? new SafeRegExp(pattern, plain + 'g') : null;
  const fails = (pre: string, k: number, suf: string): boolean => {
    const str = pre + pump.repeat(k) + suf;
    if (!global) return anywhere.exec(str) === null;
    global.lastIndex = pre.length;
    const m = global.exec(str);
    return m === null || m.index >= pre.length + pump.length * k;
  };
  for (const pre of prefixes) {
    for (const suf of suffixes) {
      if (fails(pre, 16, suf) && fails(pre, 17, suf)) return { prefix: pre, suffix: suf, validated: true };
    }
  }
  // Enough for exponential blow-up: the match attempt at position 0 fails.
  for (const suf of suffixes) {
    atStart.lastIndex = 0;
    if (atStart.exec(prefix + pump.repeat(16) + suf) === null) return { prefix, suffix: suf, validated: true };
  }
  return { prefix, suffix: '!', validated: false };
}
