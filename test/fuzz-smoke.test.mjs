// A small in-process slice of the differential fuzzer, so `npm test` alone exercises it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SafeRegExp } from '../dist/esm/index.js';
import { buildCase, compareCase } from '../scripts/fuzz-lib.mjs';

test('1000 random patterns agree with the native engine', () => {
  let compared = 0;
  for (let i = 0; i < 1000; i++) {
    const c = buildCase(424242, i);
    let ok = true;
    try { new RegExp(c.pattern, c.flags); } catch { ok = false; }
    let safeOk = true;
    try { new SafeRegExp(c.pattern, c.flags); } catch { safeOk = false; }
    if (c.soup && !(ok && safeOk)) continue;
    assert.equal(safeOk, ok, `construct /${c.pattern}/${c.flags}`);
    if (!ok) continue;
    for (const { input, lastIndex } of c.inputs) {
      const r = compareCase(SafeRegExp, c.pattern, c.flags, input, lastIndex);
      compared += r.comparisons;
      assert.equal(r.mismatch, null, JSON.stringify({ pattern: c.pattern, flags: c.flags, input, lastIndex, ...r.mismatch }));
    }
  }
  assert.ok(compared > 10000);
});
