# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-11-15

### Added
- `SafeRegExp`: a from-scratch regular-expression engine (parser → compiler → Pike VM) that matches in time linear in the input, with the same API as `RegExp`: constructor, `exec`, `test`, `lastIndex`, flag getters, `source`, `flags`, `toString`, and `Symbol.match` / `matchAll` / `replace` / `search` / `split`, so `String.prototype` methods accept it.
- JavaScript semantics: leftmost-first priority, capture reset per iteration, the empty-iteration check, Annex B syntax for non-`u` patterns, `u`-mode code points and surrogate pairs, both case-insensitive canonicalisations (`toUpperCase` without `u`, Unicode 17.0 simple case folding with `u`), named groups, `d` indices, flags `d g i m s u y`.
- Clear errors: `SafeRegexSyntaxError` for invalid patterns, `SafeRegexUnsupportedError` (with a `feature` code and reason) for backreferences, lookaround, `\p{…}`, the `v` flag, legacy octal escapes and non-ASCII group names, `SafeRegexLimitError` for oversized programs; `checkSupport()` to test without throwing.
- `analyze()`: a ReDoS checker that predicts exponential or polynomial backtracking in the built-in engine, explains the cause, points at the responsible quantifier and produces a validated attack string.
- Differential fuzzer against V8 (`scripts/fuzz.mjs`), ReDoS benchmark on 20 patterns from advisories and outages (`bench/`), benign-input throughput benchmark.
- Static playground (`npm run build`, then serve `dist/playground/`): match view, automaton drawing, live race against the built-in engine, multi-pattern ReDoS checker.
