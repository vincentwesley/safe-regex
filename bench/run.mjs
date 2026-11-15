#!/usr/bin/env node
// ReDoS benchmark: SafeRegExp vs the built-in RegExp on known-vulnerable patterns.
//
//   node bench/run.mjs [--quick] [--only id,id] [--out results.json] [--chart file.svg]
//
// Method (also in README "Benchmark"):
//  * Every (pattern, engine, n) point is timed in a fresh child process (`bench/measure.mjs`),
//    so a hung native match can be killed and JIT/GC state never leaks between points.
//  * Inside the child: 3 warm-up runs on a tiny input, then the median of `reps` runs
//    (a single run if the first one exceeds 200 ms).
//  * The native engine is killed after `budget` ms; that point is recorded as a timeout and
//    larger sizes are skipped for native.
//  * Growth exponent = least-squares slope of log(ms) against log(n) over the largest points
//    (SafeRegExp: the 5 largest sizes with n >= 1024; native: the 4 largest finished points
//    with ms >= 0.5). Linear ≈ 1, quadratic ≈ 2; exponential patterns show huge slopes.
import { spawnSync } from 'node:child_process';
import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import os from 'node:os';
import { CORPUS } from './corpus.mjs';
import { renderChart } from './chart.mjs';

const args = process.argv.slice(2);
const quick = args.includes('--quick');
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const only = arg('--only', null)?.split(',');
const out = arg('--out', quick ? null : 'bench/results/results.json');
const chartPath = arg('--chart', quick ? null : 'bench/results/redos-benchmark.svg');
const budget = Number(arg('--budget', quick ? 2000 : 10000));
const reps = quick ? 3 : 5;
const maxN = quick ? 65536 : Infinity;
const SLOPE_LIMIT = 1.35;

function measure(id, engine, n) {
  const r = spawnSync(process.execPath, ['bench/measure.mjs', id, engine, String(n), String(reps)], {
    timeout: engine === 'native' ? budget : 60000,
    encoding: 'utf8',
  });
  if (r.error || r.status !== 0) return null; // killed (timeout) or crashed
  try {
    const { ms } = JSON.parse(r.stdout.trim().split('\n').pop());
    return engine === 'native' && ms > budget ? null : ms;
  } catch {
    return null;
  }
}

function slope(points) {
  if (points.length < 2) return null;
  const xs = points.map((p) => Math.log(p.n));
  const ys = points.map((p) => Math.log(Math.max(p.ms, 1e-3)));
  const mx = xs.reduce((a, b) => a + b) / xs.length;
  const my = ys.reduce((a, b) => a + b) / ys.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return num / den;
}

const results = [];
const t0 = Date.now();
for (const entry of CORPUS) {
  if (only && !only.includes(entry.id)) continue;
  const sizes = entry.sizes.filter((n) => n <= maxN);
  const safe = [];
  const native = [];
  let nativeTimeoutAt = null;
  for (const n of sizes) {
    safe.push({ n, ms: measure(entry.id, 'safe', n) });
    if (nativeTimeoutAt === null) {
      const ms = measure(entry.id, 'native', n);
      if (ms === null) nativeTimeoutAt = n;
      else native.push({ n, ms });
    }
  }
  const safeFit = safe.filter((p) => p.ms !== null && p.n >= 1024).slice(-5);
  const nativeFit = native.filter((p) => p.ms >= 0.5).slice(-4);
  const r = {
    id: entry.id,
    source: entry.source,
    kind: entry.kind,
    pattern: entry.pattern,
    flags: entry.flags,
    op: entry.op,
    safe,
    native,
    nativeTimeoutAt,
    safeSlope: slope(safeFit),
    nativeSlope: slope(nativeFit),
    safeMaxN: safe.at(-1)?.n,
    safeMsAtMaxN: safe.at(-1)?.ms,
  };
  r.safeLinear = r.safeSlope !== null && r.safeSlope <= SLOPE_LIMIT && safe.every((p) => p.ms !== null);
  r.nativeSuperLinear = nativeTimeoutAt !== null || (r.nativeSlope !== null && r.nativeSlope >= 1.8);
  results.push(r);
  const fmt = (v) => (v === null ? '—' : v.toFixed(2));
  console.log(
    `${entry.id.padEnd(38)} safe slope ${fmt(r.safeSlope)} (${fmt(r.safeMsAtMaxN)} ms @ n=${r.safeMaxN})   ` +
      `native slope ${fmt(r.nativeSlope)}${nativeTimeoutAt ? `, killed after ${budget} ms @ n=${nativeTimeoutAt}` : ''}`,
  );
}

const summary = {
  mode: quick ? 'quick' : 'full',
  date: new Date().toISOString(),
  node: process.version,
  v8: process.versions.v8,
  cpu: os.cpus()[0]?.model,
  platform: `${os.platform()} ${os.arch()}`,
  budgetMs: budget,
  repsPerPoint: reps,
  slopeLimit: SLOPE_LIMIT,
  entries: results.length,
  safeLinear: results.filter((r) => r.safeLinear).length,
  nativeSuperLinear: results.filter((r) => r.nativeSuperLinear).length,
  nativeTimedOut: results.filter((r) => r.nativeTimeoutAt !== null).length,
  maxSafeSlope: Math.max(...results.map((r) => r.safeSlope ?? Infinity)),
  durationS: Math.round((Date.now() - t0) / 1000),
};
console.log(JSON.stringify(summary, null, 2));

if (out) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ summary, results }, null, 2) + '\n');
}
if (chartPath) {
  mkdirSync(dirname(chartPath), { recursive: true });
  writeFileSync(chartPath, renderChart(results, summary));
}
if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = results.map((r) =>
    `| ${r.id} | ${r.kind} | ${r.safeSlope?.toFixed(2)} | ${r.safeMsAtMaxN?.toFixed(1)} ms @ ${r.safeMaxN} | ${r.nativeTimeoutAt ? `killed after ${budget} ms @ n=${r.nativeTimeoutAt}` : r.nativeSlope?.toFixed(2)} |`);
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
    '## ReDoS benchmark', '',
    `SafeRegExp linear on ${summary.safeLinear}/${summary.entries} entries (slope ≤ ${SLOPE_LIMIT}); native super-linear on ${summary.nativeSuperLinear}/${summary.entries}.`, '',
    '| entry | kind | SafeRegExp slope | SafeRegExp largest | native slope |', '|---|---|---|---|---|', ...rows, '',
  ].join('\n'));
}
const ok = summary.safeLinear === summary.entries;
process.exit(ok ? 0 : 1);
