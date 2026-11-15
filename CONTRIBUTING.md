# Contributing

Thanks for helping. The bar for changes is simple: **the fuzzer and the benchmark must stay green**, because they are the project's claim.

## Setup

```bash
npm ci
npm run build
npm test
```

Node 20 or newer. `npm test` rebuilds the library and runs every test against the built output.

## Before you open a pull request

```bash
npm run lint
npm run build
npm test
node scripts/fuzz.mjs --cases 50000 --seed $RANDOM
node bench/run.mjs --quick
```

* A semantic fix should come with a case in `test/semantics.test.mjs` (compared against the host `RegExp`).
* The core (`src/`) must not use the host's `RegExp` or regex literals, and must not add runtime dependencies. `npm run acceptance` checks this (A4).
* If the fuzzer reports a mismatch, it saves it to `fuzz-failures/mismatches.json`; every entry is reproducible from the seed and case number (`buildCase(seed, i)` in `scripts/fuzz-lib.mjs`).

## Layout

| Path | What |
|---|---|
| `src/parser.ts` | ECMAScript pattern syntax → AST (flags already applied to character sets) |
| `src/compiler.ts` | AST → Pike VM bytecode |
| `src/pikevm.ts` | the matcher |
| `src/regexp.ts` | `SafeRegExp`, the public RegExp-compatible class |
| `src/analyze/` | ε-free NFA and the ReDoS checker |
| `scripts/` | fuzzer, acceptance checks, build helpers |
| `bench/` | ReDoS corpus and benchmarks |
| `playground/` | static web playground |
| `docs/` | research notes, decisions, plan, acceptance criteria |

## Regenerating Unicode data

`npm run gen:casefold` downloads `CaseFolding.txt` (Unicode 17.0.0) and regenerates `src/unicode/casefold-data.ts`.
