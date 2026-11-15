import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SafeRegExp, checkSupport, VERSION } from '../dist/esm/index.js';

test('flag getters, source and toString mirror RegExp', () => {
  for (const [p, f] of [['a/b', 'gimsuyd'], ['', ''], ['[/]\n', 'g'], ['\\/x', '']]) {
    const a = new RegExp(p, f);
    const b = new SafeRegExp(p, f);
    for (const k of ['source', 'flags', 'global', 'ignoreCase', 'multiline', 'dotAll', 'unicode', 'sticky', 'hasIndices']) {
      assert.equal(b[k], a[k], k);
    }
    assert.equal(String(b), String(a));
  }
});

test('constructs from RegExp and SafeRegExp, optionally overriding flags', () => {
  const r = new SafeRegExp(/ab+/i);
  assert.equal(r.flags, 'i');
  assert.ok(r.test('ABB'));
  const r2 = new SafeRegExp(r, 'g');
  assert.equal(r2.flags, 'g');
  assert.equal(r2.test('ABB'), false);
  assert.equal(new SafeRegExp().source, '(?:)');
});

test('String.prototype methods dispatch to SafeRegExp', () => {
  const cases = [
    ['split', 'a-b_c', ['[-_]', ''], []],
    ['split', 'a1b2c', ['(\\d)', ''], []],
    ['split', 'abc', ['', ''], []],
    ['split', 'a,b,c', [',', ''], [2]],
    ['replace', 'x1y22', ['(\\d+)', 'g'], ['<$1|$&|$`|$\'|$$|$2|$01|$10>']],
    ['replace', '2024-05', ['(?<y>\\d+)-(?<m>\\d+)', ''], ['$<m>/$<y>/$<zz>']],
    ['replace', 'aaa', ['a*?', 'g'], ['-']],
    ['replace', 'abc', ['b', ''], [(m, i, s) => `[${m}${i}${s}]`]],
    ['replace', 'a😀b', ['', 'gu'], ['.']],
    ['replaceAll', 'a.b.c', ['\\.', 'g'], ['!']],
    ['match', 'a1b22c333', ['\\d+', 'g'], []],
    ['search', 'abc', ['c', ''], []],
  ];
  for (const [method, s, [p, f], args] of cases) {
    const a = s[method](new RegExp(p, f), ...args);
    const b = s[method](new SafeRegExp(p, f), ...args);
    assert.deepEqual(b === null ? null : JSON.stringify(b), a === null ? null : JSON.stringify(a), `${method} ${p}`);
  }
  const all = (C) => [...'a1b22'.matchAll(new C('(?<d>\\d)+', 'g'))].map((m) => [m[0], m.index, { ...m.groups }]);
  assert.deepEqual(all(SafeRegExp), all(RegExp));
  assert.throws(() => 'x'.matchAll(new SafeRegExp('x')), TypeError);
  assert.throws(() => 'x'.replaceAll(new SafeRegExp('x'), ''), TypeError);
});

test('search restores lastIndex', () => {
  const re = new SafeRegExp('b', 'g');
  re.lastIndex = 2;
  assert.equal('abc'.search(re), 1);
  assert.equal(re.lastIndex, 2);
});

test('checkSupport reports without throwing', () => {
  assert.deepEqual(checkSupport('a+'), { ok: true });
  const r = checkSupport('(a)\\1');
  assert.equal(r.ok, false);
  assert.equal(r.kind, 'unsupported');
  assert.equal(r.feature, 'backreference');
  assert.equal(checkSupport('(').kind, 'syntax');
  assert.equal(typeof VERSION, 'string');
});
