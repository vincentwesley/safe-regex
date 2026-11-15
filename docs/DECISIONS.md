# Decisions

Each decision, with the reason. Newest at the bottom.

### D1. Language: TypeScript, zero runtime dependencies
The package must be "typed", run in Node and browsers, and be graded by re-runnable tests. TypeScript compiled to plain ES2020 gives typed declarations and runs everywhere. The core has **no runtime dependencies** and does not call the host `RegExp` anywhere (checked by `scripts/acceptance.mjs`, which greps `src/` for `RegExp(` and regex literals).

### D2. Algorithm: Pike VM with JavaScript-specific extensions
Options considered: backtracking with memoisation, lazy DFA, derivatives, Pike VM. The Pike VM is the only one that gives *submatch* (capture) results with leftmost-first priority in a single linear pass, which is what `exec` must return. A DFA can't produce captures on its own. Cost: O(n·m) time, O(m) memory per step.

Two extensions are needed for JS semantics (from Barrière & Pit-Claudel 2024):
* **Capture reset**: each loop iteration starts with a `CLEAR` instruction resetting the captures inside the loop body.
* **Empty check**: an optional iteration that consumed nothing is rejected. Each loop whose body can match empty gets a register recording where the current iteration started; `CHECK` kills the thread if the position hasn't moved. Thread de-duplication then has to key on *(pc, how many enclosing iterations started at this position)* instead of just *pc*, otherwise a dropped thread could have behaved differently. The "how many" is always a suffix of the enclosing-loop chain (an inner iteration can't start before an outer one), so the key space is pc × (loop depth + 1), still independent of input length.

### D3. Counted repetition is expanded, with a size cap
`e{2,5}` compiles to `e e (e (e (e)?)?)?` (nested optionals, so leaving the loop is final, as in the spec). Counters inside a Pike VM would make thread state depend on the input and break the linear bound. Expansion is bounded by `maxProgramSize` (default 100 000 instructions); larger patterns throw `SafeRegexLimitError`. RE2 makes the same trade-off.

### D4. Unsupported syntax is rejected at construction, with the reason
Backreferences (`\1`, `\k<name>`): matching with backreferences is NP-hard in general, so no linear algorithm exists. Lookahead and lookbehind: these *can* be matched in linear time (Barrière & Pit-Claudel 2024) but need extra passes and per-position oracle tables; I left them out of v1.0 to keep one simple, well-tested engine, and the error message says exactly that rather than claiming they're impossible. (The brief says lookbehind "can't be matched in linear time"; the research says otherwise, so the docs state the accurate reason.) Also rejected: `\p{…}` property escapes (would need Unicode property tables), the `v` flag, legacy octal escapes, non-ASCII group names. Every rejection is a `SafeRegexUnsupportedError` (a `SyntaxError` subclass) with a `feature` code and an explanation.

### D5. Case-insensitive matching follows the spec's two definitions
Without `u`: `Canonicalize` uses `String.prototype.toUpperCase` with the spec's two exceptions; the table is computed lazily at run time from the host, so it agrees with the host engine's Unicode version. With `u`: simple case folding from `CaseFolding.txt` 17.0, generated into `src/unicode/casefold-data.ts` by `scripts/gen-casefold.mjs`. String case-mapping functions aren't regex engines, so D1 holds.

### D6. Familiar API: a `SafeRegExp` class that mirrors `RegExp`
Same constructor, `exec`, `test`, `lastIndex`, flag getters, `source`, `flags`, `toString`, and the well-known symbols (`Symbol.match`, `matchAll`, `replace`, `search`, `split`), so `str.replace(new SafeRegExp(…), …)`, `str.split(re)`, `str.matchAll(re)` work unchanged. The symbol methods are implemented in this package (not borrowed from `RegExp.prototype`), so nothing ever reaches the host engine; the fuzzer checks their output against native.

### D7. Errors: invalid JS patterns throw `SyntaxError` like `RegExp` does
`SafeRegexSyntaxError extends SyntaxError`. The fuzzer checks that every pattern JS rejects, we reject too (for patterns inside the supported grammar).

### D8. Differential fuzzing harness
Random ASTs from the supported grammar → pattern strings; random flags; inputs built from the pattern's own alphabet plus noise (so matches actually happen); random `lastIndex`. Compare `exec` (index, all captures, `groups`, `indices`), `lastIndex`, and also `replace`/`split`/`matchAll` against native. Runs in `worker_threads` with a watchdog, because a random pattern can make *native* hang; such cases are counted and reported separately ("native timeout") instead of hanging CI. Seeded PRNG, so any failure is reproducible from its seed.

### D9. Benchmark method
Each corpus entry has a pattern and an attack-string generator `f(n)`. For each n in a doubling series, time native and SafeRegExp separately, each in a **fresh child process** (so a hung native match can be killed and JIT state doesn't leak), median of 5 runs. Native is killed after a time budget and recorded as "> budget". The growth exponent is the least-squares slope of log(time) vs log(n) over the largest sizes. Pass criterion for us: slope ≤ 1.35 for every entry (linear plus noise).

### D10. ReDoS checker: ambiguity analysis (Weideman et al. 2016)
The checker builds an ε-free NFA from the compiled program, with ε-path multiplicities, treating assertions as ε (over-approximation) except `^` after a consumed character, honouring the JS empty check, and prepending an implicit lazy `[^]*?` for unanchored, non-sticky patterns. Exponential = EDA via the pair product graph; polynomial degree = longest chain of IDA pairs via the triple product. It produces a witness (prefix, pump, suffix) and the culprit quantifier's source span, then *validates* the witness by checking with our engine that the attack string does not match (so the backtracker must explore everything). Above a size budget it answers "too complex to analyse" instead of guessing.

### D11. Playground: dependency-free static site
Plain HTML/CSS + one bundled ES module (esbuild bundles the library). The automaton is drawn as SVG by a small layered layout written here. Native regex runs inside a Web Worker so a hung match can be terminated. Output goes to `dist/playground/`; it works from `file://`-free static hosting (any static server) and is not required to be deployed.

### D12. Packaging: ESM + CJS, installable from GitHub
`npm install github:vincentwesley/safe-regex` runs the `prepare` script, which builds `dist/`. Package name `@vincentwesley/safe-regex` because `safe-regex` on npm is an unrelated, well-known ReDoS *detector* and would collide in users' `node_modules`. Not published to npm (needs the owner's token).

### D13. Tooling: TypeScript 6.0, ESLint 10 + typescript-eslint, node:test, esbuild
TypeScript 7 (native port) is out but typescript-eslint supports `<6.1`, so 6.0 is pinned. Tests use Node's built-in runner — no test-framework dependency — and run against the built output, which also tests the build.

### D14. Branch workflow
This session may only push to `claude/nice-dijkstra-k7m4sp`, so all work goes on that branch and lands through one pull request at the end.
