/**
 * Pike VM: simulates all threads of the program in lock-step over the input, one character at
 * a time. Threads are kept in priority order and de-duplicated by (pc, freshness), so each step
 * does O(program size) work and the whole match is O(input length × program size).
 *
 * "freshness" is the number of enclosing empty-checked loop iterations that started at the
 * current position (see docs/DECISIONS.md, D2). Two threads with the same pc and freshness have
 * identical futures, so dropping the lower-priority one is safe.
 */
import { AssertKind, Op, type Program } from './compiler.js';

const CHAR = Op.CHAR;
const SET = Op.SET;
const SPLIT = Op.SPLIT;
const JMP = Op.JMP;
const SAVE = Op.SAVE;
const CLEAR = Op.CLEAR;
const LOOPSET = Op.LOOPSET;
const LOOPCHECK = Op.LOOPCHECK;
const ASSERT = Op.ASSERT;
const MATCH = Op.MATCH;

function isLineTerminator(c: number): boolean {
  return c === 0x0a || c === 0x0d || c === 0x2028 || c === 0x2029;
}

function isWordChar(c: number, iu: boolean): boolean {
  return (
    (c >= 0x61 && c <= 0x7a) ||
    (c >= 0x41 && c <= 0x5a) ||
    (c >= 0x30 && c <= 0x39) ||
    c === 0x5f ||
    (iu && (c === 0x17f || c === 0x212a))
  );
}

class ThreadList {
  pcs: Int32Array;
  caps: Int32Array[];
  size = 0;
  constructor(capacity: number) {
    this.pcs = new Int32Array(capacity);
    this.caps = new Array<Int32Array>(capacity);
  }
}

export class PikeVM {
  private readonly visited: Int32Array;
  private gen = 0;
  private clist: ThreadList;
  private nlist: ThreadList;
  private readonly stackPc: number[] = [];
  private readonly stackCaps: Int32Array[] = [];
  private input = '';
  private readonly iu: boolean;

  constructor(private readonly prog: Program) {
    this.visited = new Int32Array(prog.keyCount);
    this.clist = new ThreadList(prog.keyCount);
    this.nlist = new ThreadList(prog.keyCount);
    this.iu = prog.flags.ignoreCase && prog.flags.unicode;
  }

  private assert(kind: number, pos: number): boolean {
    const s = this.input;
    switch (kind) {
      case AssertKind.START:
        return pos === 0 || (this.prog.flags.multiline && isLineTerminator(s.charCodeAt(pos - 1)));
      case AssertKind.END:
        return pos === s.length || (this.prog.flags.multiline && isLineTerminator(s.charCodeAt(pos)));
      default: {
        const a = pos > 0 && isWordChar(s.charCodeAt(pos - 1), this.iu);
        const b = pos < s.length && isWordChar(s.charCodeAt(pos), this.iu);
        return kind === AssertKind.WORD_BOUNDARY ? a !== b : a === b;
      }
    }
  }

  /** Adds the thread (pc, caps) and everything reachable from it by epsilon moves at pos. */
  private addThread(list: ThreadList, pc0: number, caps0: Int32Array, pos: number): void {
    const prog = this.prog;
    const ops = prog.ops;
    const arg1 = prog.arg1;
    const arg2 = prog.arg2;
    const keyOffset = prog.keyOffset;
    const loopStacks = prog.loopStacks;
    const visited = this.visited;
    const gen = this.gen;
    const sp = this.stackPc;
    const sc = this.stackCaps;
    sp.push(pc0);
    sc.push(caps0);
    while (sp.length > 0) {
      const pc = sp.pop()!;
      const caps = sc.pop()!;
      // De-duplication key: (pc, freshness).
      let key = keyOffset[pc]!;
      const st = loopStacks[pc]!;
      for (let i = 0; i < st.length; i++) {
        if (caps[st[i]!] === pos) key++;
        else break;
      }
      if (visited[key] === gen) continue;
      visited[key] = gen;
      switch (ops[pc]) {
        case JMP:
          sp.push(arg1[pc]!);
          sc.push(caps);
          break;
        case SPLIT:
          sp.push(arg2[pc]!, arg1[pc]!);
          sc.push(caps, caps);
          break;
        case SAVE:
        case LOOPSET: {
          const c = caps.slice();
          c[arg1[pc]!] = pos;
          sp.push(pc + 1);
          sc.push(c);
          break;
        }
        case CLEAR: {
          const c = caps.slice();
          c.fill(-1, arg1[pc]!, arg2[pc]!);
          sp.push(pc + 1);
          sc.push(c);
          break;
        }
        case LOOPCHECK:
          if (caps[arg1[pc]!] !== pos) {
            sp.push(pc + 1);
            sc.push(caps);
          }
          break;
        case ASSERT:
          if (this.assert(arg1[pc]!, pos)) {
            sp.push(pc + 1);
            sc.push(caps);
          }
          break;
        default: // CHAR, SET, MATCH: wait in the list for the next step
          list.pcs[list.size] = pc;
          list.caps[list.size++] = caps;
      }
    }
  }

  private nextPos(input: string, pos: number, unicode: boolean): number {
    if (unicode) {
      const c = input.charCodeAt(pos);
      if (c >= 0xd800 && c <= 0xdbff && pos + 1 < input.length) {
        const d = input.charCodeAt(pos + 1);
        if (d >= 0xdc00 && d <= 0xdfff) return pos + 2;
      }
    }
    return pos + 1;
  }

  /**
   * Finds the leftmost-first match starting the search at `start` (or exactly at `start` if
   * sticky). Returns the slot array (pairs of start/end per group, -1 for unset) or null.
   */
  exec(input: string, start: number, sticky: boolean): Int32Array | null {
    const prog = this.prog;
    const ops = prog.ops;
    const arg1 = prog.arg1;
    const matchers = prog.matchers;
    const unicode = prog.flags.unicode;
    const first = prog.firstChars;
    const len = input.length;
    this.input = input;
    let clist = this.clist;
    let nlist = this.nlist;
    clist.size = 0;
    let matched: Int32Array | null = null;
    let pos = start;
    this.gen++;
    if (this.gen > 0x3fffffff) {
      this.visited.fill(0);
      this.gen = 1;
    }

    while (true) {
      if (matched === null && (pos === start || !sticky)) {
        if (clist.size === 0 && first !== null) {
          // Nothing running: skip ahead to the next position where a match could begin.
          while (pos < len) {
            let c = input.charCodeAt(pos);
            let w = 1;
            if (unicode && c >= 0xd800 && c <= 0xdbff && pos + 1 < len) {
              const d = input.charCodeAt(pos + 1);
              if (d >= 0xdc00 && d <= 0xdfff) {
                c = (c - 0xd800) * 0x400 + (d - 0xdc00) + 0x10000;
                w = 2;
              }
            }
            if (first.has(c)) break;
            if (sticky) return null;
            pos += w;
          }
          if (pos >= len) return null;
        }
        if (clist.size === 0) this.gen++; // fresh visited marks for a fresh start position
        const caps0 = new Int32Array(prog.slotCount).fill(-1);
        this.addThread(clist, 0, caps0, pos);
      }
      if (clist.size === 0) {
        // No live threads: done if we already matched, are sticky, or ran out of input;
        // otherwise try the next start position.
        if (matched !== null || sticky || pos >= len) break;
        pos = this.nextPos(input, pos, unicode);
        continue;
      }

      let c = -1;
      let w = 1;
      if (pos < len) {
        c = input.charCodeAt(pos);
        if (unicode && c >= 0xd800 && c <= 0xdbff && pos + 1 < len) {
          const d = input.charCodeAt(pos + 1);
          if (d >= 0xdc00 && d <= 0xdfff) {
            c = (c - 0xd800) * 0x400 + (d - 0xdc00) + 0x10000;
            w = 2;
          }
        }
      }
      this.gen++;
      nlist.size = 0;
      const next = pos + w;
      for (let i = 0; i < clist.size; i++) {
        const pc = clist.pcs[i]!;
        const op = ops[pc];
        if (op === MATCH) {
          matched = clist.caps[i]!;
          break; // lower-priority threads are cut off
        }
        if (c < 0) continue;
        if (op === CHAR ? arg1[pc] === c : op === SET && matchers[arg1[pc]!]!.has(c)) {
          this.addThread(nlist, pc + 1, clist.caps[i]!, next);
        }
      }
      const t = clist;
      clist = nlist;
      nlist = t;
      if (pos >= len) break;
      pos = next;
    }
    // Drop references so large inputs/caps can be collected.
    this.input = '';
    this.clist.caps.fill(undefined as unknown as Int32Array, 0, this.clist.size);
    this.nlist.caps.fill(undefined as unknown as Int32Array, 0, this.nlist.size);
    return matched;
  }
}
