/**
 * safe-regex: a JavaScript-compatible regular expression engine with a linear-time guarantee.
 *
 * @example
 * import { SafeRegExp } from '@vincentwesley/safe-regex';
 * const re = new SafeRegExp('^(a+)+$');
 * re.test('a'.repeat(100_000) + '!'); // false, in milliseconds
 */
export { SafeRegExp, getSubstitution } from './regexp.js';
export type { SafeRegExpExecArray, SafeRegExpIndicesArray, SafeRegExpOptions } from './regexp.js';
export {
  SafeRegexSyntaxError,
  SafeRegexUnsupportedError,
  SafeRegexLimitError,
  UNSUPPORTED_FEATURES,
} from './errors.js';
export type { UnsupportedFeature } from './errors.js';
export { checkSupport } from './support.js';
export type { SupportResult } from './support.js';
export { Op, OP_NAMES, AssertKind } from './compiler.js';
export type { Program } from './compiler.js';
export const VERSION = '1.0.0';
export { analyze, attackString } from './analyze/redos.js';
export type { RedosReport, RedosStatus, Attack, Snippet } from './analyze/redos.js';
export { buildNfa } from './analyze/nfa.js';
export type { Nfa, NfaState, NfaEdge } from './analyze/nfa.js';
