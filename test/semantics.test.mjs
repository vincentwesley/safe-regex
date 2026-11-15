// Hand-picked edge cases of JavaScript regex semantics, each compared with the host RegExp.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SafeRegExp } from '../dist/esm/index.js';

function norm(m) {
  if (m === null) return null;
  return {
    arr: Array.from(m),
    index: m.index,
    groups: m.groups === undefined ? undefined : { ...m.groups },
    indices: m.indices === undefined ? undefined : Array.from(m.indices),
  };
}

const CASES = [
  // empty check and capture reset (ECMA-262 RepeatMatcher)
  ['(a*)*', '', 'b'],
  ['(a*)+', '', 'b'],
  ['(a?)?', '', ''],
  ['((a)|b)+', '', 'ab'],
  ['(?:(a)|b|)*c', '', 'abc'],
  ['(a|)*', '', 'aa'],
  ['(?:a|())*b', '', 'aab'],
  ['(a{0,2})*', '', 'aaaaa'],
  ['(?:(a)|(b))+', '', 'aba'],
  ['(a*?)*?b', '', 'aab'],
  ['(?:()|a)*', '', 'aa'],
  ['(?:a?)*?$', '', 'aa'],
  ['(|a)+', '', 'aa'],
  ['(?:(?:a*)*)+b', '', 'aaab'],
  ['((a)|())*', '', 'aa'],
  ['(a|b)*?c', '', 'abc'],
  // leftmost-first priority
  ['a|ab', '', 'ab'],
  ['(a|ab)(c|bcd)(d*)', '', 'abcd'],
  ['x{2,3}?', '', 'xxxx'],
  ['x{2,3}', '', 'xxxx'],
  ['(a+?)(a*)', '', 'aaa'],
  // assertions
  ['\\bfoo\\b', 'i', 'a FOO b'],
  ['^b', 'm', 'a\nb'],
  ['a$', 'm', 'a\r\nb'],
  ['\\B', '', 'ab'],
  ['$', '', 'abc'],
  ['^', 'g', 'abc'],
  ['\\b', 'iu', 'ſ'],
  ['\\w', 'iu', 'K'],
  ['\\W', 'iu', 'ſ'],
  // classes and escapes
  ['[^a-c]+', 'i', 'ABCdef'],
  ['[\\d-z]+', '', '1-z'],
  ['[]', '', 'a'],
  ['[^]', '', '\n'],
  ['\\cJ', '', '\n'],
  ['[\\c1]', '', '\u0011'],
  ['\\c', '', '\\c'],
  ['\\x4', '', 'x4'],
  ['\\u12', '', 'u12'],
  ['a{', '', 'a{'],
  ['a{1', '', 'a{1'],
  ['a{,2}', '', 'a{,2}'],
  [']', '', ']'],
  ['\\8', '', '8'],
  ['\\0', '', '\0'],
  ['[\\b]', '', '\b'],
  ['\\s+', '', ' ﻿ x'],
  // unicode
  ['.', 'su', '😀'],
  ['.', 's', '😀'],
  ['\\u{1F600}', 'u', 'x😀'],
  ['\\ud83d\\ude00', 'u', '😀'],
  ['\\ude00', 'u', '😀'],
  ['\\ude00', '', '😀'],
  ['[\\ud83d\\ude00]', 'u', '😀'],
  ['[😀-😂]', 'u', '😁'],
  ['^.$', 'u', '😀'],
  ['^.$', '', '😀'],
  // case folding
  ['ß', 'i', 'ẞ'],
  ['ß', 'iu', 'ẞ'],
  ['ſ', 'i', 's'],
  ['ſ', 'iu', 'S'],
  ['k', 'iu', 'K'],
  ['k', 'i', 'K'],
  ['σ', 'i', 'ς'],
  ['σ', 'iu', 'Σ'],
  ['İ', 'i', 'i'],
  ['ı', 'iu', 'I'],
  ['\u{10428}', 'iu', '\u{10400}'],
  ['[a-z]', 'i', 'K'],
  ['[^k]', 'iu', 'K'],
  ['ǅ', 'i', 'ǆ'],
  ['µ', 'iu', 'Μ'],
  // named groups and indices
  ['(?<y>\\d{4})-(?<m>\\d\\d)', 'd', 'on 2024-05-01'],
  ['(?<a>x)|(?<b>y)', 'd', 'y'],
  ['(\\d+)-(?<y>\\w+)', 'd', 'x 12-ab!'],
  // flags interplay
  ['a.c', 's', 'a\nc'],
  ['a.c', '', 'a\nc'],
  ['a', 'y', 'ba'],
];

for (const [p, f, s] of CASES) {
  test(`/${p}/${f} on ${JSON.stringify(s)}`, () => {
    assert.deepEqual(norm(new SafeRegExp(p, f).exec(s)), norm(new RegExp(p, f).exec(s)));
  });
}

test('global iteration and lastIndex match native', () => {
  for (const [p, f, s] of [['a*', 'g', 'baaac'], ['', 'gu', '😀x'], ['\\b', 'g', 'ab cd'], ['(?:)', 'y', 'ab']]) {
    const a = new RegExp(p, f);
    const b = new SafeRegExp(p, f);
    for (let k = 0; k < 6; k++) {
      assert.deepEqual(norm(b.exec(s)), norm(a.exec(s)));
      assert.equal(b.lastIndex, a.lastIndex);
    }
  }
});

test('lastIndex inside a surrogate pair is moved back to the pair start (u flag)', () => {
  const re = new SafeRegExp('.', 'gu');
  re.lastIndex = 1;
  const m = re.exec('😀x');
  assert.equal(m.index, 0);
  assert.equal(m[0], '😀');
  assert.equal(re.lastIndex, 2);
});
