// Benign-input throughput: how much slower SafeRegExp is than the JIT-compiled built-in engine
// on ordinary work. Usage: node bench/throughput.mjs
import { SafeRegExp } from '../dist/esm/index.js';

const words = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor 2024-05-01 user@example.com 192.168.0.1'.split(' ');
let text = '';
for (let i = 0; text.length < 1_000_000; i++) text += words[(i * 7919) % words.length] + (i % 13 === 0 ? '\n' : ' ');

const CASES = [
  ['literal search', 'consectetur', 'g'],
  ['ISO dates', '\\b(\\d{4})-(\\d{2})-(\\d{2})\\b', 'g'],
  ['emails', '[\\w.+-]+@[\\w-]+\\.[\\w.]+', 'g'],
  ['IPv4', '\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b', 'g'],
  ['words, case-insensitive', '\\bLOREM\\b', 'gi'],
  ['last word of each line', '\\w+$', 'gm'],
];

function time(fn) {
  fn();
  let best = Infinity;
  for (let k = 0; k < 5; k++) {
    const t = performance.now();
    fn();
    best = Math.min(best, performance.now() - t);
  }
  return best;
}

console.log(`input: ${(text.length / 1e6).toFixed(2)} MB of text, ${process.version}`);
console.log('| workload | built-in RegExp | SafeRegExp | ratio |');
console.log('|---|---|---|---|');
for (const [name, p, f] of CASES) {
  const count = (C) => () => text.match(new C(p, f))?.length ?? 0;
  const n1 = count(RegExp)();
  const n2 = count(SafeRegExp)();
  if (n1 !== n2) throw new Error(`${name}: ${n1} vs ${n2} matches`);
  const a = time(count(RegExp));
  const b = time(count(SafeRegExp));
  console.log(`| ${name} (${n1} matches) | ${a.toFixed(1)} ms | ${b.toFixed(1)} ms | ${(b / a).toFixed(0)}× |`);
}
