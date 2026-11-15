#!/usr/bin/env node
// Differential fuzzer: SafeRegExp vs the host's built-in RegExp.
//
//   node scripts/fuzz.mjs [--cases N] [--seed S] [--workers W] [--out file.json] [--timeout ms]
//
// Each case is (pattern, flags) with several inputs; for every input it compares exec (with a
// random lastIndex), repeated exec, replace (template and function), split, search, match and
// matchAll. Native regex can hang on random patterns, so cases run in worker threads with a
// watchdog: a case where *native* exceeds the timeout is counted as "nativeTimeouts" and skipped.
// A timeout inside SafeRegExp is counted as a failure.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildCase, compareCase } from './fuzz-lib.mjs';

const here = fileURLToPath(import.meta.url);

function parseArgs(argv) {
  const o = { cases: 20000, seed: 1, workers: Math.max(1, availableParallelism() - 0), out: null, timeout: 5000 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--cases') { o.cases = Number(v); i++; }
    else if (k === '--seed') { o.seed = Number(v); i++; }
    else if (k === '--workers') { o.workers = Number(v); i++; }
    else if (k === '--out') { o.out = v; i++; }
    else if (k === '--timeout') { o.timeout = Number(v); i++; }
  }
  return o;
}

async function workerMain() {
  const { SafeRegExp, SafeRegexUnsupportedError, SafeRegexLimitError } = await import('../dist/esm/index.js');
  const { seed, from, to, shared } = workerData;
  const state = new Int32Array(shared); // [currentCase, phase, heartbeat]
  const stats = { cases: 0, inputs: 0, comparisons: 0, passed: 0, mismatches: [], v8Deviations: [], unsupported: 0, soupCases: 0, nativeRejected: 0 };
  for (let i = from; i < to; i++) {
    Atomics.store(state, 0, i);
    Atomics.add(state, 2, 1);
    const c = buildCase(seed, i);
    stats.cases++;
    if (c.soup) stats.soupCases++;
    // Construction parity first.
    let nativeErr = null;
    let safeErr = null;
    try { new RegExp(c.pattern, c.flags); } catch (e) { nativeErr = e; }
    try { new SafeRegExp(c.pattern, c.flags); } catch (e) { safeErr = e; }
    if (safeErr instanceof SafeRegexUnsupportedError || safeErr instanceof SafeRegexLimitError) {
      if (!nativeErr) {
        stats.unsupported++;
        if (!c.soup) stats.mismatches.push({ case: i, pattern: c.pattern, flags: c.flags, op: 'construct', native: 'ok', safe: String(safeErr.message) });
        continue;
      }
    }
    if (nativeErr || safeErr) {
      stats.comparisons++;
      if (nativeErr && safeErr) { stats.passed++; stats.nativeRejected++; }
      else stats.mismatches.push({ case: i, pattern: c.pattern, flags: c.flags, op: 'construct', native: nativeErr ? String(nativeErr.message) : 'ok', safe: safeErr ? String(safeErr.message) : 'ok' });
      continue;
    }
    for (const { input, lastIndex } of c.inputs) {
      stats.inputs++;
      const res = compareCase(SafeRegExp, c.pattern, c.flags, input, lastIndex, (p) => Atomics.store(state, 1, p));
      stats.comparisons += res.comparisons;
      if (res.v8Deviation) { stats.v8Deviations.push({ case: i, ...res.v8Deviation }); }
      if (res.mismatch) {
        stats.mismatches.push({ case: i, pattern: c.pattern, flags: c.flags, input, lastIndex, ...res.mismatch });
        stats.passed += res.comparisons - 1;
        break;
      }
      stats.passed += res.comparisons;
    }
  }
  parentPort.postMessage(stats);
}

function runRange(seed, from, to, timeout) {
  // Runs cases [from, to) in a worker; restarts after a hang. Resolves to merged stats.
  return new Promise((resolve) => {
    const merged = { v8Deviations: [], cases: 0, inputs: 0, comparisons: 0, passed: 0, mismatches: [], unsupported: 0, soupCases: 0, nativeRejected: 0, nativeTimeouts: [], safeTimeouts: [] };
    const start = (begin) => {
      if (begin >= to) return resolve(merged);
      const shared = new SharedArrayBuffer(12);
      const state = new Int32Array(shared);
      const w = new Worker(here, { workerData: { seed, from: begin, to, shared } });
      let lastBeat = -1;
      let lastChange = Date.now();
      const timer = setInterval(() => {
        const beat = Atomics.load(state, 2);
        if (beat !== lastBeat) { lastBeat = beat; lastChange = Date.now(); return; }
        if (Date.now() - lastChange > timeout) {
          clearInterval(timer);
          const at = Atomics.load(state, 0);
          const phase = Atomics.load(state, 1);
          const c = buildCase(seed, at);
          (phase === 2 ? merged.safeTimeouts : merged.nativeTimeouts).push({ case: at, pattern: c.pattern, flags: c.flags });
          w.terminate();
          // Cases before `at` in this worker are lost from stats; rerun them, then skip `at`.
          rerun = { from: begin, at };
        }
      }, 250);
      let rerun = null;
      w.on('message', (s) => {
        clearInterval(timer);
        for (const k of ['cases', 'inputs', 'comparisons', 'passed', 'unsupported', 'soupCases', 'nativeRejected']) merged[k] += s[k];
        merged.mismatches.push(...s.mismatches);
        merged.v8Deviations.push(...s.v8Deviations);
      });
      w.on('exit', () => {
        clearInterval(timer);
        if (rerun) {
          const { from: f, at } = rerun;
          rerun = null;
          merged.cases += 1; // the timed-out case itself
          runRange(seed, f, at, timeout).then((sub) => {
            for (const k of ['cases', 'inputs', 'comparisons', 'passed', 'unsupported', 'soupCases', 'nativeRejected']) merged[k] += sub[k];
            merged.mismatches.push(...sub.mismatches);
            merged.v8Deviations.push(...sub.v8Deviations);
            merged.nativeTimeouts.push(...sub.nativeTimeouts);
            merged.safeTimeouts.push(...sub.safeTimeouts);
            start(at + 1);
          });
        } else {
          resolve(merged);
        }
      });
    };
    start(from);
  });
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const t0 = Date.now();
  const per = Math.ceil(o.cases / o.workers);
  const jobs = [];
  for (let w = 0; w < o.workers; w++) {
    const from = w * per;
    const to = Math.min(o.cases, from + per);
    if (from < to) jobs.push(runRange(o.seed, from, to, o.timeout));
  }
  const parts = await Promise.all(jobs);
  const total = { v8Deviations: [], cases: 0, inputs: 0, comparisons: 0, passed: 0, mismatches: [], unsupported: 0, soupCases: 0, nativeRejected: 0, nativeTimeouts: [], safeTimeouts: [] };
  for (const p of parts) {
    for (const k of ['cases', 'inputs', 'comparisons', 'passed', 'unsupported', 'soupCases', 'nativeRejected']) total[k] += p[k];
    total.mismatches.push(...p.mismatches);
    total.v8Deviations.push(...p.v8Deviations);
    total.nativeTimeouts.push(...p.nativeTimeouts);
    total.safeTimeouts.push(...p.safeTimeouts);
  }
  const summary = {
    seed: o.seed,
    patterns: total.cases,
    patternsFromGrammar: total.cases - total.soupCases,
    patternsFromSyntaxSoup: total.soupCases,
    inputs: total.inputs,
    comparisons: total.comparisons,
    passed: total.passed,
    failed: total.mismatches.length + total.safeTimeouts.length,
    mismatches: total.mismatches.length,
    unsupportedAmongGenerated: total.unsupported,
    bothRejectedAsInvalid: total.nativeRejected,
    v8SpecDeviations: total.v8Deviations.length,
    nativeTimeouts: total.nativeTimeouts.length,
    safeTimeouts: total.safeTimeouts.length,
    durationMs: Date.now() - t0,
    node: process.version,
    v8: process.versions.v8,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (total.mismatches.length) {
    mkdirSync('fuzz-failures', { recursive: true });
    writeFileSync('fuzz-failures/mismatches.json', JSON.stringify(total.mismatches.slice(0, 500), null, 2));
    console.log(`\nFirst mismatches (all saved to fuzz-failures/mismatches.json):`);
    for (const m of total.mismatches.slice(0, 10)) console.log(JSON.stringify(m));
  }
  if (total.v8Deviations.length) console.log('V8 deviations from spec (we follow the spec):', JSON.stringify(total.v8Deviations.slice(0, 3)));
  if (total.nativeTimeouts.length) console.log('native timeouts:', JSON.stringify(total.nativeTimeouts.slice(0, 5)));
  if (total.safeTimeouts.length) console.log('SAFE TIMEOUTS:', JSON.stringify(total.safeTimeouts));
  if (o.out) writeFileSync(o.out, JSON.stringify({ ...summary, nativeTimeoutCases: total.nativeTimeouts, v8DeviationExamples: total.v8Deviations.slice(0, 20) }, null, 2) + '\n');
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
      '## Differential fuzzing (SafeRegExp vs V8 RegExp)',
      '',
      '| metric | value |', '|---|---|',
      ...Object.entries(summary).map(([k, v]) => `| ${k} | ${v} |`),
      '',
    ].join('\n'));
  }
  process.exit(summary.failed === 0 && summary.unsupportedAmongGenerated === 0 ? 0 : 1);
}

if (isMainThread) main();
else workerMain();
