# Security policy

## What this project promises

`SafeRegExp#exec` (and everything built on it: `test`, `match`, `replace`, `split`, `search`, `matchAll`) runs in **O(n · m)** time for an input of length *n* and a compiled program of *m* instructions, whatever the pattern and input. Pattern compilation is bounded by `maxProgramSize` (default 100 000 instructions). A pattern or input that makes SafeRegExp take super-linear time in a single `exec`, crash, or return a result different from the ECMAScript specification is a bug we treat as a security issue.

Known, documented limits (not vulnerabilities):
* Iterating over *all* matches (`/g` with `replace`, `match`, `matchAll`) calls `exec` once per match; in the worst case this is O(n² · m) — the same bound Rust's `regex` crate documents for its match iterators.
* SafeRegExp is slower than the built-in engine on ordinary input (see README, "Performance").
* `analyze()` (the ReDoS checker) is a heuristic aid for code that still uses the built-in engine; it can report false alarms and gives up on very large patterns ("too-complex").

## Reporting a vulnerability

Please report privately via GitHub's **"Report a vulnerability"** button on the repository's Security tab (private vulnerability reporting). Include the pattern, flags, input (or a generator for it), what you expected, and what happened. Please don't open a public issue for an unfixed vulnerability.

You can expect an acknowledgement within 7 days. Fixes are released as a new patch version with a CHANGELOG entry crediting the reporter (unless you prefer otherwise).

## Supported versions

| Version | Supported |
|---|---|
| 1.x | yes |
