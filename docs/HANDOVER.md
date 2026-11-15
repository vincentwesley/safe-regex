# Handover

Status file for resuming work in a new session. Updated after each milestone.

## Where things are
* Engine: `src/` (parser → compiler → Pike VM; `regexp.ts` is the public class). Checker: `src/analyze/`.
* Fuzzer: `scripts/fuzz.mjs` (+ `scripts/fuzz-lib.mjs`). Benchmark: `bench/`.
* Docs: `docs/` (RESEARCH, DECISIONS, PLAN, ACCEPTANCE, NEEDS-VIN).

## Milestone log
* **M0–M1 (done):** scaffold, parser, compiler, Pike VM, `SafeRegExp` API, unit tests (135 passing).
* **M2 (done):** differential fuzzer. 300 000 patterns / 7.6 M comparisons (seed 7): 0 SafeRegExp bugs after classifying V8's unicode surrogate-pair deviations with a spec oracle.
* **M3 (done):** ReDoS corpus (20 entries) + benchmark; SafeRegExp linear on all 20 after making `split` linear.
* **M4 (done):** ReDoS checker `analyze()` classifies all 20 corpus entries (7 exponential, 13 polynomial, all attacks validated) and passes 20 safe fixtures.
* **M5 (done):** playground (`playground/` → `dist/playground/`), smoke-tested in headless Chromium (`scripts/playground-smoke.mjs`).
* **M6 (in progress):** README, SECURITY, CHANGELOG, CONTRIBUTING, NEEDS-VIN written; acceptance script `scripts/acceptance.mjs`; performance pass (literal prefix, copy-on-write captures).

## Next steps
Final full benchmark → `bench/results/`, final large fuzz → `bench/results/fuzz.json`, throughput → `bench/results/throughput.md`, then `node scripts/update-readme.mjs`; screenshots to `docs/img/`; fresh-clone acceptance; PR; merge; tag.
