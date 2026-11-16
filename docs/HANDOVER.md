# Handover

Status file for resuming work in a new session.

## Where things are
* Engine: `src/` (parser → compiler → Pike VM; `regexp.ts` is the public `SafeRegExp` class). ReDoS checker: `src/analyze/`.
* Fuzzer: `scripts/fuzz.mjs` + `scripts/fuzz-lib.mjs`. Benchmarks: `bench/` (results in `bench/results/`). Playground: `playground/` → `dist/playground/`.
* Acceptance: `npm run acceptance` (`scripts/acceptance.mjs`, checks listed in `docs/ACCEPTANCE.md`).
* README tables are generated: after re-running fuzz/bench, run `node scripts/update-readme.mjs`.
* Decisions and their reasons: `docs/DECISIONS.md` (D1–D20). Sources: `docs/RESEARCH.md`.

## Milestone log
* M0–M1: scaffold, parser, compiler, Pike VM, API, unit tests.
* M2: differential fuzzer with a worker pool, hang watchdog and spec oracle for V8 deviations.
* M3: 20-entry ReDoS corpus and benchmark; linear `split` (D16).
* M4: ReDoS checker `analyze()`.
* M5: playground, smoke-tested in headless Chromium.
* M6: docs, performance pass, acceptance script, fresh-clone run, pull request #1 merged into `main` with CI green on Node 20/22/24 + fuzz + benchmark jobs.

## Done and verified
* **Acceptance: 13/13 checks pass from a fresh clone** of the branch (`npm ci && node scripts/acceptance.mjs`, 2026-11-15).
* **Differential fuzzing (published run, seed 2026):** 300,000 random patterns, 1,135,052 inputs, **7,606,021 comparisons, 7,606,021 passed, 0 failed**, 0 generated patterns refused as unsupported, 16,229 patterns both engines rejected as invalid, 92 V8 deviations from the spec (each verified: SafeRegExp equals the spec oracle), 8 cases skipped because V8 itself took > 5 s. Earlier independent runs: seed 7 (7.6 M comparisons) and seed 3 (1.0 M) — 0 SafeRegExp failures after the oracle. `bench/results/fuzz.json`.
* **ReDoS benchmark (full run, 10 s native budget, 5 reps, fresh process per point):** SafeRegExp linear on **20/20** entries (growth exponents 0.72–1.09; e.g. 456 ms worst at n = 64k, ≤ 146 ms on all polynomial entries at n = 128k). The built-in engine was super-linear on **20/20** (exponents ~1.9–2.2 on polynomial entries, 12–20 on exponential ones) and was killed at 10 s on 11. `bench/results/results.json`, chart `bench/results/redos-benchmark.svg`.
* **ReDoS checker:** classifies all 20 corpus entries correctly (7 exponential, 13 polynomial) with validated attack strings; 0 false alarms on 20 safe fixtures.
* **Unsupported syntax** (backreferences, named backreferences, lookahead, lookbehind, `\p{}`, `v` flag, legacy octal, non-ASCII group names) rejected with `SafeRegexUnsupportedError` + reason; listed in the README.
* **Packaging:** `npm pack` tarball installs; ESM `import` and CJS `require` both work (A10). Install from GitHub runs `prepare` to build.
* **CI** (GitHub Actions): lint/build/test on Node 20, 22, 24; quick benchmark; 100k-pattern fuzz with a new seed per run, counts in the job summary and as an artifact.
* **Playground** builds to `dist/playground/`; smoke test passes (automaton, checker, race kills the native engine).
* Repo hygiene: MIT licence, SECURITY.md, CHANGELOG.md, CONTRIBUTING.md, README for developers with examples (executed by `test/readme.test.mjs`) and an honest comparison with RE2, re2js, Rust `regex`, Go `regexp` and V8's experimental engine.

## Not done, and why
* **Lookahead/lookbehind**: linear algorithms exist (Barrière & Pit-Claudel 2024) but need extra passes; left out to keep one well-tested engine for 1.0 (D4). The error message says so accurately.
* **`\p{…}` and the `v` flag**: need Unicode property tables; out of scope for 1.0.
* **Lazy DFA / faster matching**: SafeRegExp is 12–52× slower than V8's JIT on ordinary input (`bench/results/throughput.md`). A DFA layer is the next step (D17); not started, to avoid rushing a second engine that must respect the empty-check state.
* **Global-iteration bound**: a `g` loop can be O(n²·m) on adversarial input (each `exec` is linear). Documented (D19, README, SECURITY.md), not solved — same as Rust's `regex`.

## What needs Vin
See `docs/NEEDS-VIN.md` for exact steps:
1. ~~Tag/release `v1.0.0`~~ Done 2026-11-15: tag `v1.0.0` pushed, GitHub release published with the npm tarball and playground zip.
2. ~~Enable private vulnerability reporting~~ Done 2026-11-15.
3. ~~GitHub Pages for the playground~~ Done 2026-11-15: https://vincentwesley.github.io/safe-regex/ (`.github/workflows/pages.yml`).
4. ~~npm publish~~ Done 2026-11-16: https://www.npmjs.com/package/@vincentwesley/safe-regex
