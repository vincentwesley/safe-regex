# Acceptance checks

Every check below is run by `npm run acceptance` (`scripts/acceptance.mjs`), which prints PASS/FAIL per check and exits non-zero if any fails. Run it from a fresh clone after `npm ci`.

| ID | Check | How it is verified |
|---|---|---|
| A1 | Lint passes | `npm run lint` exits 0 |
| A2 | Type-check and build pass | `npm run build` exits 0 and produces `dist/esm/index.js`, `dist/cjs/index.js`, `dist/types/index.d.ts`, `dist/playground/index.html` |
| A3 | Unit tests pass | `npm test` exits 0 |
| A4 | No host regex in the core | no regex literal or `RegExp(` call in `src/` (outside comments); no runtime `dependencies` in `package.json` |
| A5 | Differential fuzzing | `node scripts/fuzz.mjs --cases 20000 --seed 1` reports 0 mismatches and 0 unsupported among generated cases |
| A6 | Linear time on known ReDoS patterns | `node bench/run.mjs --quick` reports slope ≤ 1.35 for every corpus entry for SafeRegExp, and native is super-linear (slope ≥ 1.8 or timed out) on at least 80% of entries |
| A7 | Unsupported features rejected with a reason | constructing `(a)\1`, `\k<x>` with a group `x`, `(?<=a)b`, `(?<!a)b`, `(?=a)`, `(?!a)`, `\p{L}` with `u`, flag `v` each throws `SafeRegexUnsupportedError` whose message contains "not supported" and a reason |
| A8 | ReDoS checker | `analyze()` flags every corpus entry as exponential or polynomial and returns a validated attack string; returns "safe" for every pattern in `test/fixtures/safe-patterns.json` |
| A9 | API works with String methods | `"a-b".split(re)`, `replace` with `$1`/`$<n>`/function, `matchAll`, `search`, `match` with `g` all equal native |
| A10 | Installable as a package | `npm pack` succeeds; the tarball installs into a temp project; both `import` and `require` load it and match a pattern |
| A11 | Repo hygiene | files exist: `LICENSE` (MIT), `SECURITY.md`, `CHANGELOG.md`, `README.md`, `CONTRIBUTING.md`, `.github/workflows/ci.yml`, `docs/{RESEARCH,DECISIONS,PLAN,ACCEPTANCE,HANDOVER,NEEDS-VIN}.md`; no file matches common secret patterns |
| A12 | Playground works | `dist/playground/index.html` loads in headless Chromium with no console errors; drawing, race and checker produce output (`scripts/playground-smoke.mjs`; skipped with a notice if Playwright is unavailable) |
| A13 | README documents unsupported syntax | README contains a section listing every `feature` code that `SafeRegexUnsupportedError` can produce |
