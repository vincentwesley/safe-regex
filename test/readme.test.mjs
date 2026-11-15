// The examples in README.md, executed, so the documentation can't drift from the code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SafeRegExp, checkSupport, analyze, attackString, SafeRegexLimitError } from '../dist/esm/index.js';

test('intro example: catastrophic pattern is fast', () => {
  const evil = 'a'.repeat(100_000) + '!';
  const t = performance.now();
  assert.equal(new SafeRegExp('^(a+)+$').test(evil), false);
  assert.ok(performance.now() - t < 2000);
});

test('usage examples', () => {
  const date = new SafeRegExp('(?<y>\\d{4})-(?<m>\\d\\d)-(?<d>\\d\\d)', 'd');
  const m = date.exec('released 2026-11-15');
  assert.equal(m.index, 9);
  assert.equal(m.groups.y, '2026');
  assert.deepEqual(m.indices.groups.m, [14, 16]);
  assert.deepEqual('a-b_c'.split(new SafeRegExp('[-_]')), ['a', 'b', 'c']);
  assert.equal('x1y22'.replace(new SafeRegExp('(\\d+)', 'g'), '<$1>'), 'x<1>y<22>');
  assert.deepEqual([...'a1b22'.matchAll(new SafeRegExp('\\d+', 'g'))].map((x) => x[0]), ['1', '22']);
  assert.equal('2026-11'.replace(new SafeRegExp('(?<y>\\d+)-(?<m>\\d+)'), '$<m>/$<y>'), '11/2026');
  assert.equal('hello'.search(new SafeRegExp('l+')), 2);
  const word = new SafeRegExp('\\w+', 'g');
  word.exec('hi there');
  assert.equal(word.lastIndex, 2);
  assert.equal(new SafeRegExp(/^(\w+\s?)*$/i).flags, 'i');
  assert.throws(() => new SafeRegExp('(?:a{1000}){1000}'), SafeRegexLimitError);
  assert.equal(checkSupport('(a)\\1', 'i').ok, false);
});

test('checker examples', () => {
  const r = analyze('^(a|aa)+$');
  assert.equal(r.status, 'exponential');
  assert.equal(r.summary, 'Exponential backtracking in (a|aa)+');
  assert.deepEqual(r.culprits, [{ start: 1, end: 8, text: '(a|aa)+' }]);
  assert.equal(attackString(r.attack, 30), 'aaa' + 'aaaaa'.repeat(30) + '!');
  assert.equal(analyze('^[\\s\\u200c]+|[\\s\\u200c]+$').degree, 2);
  assert.equal(analyze('^\\d{3}-\\d{4}$').status, 'safe');
});

test('V8 deviation example from the README', () => {
  assert.equal(new SafeRegExp('\\B', 'u').exec('a😀').index, 3);
});
