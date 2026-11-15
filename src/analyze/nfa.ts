/**
 * Epsilon-free NFA built from a compiled program, modelling what a *backtracking* engine
 * explores. Used by the ReDoS checker and by the playground's automaton drawing.
 *
 * States are the program's consuming instructions (CHAR/SET), plus a start state and, for
 * unanchored search, a "retry" state standing for the engine trying the next start position.
 * An edge p → q means: after consuming p's character, q's character can be consumed next.
 * Edges carry a multiplicity (1, or 2 meaning "two or more distinct epsilon paths"), because a
 * backtracking engine explores each distinct path separately.
 */
import { AssertKind, Op, type Program } from '../compiler.js';
import type { CharSet } from '../charset.js';

export interface NfaState {
  /** Program counter of the consuming instruction (-1 for start, -2 for retry). */
  pc: number;
  /** Characters this state consumes (empty for start). */
  set: CharSet;
  /** Pattern span of the instruction ([start, end)). */
  span: [number, number];
}

export interface NfaEdge {
  to: number;
  mult: number;
}

export interface Nfa {
  states: NfaState[];
  /** out[i] = edges from state i. */
  out: NfaEdge[][];
  /** acceptMult[i] > 0 if the match can succeed right after state i (with multiplicity). */
  acceptMult: number[];
  start: number;
  /** Index of the retry state, or -1 when the pattern is sticky. */
  retry: number;
  /** True if the epsilon-path budget ran out (results may be incomplete). */
  truncated: boolean;
}

const PATH_BUDGET = 200_000;

export function buildNfa(prog: Program, opts: { unanchoredRetry: boolean }): Nfa {
  const ops = prog.ops;
  const a1 = prog.arg1;
  const a2 = prog.arg2;
  const n = ops.length;
  const stateOf = new Int32Array(n).fill(-1);
  const states: NfaState[] = [{ pc: -1, set: [], span: [0, 0] }];
  for (let pc = 0; pc < n; pc++) {
    if (ops[pc] === Op.CHAR || ops[pc] === Op.SET) {
      stateOf[pc] = states.length;
      const set = ops[pc] === Op.CHAR ? [a1[pc]!, a1[pc]!] : prog.sets[a1[pc]!]!;
      states.push({ pc, set, span: [prog.spans[2 * pc]!, prog.spans[2 * pc + 1]!] });
    }
  }
  let retry = -1;
  if (opts.unanchoredRetry) {
    retry = states.length;
    states.push({ pc: -2, set: [0, prog.flags.unicode ? 0x10ffff : 0xffff], span: [0, 0] });
  }
  let budget = PATH_BUDGET;
  let truncated = false;
  const multiline = prog.flags.multiline;

  /** All epsilon paths from `pc0`; returns target state → multiplicity, and accept multiplicity. */
  const closure = (pc0: number, atStart: boolean) => {
    const targets = new Map<number, number>();
    let accept = 0;
    // Size of the entered-loop set when pc was last visited on the current path (-1 = not on
    // it). Revisiting a pc is only useful after entering a new loop iteration; otherwise it is
    // an epsilon cycle, which JS's empty check prunes.
    const onPath = new Int32Array(n).fill(-1);
    const entered = new Set<number>();
    const walk = (pc: number, afterEnd: boolean): void => {
      if (--budget < 0) {
        truncated = true;
        return;
      }
      if (onPath[pc]! >= entered.size) return;
      const op = ops[pc];
      if (op === Op.CHAR || op === Op.SET) {
        if (afterEnd) return; // `$` (non-multiline) can only be followed by the end of input
        const s = stateOf[pc]!;
        targets.set(s, Math.min(2, (targets.get(s) ?? 0) + 1));
        return;
      }
      if (op === Op.MATCH) {
        accept = Math.min(2, accept + 1);
        return;
      }
      const savedOnPath = onPath[pc]!;
      onPath[pc] = entered.size;
      switch (op) {
        case Op.JMP:
          walk(a1[pc]!, afterEnd);
          break;
        case Op.SPLIT:
          walk(a1[pc]!, afterEnd);
          walk(a2[pc]!, afterEnd);
          break;
        case Op.LOOPSET: {
          const r = a1[pc]!;
          const had = entered.has(r);
          entered.add(r);
          walk(pc + 1, afterEnd);
          if (!had) entered.delete(r);
          break;
        }
        case Op.LOOPCHECK:
          // An iteration that started on this epsilon path consumed nothing: JS rejects it.
          if (!entered.has(a1[pc]!)) walk(pc + 1, afterEnd);
          break;
        case Op.ASSERT: {
          const k = a1[pc]!;
          if (k === AssertKind.START && !multiline && !atStart) break;
          walk(pc + 1, afterEnd || (k === AssertKind.END && !multiline));
          break;
        }
        default: // SAVE, CLEAR
          walk(pc + 1, afterEnd);
      }
      onPath[pc] = savedOnPath;
    };
    walk(pc0, false);
    return { targets, accept };
  };

  const out: NfaEdge[][] = states.map(() => []);
  const acceptMult = states.map(() => 0);
  const addEdges = (from: number, c: { targets: Map<number, number>; accept: number }) => {
    for (const [to, mult] of c.targets) {
      const existing = out[from]!.find((e) => e.to === to);
      if (existing) existing.mult = Math.min(2, existing.mult + mult);
      else out[from]!.push({ to, mult });
    }
    acceptMult[from] = Math.min(2, acceptMult[from]! + c.accept);
  };
  addEdges(0, closure(0, true));
  for (let s = 1; s < states.length; s++) {
    if (s === retry) continue;
    addEdges(s, closure(states[s]!.pc + 1, false));
  }
  if (retry >= 0) {
    // The engine moves on to the next start position: modelled as consuming any character.
    out[0]!.push({ to: retry, mult: 1 });
    out[retry]!.push({ to: retry, mult: 1 });
    addEdges(retry, closure(0, false));
  }
  return { states, out, acceptMult, start: 0, retry, truncated };
}
