import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SafeRegExp, SafeRegexSyntaxError, SafeRegexUnsupportedError, SafeRegexLimitError, UNSUPPORTED_FEATURES } from '../dist/esm/index.js';

const UNSUPPORTED = [
  ['(a)\\1', '', 'backreference'],
  ['(?<x>a)\\k<x>', '', 'named-backreference'],
  ['(?<x>a)\\k<x>', 'u', 'named-backreference'],
  ['(?=a)', '', 'lookahead'],
  ['(?!a)', '', 'lookahead'],
  ['(?<=a)b', '', 'lookbehind'],
  ['(?<!a)b', '', 'lookbehind'],
  ['\\p{L}', 'u', 'unicode-property'],
  ['[\\P{L}]', 'u', 'unicode-property'],
  ['a', 'v', 'unicode-sets-flag'],
  ['\\01', '', 'legacy-octal'],
  ['\\7', '', 'legacy-octal'],
  ['[\\1]', '', 'legacy-octal'],
  ['(?<é>a)', '', 'group-name'],
];

for (const [p, f, feature] of UNSUPPORTED) {
  test(`unsupported: /${p}/${f} → ${feature}`, () => {
    // Every one of these is valid JavaScript ...
    assert.doesNotThrow(() => new RegExp(p, f));
    // ... and rejected here with a clear reason.
    assert.throws(() => new SafeRegExp(p, f), (e) => {
      assert.ok(e instanceof SafeRegexUnsupportedError);
      assert.ok(e instanceof SyntaxError);
      assert.equal(e.feature, feature);
      assert.match(e.message, /not supported/);
      assert.ok(e.message.includes(UNSUPPORTED_FEATURES[feature]));
      return true;
    });
  });
}

const INVALID = [
  ['(', ''], [')', ''], ['[a', ''], ['a**', ''], ['*', ''], ['a{2,1}', ''], ['{1}', ''], ['^*', ''],
  ['\\', ''], ['(?<a>x)(?<a>y)', ''], ['(?<1a>x)', ''], ['[z-a]', ''], ['(?a)', ''],
  ['\\k<nope>(?<a>x)', ''], ['a', 'gg'], ['a', 'x'], ['{', 'u'], [']', 'u'], ['\\q', 'u'],
  ['\\u{110000}', 'u'], ['[\\d-z]', 'u'], ['\\1', 'u'], ['\\c1', 'u'], ['a{', 'u'],
];

for (const [p, f] of INVALID) {
  test(`invalid: /${p}/${f} throws SyntaxError like RegExp`, () => {
    assert.throws(() => new RegExp(p, f), SyntaxError);
    assert.throws(() => new SafeRegExp(p, f), SafeRegexSyntaxError);
  });
}

test('huge counted repetition hits the size limit with a clear error', () => {
  assert.throws(() => new SafeRegExp('(?:a{1000}){1000}'), SafeRegexLimitError);
  assert.doesNotThrow(() => new SafeRegExp('a{1000}'));
  assert.throws(() => new SafeRegExp('a{100}', '', { maxProgramSize: 50 }), SafeRegexLimitError);
});
