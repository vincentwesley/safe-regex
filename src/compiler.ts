/**
 * Compiles the AST to a Pike VM program.
 *
 * Instruction set (one opcode + two integer operands per instruction):
 *   CHAR c        consume the character c
 *   SET i         consume a character in sets[i]
 *   SPLIT x y     fork: try x first (higher priority), then y
 *   JMP x         continue at x
 *   SAVE s        slots[s] = current position (capture boundaries)
 *   CLEAR a b     slots[a..b) = -1 (JS resets captures at the start of each loop iteration)
 *   LOOPSET r     slots[r] = current position (start of a loop iteration)
 *   LOOPCHECK r   kill the thread if slots[r] == current position (JS empty-check)
 *   ASSERT k      zero-width assertion (^ $ \b \B)
 *   MATCH         success
 */
import type { Flags, Node, ParsedPattern } from './ast.js';
import { type CharSet, SetMatcher, normalize } from './charset.js';
import { SafeRegexLimitError } from './errors.js';

export const Op = {
  CHAR: 0,
  SET: 1,
  SPLIT: 2,
  JMP: 3,
  SAVE: 4,
  CLEAR: 5,
  LOOPSET: 6,
  LOOPCHECK: 7,
  ASSERT: 8,
  MATCH: 9,
} as const;
export type Op = (typeof Op)[keyof typeof Op];

export const OP_NAMES = ['CHAR', 'SET', 'SPLIT', 'JMP', 'SAVE', 'CLEAR', 'LOOPSET', 'LOOPCHECK', 'ASSERT', 'MATCH'];

export const AssertKind = {
  START: 0,
  END: 1,
  WORD_BOUNDARY: 2,
  NOT_WORD_BOUNDARY: 3,
} as const;
export type AssertKind = (typeof AssertKind)[keyof typeof AssertKind];

export interface Program {
  ops: Int32Array;
  arg1: Int32Array;
  arg2: Int32Array;
  /** Source span of the AST node that emitted each instruction ([start, end) pairs). */
  spans: Int32Array;
  sets: CharSet[];
  matchers: SetMatcher[];
  /** Number of capture groups including group 0. */
  groupCount: number;
  groupNames: (string | null)[];
  /** Total thread slots: 2 per group, then one register per empty-checked loop. */
  slotCount: number;
  /** For each pc, the empty-check loop registers enclosing it, innermost first. */
  loopStacks: Int32Array[];
  /** For each pc, offset of its first de-duplication key; pc has loopStacks[pc].length+1 keys. */
  keyOffset: Int32Array;
  keyCount: number;
  /** Set of characters that can start a match, or null if a match can start without one. */
  firstChars: SetMatcher | null;
  /** Literal string every match starts with ('' if none), used to skip ahead with indexOf. */
  literalPrefix: string;
  flags: Flags;
  source: string;
  /** For each loop register, the quantifier id (AST repeat.id) it belongs to. */
  regRepeat: number[];
}

export interface CompileOptions {
  /** Maximum number of instructions (after expanding counted repetition). Default 100 000. */
  maxProgramSize?: number;
}

const DEFAULT_MAX_PROGRAM = 100_000;

/** Can the node match the empty string? (conservative: true if any path consumes nothing) */
export function nullable(n: Node): boolean {
  switch (n.type) {
    case 'empty':
    case 'assert':
      return true;
    case 'char':
    case 'set':
      return false;
    case 'group':
      return nullable(n.body);
    case 'concat':
      return n.items.every(nullable);
    case 'alt':
      return n.alternatives.some(nullable);
    case 'repeat':
      return n.min === 0 || nullable(n.body);
  }
}

/** Range [first, last] of capture group indices inside a node, or null if none. */
function groupRange(n: Node): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  const walk = (m: Node) => {
    switch (m.type) {
      case 'group':
        if (m.index !== null) {
          lo = Math.min(lo, m.index);
          hi = Math.max(hi, m.index);
        }
        walk(m.body);
        break;
      case 'concat':
        m.items.forEach(walk);
        break;
      case 'alt':
        m.alternatives.forEach(walk);
        break;
      case 'repeat':
        walk(m.body);
        break;
    }
  };
  walk(n);
  return lo === Infinity ? null : [lo, hi];
}

class Compiler {
  private ops: number[] = [];
  private a1: number[] = [];
  private a2: number[] = [];
  private spanList: number[] = [];
  private stackIds: number[] = [];
  private readonly stacks: number[][] = [[]];
  private readonly stackKey = new Map<string, number>([['', 0]]);
  private currentStack = 0;
  private readonly sets: CharSet[] = [];
  private readonly setIndex = new Map<string, number>();
  private readonly regForRepeat = new Map<number, number>();
  private readonly regRepeat: number[] = [];
  private readonly max: number;
  private curSpan: [number, number] = [0, 0];

  constructor(private readonly parsed: ParsedPattern, opts: CompileOptions) {
    this.max = opts.maxProgramSize ?? DEFAULT_MAX_PROGRAM;
  }

  private emit(op: Op, x = 0, y = 0): number {
    const pc = this.ops.length;
    if (pc >= this.max) {
      throw new SafeRegexLimitError(
        `it compiles to more than ${this.max} instructions (counted repetitions like {n,m} are expanded); reduce the repetition counts or raise maxProgramSize`,
        this.parsed.source,
      );
    }
    this.ops.push(op);
    this.a1.push(x);
    this.a2.push(y);
    this.spanList.push(this.curSpan[0], this.curSpan[1]);
    this.stackIds.push(this.currentStack);
    return pc;
  }

  private patch(pc: number, x: number, y?: number): void {
    this.a1[pc] = x;
    if (y !== undefined) this.a2[pc] = y;
  }

  private setId(set: CharSet): number {
    const key = set.join(',');
    let id = this.setIndex.get(key);
    if (id === undefined) {
      id = this.sets.length;
      this.sets.push(set);
      this.setIndex.set(key, id);
    }
    return id;
  }

  private pushLoop(reg: number): number {
    const prev = this.currentStack;
    const stack = [reg, ...this.stacks[prev]!];
    const key = stack.join(',');
    let id = this.stackKey.get(key);
    if (id === undefined) {
      id = this.stacks.length;
      this.stacks.push(stack);
      this.stackKey.set(key, id);
    }
    this.currentStack = id;
    return prev;
  }

  compile(): Program {
    const p = this.parsed;
    const groupCount = p.groupCount + 1;
    this.slotBase = 2 * groupCount;
    this.curSpan = [0, p.source.length];
    this.emit(Op.SAVE, 0);
    this.node(p.ast);
    this.curSpan = [0, p.source.length];
    this.emit(Op.SAVE, 1);
    this.emit(Op.MATCH);

    const n = this.ops.length;
    const keyOffset = new Int32Array(n);
    const loopStacks: Int32Array[] = [];
    let k = 0;
    const stackArrays = this.stacks.map((s) => Int32Array.from(s));
    for (let pc = 0; pc < n; pc++) {
      keyOffset[pc] = k;
      const st = stackArrays[this.stackIds[pc]!]!;
      loopStacks.push(st);
      k += st.length + 1;
    }
    if (k > this.max * 8) {
      throw new SafeRegexLimitError(
        'quantifiers that can match the empty string are nested too deeply',
        p.source,
      );
    }
    const prog: Program = {
      ops: Int32Array.from(this.ops),
      arg1: Int32Array.from(this.a1),
      arg2: Int32Array.from(this.a2),
      spans: Int32Array.from(this.spanList),
      sets: this.sets,
      matchers: this.sets.map((s) => new SetMatcher(s)),
      groupCount,
      groupNames: p.groupNames,
      slotCount: this.slotBase + this.regRepeat.length,
      loopStacks,
      keyOffset,
      keyCount: k,
      firstChars: null,
      literalPrefix: '',
      flags: p.flags,
      source: p.source,
      regRepeat: this.regRepeat,
    };
    prog.firstChars = computeFirstChars(prog);
    prog.literalPrefix = computeLiteralPrefix(prog);
    return prog;
  }

  private slotBase = 0;

  private node(n: Node): void {
    const saved = this.curSpan;
    this.curSpan = [n.span.start, n.span.end];
    switch (n.type) {
      case 'empty':
        break;
      case 'char':
        this.emit(Op.CHAR, n.value);
        break;
      case 'set':
        if (n.set.length === 2 && n.set[0] === n.set[1]) this.emit(Op.CHAR, n.set[0]!);
        else this.emit(Op.SET, this.setId(n.set));
        break;
      case 'assert': {
        const kind: number =
          n.kind === 'start' ? AssertKind.START
          : n.kind === 'end' ? AssertKind.END
          : n.kind === 'word-boundary' ? AssertKind.WORD_BOUNDARY
          : AssertKind.NOT_WORD_BOUNDARY;
        this.emit(Op.ASSERT, kind);
        break;
      }
      case 'group':
        if (n.index !== null) {
          this.emit(Op.SAVE, 2 * n.index);
          this.node(n.body);
          this.curSpan = [n.span.start, n.span.end];
          this.emit(Op.SAVE, 2 * n.index + 1);
        } else {
          this.node(n.body);
        }
        break;
      case 'concat':
        for (const item of n.items) this.node(item);
        break;
      case 'alt': {
        const jumps: number[] = [];
        const alts = n.alternatives;
        for (let i = 0; i < alts.length; i++) {
          if (i < alts.length - 1) {
            this.curSpan = [n.span.start, n.span.end];
            const split = this.emit(Op.SPLIT);
            this.patch(split, split + 1);
            this.node(alts[i]!);
            this.curSpan = [n.span.start, n.span.end];
            jumps.push(this.emit(Op.JMP));
            this.patch(split, split + 1, this.ops.length);
          } else {
            this.node(alts[i]!);
          }
        }
        for (const j of jumps) this.patch(j, this.ops.length);
        break;
      }
      case 'repeat':
        this.repeat(n);
        break;
    }
    this.curSpan = saved;
  }

  private repeat(n: Extract<Node, { type: 'repeat' }>): void {
    const { min, max, greedy, body } = n;
    const span: [number, number] = [n.span.start, n.span.end];
    const groups = groupRange(body);
    const checked = nullable(body);
    let reg = -1;
    if (checked) {
      const existing = this.regForRepeat.get(n.id);
      if (existing !== undefined) reg = existing;
      else {
        reg = this.slotBase + this.regRepeat.length;
        this.regRepeat.push(n.id);
        this.regForRepeat.set(n.id, reg);
      }
    }
    const clear = () => {
      if (groups) {
        this.curSpan = span;
        this.emit(Op.CLEAR, 2 * groups[0], 2 * groups[1] + 2);
      }
    };
    // Mandatory iterations: no empty check (the spec only checks once min is satisfied).
    for (let i = 0; i < min; i++) {
      clear();
      this.node(body);
    }
    if (max === min) return;

    /** One optional iteration: [LOOPSET] CLEAR body [LOOPCHECK]. */
    const iteration = () => {
      this.curSpan = span;
      let prevStack = -1;
      if (checked) {
        this.emit(Op.LOOPSET, reg);
        prevStack = this.pushLoop(reg);
      }
      clear();
      this.node(body);
      if (checked) {
        this.curSpan = span;
        this.emit(Op.LOOPCHECK, reg);
        this.currentStack = prevStack;
      }
    };

    if (max === Infinity) {
      this.curSpan = span;
      const split = this.emit(Op.SPLIT);
      iteration();
      this.curSpan = span;
      this.emit(Op.JMP, split);
      const exit = this.ops.length;
      if (greedy) this.patch(split, split + 1, exit);
      else this.patch(split, exit, split + 1);
      return;
    }
    // Bounded: (max - min) optional iterations; declining any of them leaves the loop.
    const splits: number[] = [];
    for (let i = min; i < max; i++) {
      this.curSpan = span;
      splits.push(this.emit(Op.SPLIT));
      iteration();
    }
    const exit = this.ops.length;
    for (const s of splits) {
      if (greedy) this.patch(s, s + 1, exit);
      else this.patch(s, exit, s + 1);
    }
  }
}

/**
 * Characters that can begin a match: union of all consuming instructions reachable from pc 0
 * through epsilon edges (assertions treated as passable). null if MATCH is reachable without
 * consuming anything, or if the set is too broad to be a useful prefilter.
 */
function computeFirstChars(prog: Program): SetMatcher | null {
  const seen = new Uint8Array(prog.ops.length);
  const stack = [0];
  const parts: number[] = [];
  while (stack.length) {
    const pc = stack.pop()!;
    if (seen[pc]) continue;
    seen[pc] = 1;
    switch (prog.ops[pc]) {
      case Op.CHAR: {
        const c = prog.arg1[pc]!;
        parts.push(c, c);
        break;
      }
      case Op.SET:
        for (const v of prog.sets[prog.arg1[pc]!]!) parts.push(v);
        break;
      case Op.MATCH:
        return null;
      case Op.JMP:
        stack.push(prog.arg1[pc]!);
        break;
      case Op.SPLIT:
        stack.push(prog.arg2[pc]!, prog.arg1[pc]!);
        break;
      default:
        stack.push(pc + 1);
    }
  }
  const set = normalize(parts);
  const max = prog.flags.unicode ? 0x10ffff : 0xffff;
  // A set covering nearly everything (e.g. dot) gives no speedup.
  let covered = 0;
  for (let i = 0; i < set.length; i += 2) covered += set[i + 1]! - set[i]! + 1;
  if (covered > max * 0.9) return null;
  return new SetMatcher(set);
}

/** The literal characters every match must begin with (straight-line CHARs from the start). */
function computeLiteralPrefix(prog: Program): string {
  let out = '';
  for (let pc = 0; pc < prog.ops.length; pc++) {
    const op = prog.ops[pc];
    if (op === Op.SAVE) continue;
    if (op !== Op.CHAR) break;
    out += String.fromCodePoint(prog.arg1[pc]!);
  }
  return out;
}

export function compile(parsed: ParsedPattern, opts: CompileOptions = {}): Program {
  return new Compiler(parsed, opts).compile();
}
