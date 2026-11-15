import type { CharSet } from './charset.js';

/** Source span [start, end) in the pattern string, used for diagnostics and the playground. */
export interface Span {
  start: number;
  end: number;
}

export type AssertionKind = 'start' | 'end' | 'word-boundary' | 'not-word-boundary';

export type Node =
  | { type: 'empty'; span: Span }
  /** A single literal character (code unit, or code point with the u flag), case-sensitive. */
  | { type: 'char'; value: number; span: Span }
  /** A set of characters (classes, escapes like \d, dot, case-insensitive literals). */
  | { type: 'set'; set: CharSet; span: Span }
  | { type: 'assert'; kind: AssertionKind; span: Span }
  | { type: 'group'; index: number | null; name: string | null; body: Node; span: Span }
  | { type: 'alt'; alternatives: Node[]; span: Span }
  | { type: 'concat'; items: Node[]; span: Span }
  | {
      type: 'repeat';
      min: number;
      max: number;
      greedy: boolean;
      body: Node;
      span: Span;
      /** Index of this quantifier among all quantifiers in the pattern (stable id). */
      id: number;
    };

export interface Flags {
  hasIndices: boolean;
  global: boolean;
  ignoreCase: boolean;
  multiline: boolean;
  dotAll: boolean;
  unicode: boolean;
  sticky: boolean;
}

export interface ParsedPattern {
  ast: Node;
  /** Number of capturing groups, not counting group 0. */
  groupCount: number;
  /** Group names by index (null for unnamed); index 0 is the whole match. */
  groupNames: (string | null)[];
  repeatCount: number;
  flags: Flags;
  source: string;
}
