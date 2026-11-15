/** Thrown for patterns or flags that JavaScript itself would reject. */
export class SafeRegexSyntaxError extends SyntaxError {
  /** Offset in the pattern where the problem was found (-1 for flag errors). */
  readonly offset: number;
  constructor(message: string, readonly pattern: string, offset: number) {
    super(`Invalid regular expression: /${pattern}/: ${message}`);
    this.name = 'SafeRegexSyntaxError';
    this.offset = offset;
  }
}

/** Codes for every syntax feature SafeRegExp deliberately does not support. */
export type UnsupportedFeature =
  | 'backreference'
  | 'named-backreference'
  | 'lookahead'
  | 'lookbehind'
  | 'unicode-property'
  | 'unicode-sets-flag'
  | 'legacy-octal'
  | 'group-name';

const REASONS: Record<UnsupportedFeature, string> = {
  backreference:
    'backreferences (\\1, \\2, ...) are not supported: matching with backreferences is NP-hard in general, so no algorithm can guarantee linear time for them',
  'named-backreference':
    'named backreferences (\\k<name>) are not supported: matching with backreferences is NP-hard in general, so no algorithm can guarantee linear time for them',
  lookahead:
    'lookahead assertions ((?=...), (?!...)) are not supported: they need an extra pass over the input per assertion, which this single-pass engine does not implement',
  lookbehind:
    'lookbehind assertions ((?<=...), (?<!...)) are not supported: they need a backward pass over the input per assertion, which this single-pass engine does not implement',
  'unicode-property':
    'Unicode property escapes (\\p{...}, \\P{...}) are not supported: the engine does not ship Unicode property tables',
  'unicode-sets-flag': 'the v (unicodeSets) flag is not supported',
  'legacy-octal':
    'legacy octal escapes (\\01, \\7, [\\1]) are not supported; write \\x01 or \\u0007 instead',
  'group-name': 'group names that are not plain ASCII identifiers ([A-Za-z_$][A-Za-z0-9_$]*) are not supported (non-ASCII letters and \\u escapes in names would need Unicode ID tables)',
};

/** Thrown for valid JavaScript patterns that use a feature SafeRegExp does not support. */
export class SafeRegexUnsupportedError extends SyntaxError {
  readonly feature: UnsupportedFeature;
  readonly offset: number;
  constructor(feature: UnsupportedFeature, readonly pattern: string, offset: number) {
    super(`Unsupported regular expression /${pattern}/ at offset ${offset}: ${REASONS[feature]}.`);
    this.name = 'SafeRegexUnsupportedError';
    this.feature = feature;
    this.offset = offset;
  }
}

/** All feature codes, with the explanation used in error messages. */
export const UNSUPPORTED_FEATURES: Readonly<Record<UnsupportedFeature, string>> = REASONS;

/** Thrown when a pattern would compile to a program larger than the configured limit. */
export class SafeRegexLimitError extends RangeError {
  constructor(message: string, readonly pattern: string) {
    super(`Regular expression /${pattern}/ is too large: ${message}`);
    this.name = 'SafeRegexLimitError';
  }
}
