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
* **M4 (in progress):** ReDoS checker `analyze()` classifies all 20 corpus entries.

## Next steps
M5 playground, M6 README/release docs, acceptance script, fresh-clone run, PR.
