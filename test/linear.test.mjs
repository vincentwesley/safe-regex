// The engine's reason to exist: classic catastrophic patterns finish fast on hostile input.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SafeRegExp } from '../dist/esm/index.js';

const HOSTILE = [
  ['^(a+)+$', '', (n) => 'a'.repeat(n) + '!'],
  ['^(a|aa)+$', '', (n) => 'a'.repeat(n) + '!'],
  ['^(a|a?)+$', '', (n) => 'a'.repeat(n) + '!'],
  ['(a*)*b', '', (n) => 'a'.repeat(n)],
  ['^(\\w+\\s?)*$', '', (n) => 'a '.repeat(n / 2) + '!'],
  ['(.*a){12}', '', (n) => 'a'.repeat(n)],
  ['^\\s*|\\s*$', 'g', (n) => ' '.repeat(n) + 'x'],
  ['(?:.*=.*)+;', 's', (n) => 'x='.repeat(n / 2)],
];

for (const [p, f, gen] of HOSTILE) {
  test(`/${p}/${f} stays fast on n = 20 000`, () => {
    const re = new SafeRegExp(p, f);
    const s = gen(20000);
    const t = performance.now();
    s.replace(re, '');
    const ms = performance.now() - t;
    assert.ok(ms < 3000, `took ${ms.toFixed(0)} ms`);
  });
}

test('doubling the input roughly doubles the time (linear, not quadratic)', () => {
  const re = new SafeRegExp('^(a|aa)+$');
  const time = (n) => {
    const s = 'a'.repeat(n) + '!';
    let best = Infinity;
    for (let k = 0; k < 5; k++) {
      const t = performance.now();
      re.test(s);
      best = Math.min(best, performance.now() - t);
    }
    return best;
  };
  time(20000); // warm up
  const t1 = time(40000);
  const t2 = time(160000);
  // Quadratic would be ~16x; allow generous noise above linear's ~4x.
  assert.ok(t2 / t1 < 9, `ratio ${(t2 / t1).toFixed(2)}`);
});
