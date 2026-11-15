# Plan

## Goal
A from-scratch JavaScript-compatible regex engine that matches in O(n·m) time, packaged as a typed library with a RegExp-like API, plus a static playground (automaton view, race against native, ReDoS checker). Graded by: differential fuzzing against V8 and a ReDoS benchmark, both re-runnable.

## Architecture

```
pattern ──parser.ts──▶ AST ──compiler.ts──▶ Program (Int32Array bytecode + char sets)
                                               │
                         pikevm.ts ◀───────────┤  (matching, captures, JS semantics)
                         analyze/graph.ts ◀────┤  (ε-free NFA for drawing)
                         analyze/redos.ts ◀────┘  (ambiguity analysis for the checker)
regexp.ts: SafeRegExp class (exec/test/lastIndex/symbol methods) on top of pikevm.ts
```

* `src/charset.ts` — sorted code-point range sets: union, negate, intersect, case-closure.
* `src/unicode/` — case canonicalisation (non-u: from host `toUpperCase`; u: CaseFolding.txt).
* `src/errors.ts` — `SafeRegexSyntaxError`, `SafeRegexUnsupportedError`, `SafeRegexLimitError`.

## Milestones

| # | Milestone | Done when |
|---|---|---|
| M0 | Scaffold: package, tsconfig, lint, test runner, CI, licence, docs skeleton | `npm run lint && npm test && npm run build` pass on CI |
| M1 | Parser + char sets + compiler + Pike VM + `SafeRegExp` API | unit tests for syntax, semantics edge cases, errors |
| M2 | Differential fuzzer | ≥ 100 000 cases locally with 0 mismatches; CI job publishes counts |
| M3 | ReDoS corpus + benchmark | every corpus entry linear (slope ≤ 1.35) in our engine; chart + JSON committed |
| M4 | ReDoS checker + automaton graph API | detects every corpus entry; no false alarms on a list of safe patterns |
| M5 | Playground | builds to `dist/playground`, smoke-tested in headless Chromium |
| M6 | Docs, release prep, fresh-clone acceptance run, PR | `npm run acceptance` passes from a fresh clone |

## Risks and mitigations
* **JS semantics are subtle** (empty check, capture reset, Annex B syntax, case folding, `lastIndex` on surrogates). Mitigation: fuzzing against V8 is the arbiter; any mismatch becomes a unit test.
* **Native regex hangs inside the fuzzer.** Mitigation: workers + watchdog, counted as "native timeout".
* **Program blow-up from `{n,m}`.** Mitigation: size cap with a clear error.
* **Performance on benign input** will be slower than V8's JIT. Mitigation: first-character prefilter; honest numbers in the README.
