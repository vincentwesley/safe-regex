import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyze, attackString, SafeRegExp } from '../dist/esm/index.js';
import { CORPUS } from '../bench/corpus.mjs';

const SAFE = JSON.parse(readFileSync(new URL('./fixtures/safe-patterns.json', import.meta.url), 'utf8'));

for (const e of CORPUS) {
  test(`checker flags ${e.id} as ${e.kind}`, () => {
    const r = analyze(e.pattern, e.flags);
    assert.equal(r.status, e.kind, r.summary);
    assert.ok(r.validated, 'attack string validated');
    assert.ok(r.attack && r.attack.pump.length > 0);
    assert.ok(r.culprits.length > 0);
    // The attack must really fail: no match may start inside the pumped part.
    const re = new SafeRegExp(e.pattern, [...e.flags].filter((c) => c !== 'g').join('') + 'g');
    const s = attackString(r.attack, 50);
    re.lastIndex = r.attack.prefix.length;
    const m = re.exec(s);
    assert.ok(m === null || m.index >= s.length - r.attack.suffix.length, `matched at ${m && m.index}`);
  });
}

for (const [p, f] of SAFE) {
  test(`checker finds /${p}/${f} safe`, () => {
    const r = analyze(p, f);
    assert.equal(r.status, 'safe', `${r.summary}: ${r.explanation}`);
  });
}

test('checker reports unsupported and invalid patterns without throwing', () => {
  assert.equal(analyze('(a)\\1').status, 'unsupported');
  assert.equal(analyze('(').status, 'invalid');
});

test('checker explains the cause in words', () => {
  const r = analyze('^(a|aa)+$');
  assert.match(r.explanation, /more than one way/);
  assert.equal(r.culprits[0].text, '(a|aa)+');
});
