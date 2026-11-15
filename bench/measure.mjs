// Child process: times one (corpus entry, engine, n) and prints {"ms": median} as JSON.
// Usage: node bench/measure.mjs <id> <native|safe> <n> <reps>
import { CORPUS, runOnce } from './corpus.mjs';
import { SafeRegExp } from '../dist/esm/index.js';

const [id, engine, nStr, repsStr] = process.argv.slice(2);
const entry = CORPUS.find((e) => e.id === id);
const Ctor = engine === 'native' ? RegExp : SafeRegExp;
const n = Number(nStr);
const reps = Number(repsStr);
const input = entry.attack(n);

// Warm up on a small input so JIT compilation isn't timed.
for (let k = 0; k < 3; k++) runOnce(entry, Ctor, entry.attack(Math.min(n, 8)));

const times = [];
for (let k = 0; k < reps; k++) {
  const t = process.hrtime.bigint();
  runOnce(entry, Ctor, input);
  times.push(Number(process.hrtime.bigint() - t) / 1e6);
  // A single slow run is enough to place the point; don't repeat a multi-second match.
  if (times[0] > 200) break;
}
times.sort((a, b) => a - b);
process.stdout.write(JSON.stringify({ ms: times[Math.floor(times.length / 2)], runs: times.length }) + '\n');
