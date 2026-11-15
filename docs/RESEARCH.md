# Research notes

Notes gathered before building. Each entry says what the source is and what I took from it.

## 1. Linear-time matching: the algorithms

| Source | What I took from it |
|---|---|
| Ken Thompson, *Regular Expression Search Algorithm*, CACM 11(6), 1968 — <https://dl.acm.org/doi/10.1145/363347.363387> | Compile the pattern to an NFA and simulate all states at once. Each input character is examined once per NFA state, so the work is O(n·m). This is the whole basis of the linear-time guarantee. |
| Russ Cox, *Regular Expression Matching Can Be Simple And Fast* — <https://swtch.com/~rsc/regexp/regexp1.html> | The clearest explanation of why backtracking explodes on `(a?){n}a{n}` and why Thompson simulation does not. |
| Russ Cox, *Regular Expression Matching: the Virtual Machine Approach* — <https://swtch.com/~rsc/regexp/regexp2.html> | The **Pike VM**: Thompson simulation where each thread carries its own capture slots, threads are kept in priority order, and a thread that reaches a program counter already visited in this step is dropped. Keeping priority order gives the *same* submatch the backtracking engine would report (leftmost-first, "Perl/JS semantics") without backtracking. This is the core algorithm here. |
| Russ Cox, *Regular Expression Matching in the Wild* — <https://swtch.com/~rsc/regexp/regexp3.html> | How RE2 layers engines (one-pass, bit-state backtracker bounded by n·m, lazy DFA, Pike VM). Counted repetition `x{n,m}` is expanded into copies and bounded (RE2 caps at 1000). I adopt the expansion and a size cap. |
| RE2 — <https://github.com/google/re2>, syntax: <https://github.com/google/re2/wiki/Syntax> | Reference for what a linear engine leaves out: backreferences, lookaround. RE2 uses leftmost-first semantics but its syntax and semantics are Perl/PCRE-flavoured, not JavaScript (e.g. `$` and `\s` differ, no empty-check rule). |
| Rust `regex` crate — <https://github.com/rust-lang/regex>; Andrew Gallant, *Regex engine internals as a library* — <https://blog.burntsushi.net/regex-internals/> | Architecture of a modern linear engine: NFA (Thompson) → PikeVM, bounded backtracker, one-pass DFA, lazy (hybrid) DFA, full DFA; literal prefilters are the biggest practical speedup. Unicode by default, no lookaround/backrefs. |
| Go `regexp` — <https://pkg.go.dev/regexp> | Another RE2-derived engine: guaranteed linear, documents its unsupported syntax explicitly. Model for the README's "unsupported" list. |
| .NET 7 `RegexOptions.NonBacktracking` — <https://devblogs.microsoft.com/dotnet/regular-expression-improvements-in-dotnet-7/> | Derivative-based (Brzozowski/Antimirov) lazy DFA approach; also rejects backreferences and lookarounds; captures are computed in a later phase. |
| V8, *An additional non-backtracking RegExp engine* (Martin Bidlingmaier, 2021) — <https://v8.dev/blog/non-backtracking-regexp> | V8 ships an experimental linear engine (`--enable-experimental-regexp-engine`, `/l` flag) based on the Pike VM. Confirms the Pike VM approach can reproduce JavaScript capture semantics. It is off by default and not available in browsers' default configuration, which is why a library is still useful. |
| Aurèle Barrière & Clément Pit-Claudel, *Linear Matching of JavaScript Regular Expressions*, PLDI 2024 — <https://arxiv.org/abs/2311.17620>, engine: <https://github.com/LindenRegex/RegElk> | The most important source for JS semantics. Points I used: (1) JS quantifiers have an **empty-check** — an optional iteration that matches the empty string is rejected — and **capture reset** at the start of every iteration; a naive Pike VM gets both wrong. (2) The empty-check can be implemented by remembering where the current iteration started. (3) Lookarounds *can* be matched in linear time with extra passes over the input; backreferences cannot in general (matching with backreferences is NP-hard). |
| TC39 *Linear matching* proposal (Stage 0) — <https://tc39.es/proposal-linear-matching/> | There is interest in a linear flag in the language itself; until then a library is the portable option. |
| ECMAScript spec, RegExp objects — <https://tc39.es/ecma262/#sec-regexp-regular-expression-objects> | The ground truth for syntax (incl. Annex B web-compat grammar for non-`u` patterns), `Canonicalize` for case-insensitive matching, `RepeatMatcher` (empty check, capture reset), `RegExpBuiltinExec` (`lastIndex`, `d` indices), `GetSubstitution`, `@@split`. |
| Unicode `CaseFolding.txt` 17.0 — <https://www.unicode.org/Public/17.0.0/ucd/CaseFolding.txt> | Under `u` + `i`, JS canonicalises with simple case folding (status C and S). Node 22 ships Unicode 17 (`process.versions.unicode`). Without `u`, JS canonicalises with `toUpperCase`, which can be computed at run time from the host so it matches the host exactly. |

## 2. ReDoS: what goes wrong and how to detect it

| Source | What I took from it |
|---|---|
| OWASP, *Regular expression Denial of Service* — <https://owasp.org/www-community/attacks/Regular_expression_Denial_of_Service_-_ReDoS> | Canonical "evil regex" shapes: `(a+)+`, `([a-zA-Z]+)*`, `(a\|aa)+`, `(a\|a?)+`, `(.*a){x}`, and the OWASP-repo Java class-name regex `^(([a-z])+.)+[A-Z]([a-z])+$`. |
| Weideman, van der Merwe, Berglund, Watson, *Analyzing Matching Time Behavior of Backtracking Regular Expression Matchers by Using Ambiguity of NFA*, CIAA 2016 — <https://link.springer.com/10.1007/978-3-319-40946-7_27> | The analysis used by the checker: model the backtracking matcher as an NFA (with ε-path multiplicities and an implicit `.*?` prefix for unanchored search). **Exponential** blow-up ⇔ the NFA is exponentially ambiguous (EDA: some state has two distinct same-label cycles); **polynomial of degree k+1** ⇔ k chained "IDA" pairs (p≠q with p→p, p→q, q→q on one word). Both are decidable with product-automaton reachability. |
| Berglund, Drewes, van der Merwe, *Analyzing Catastrophic Backtracking Behavior in Practical Regular Expression Matching* — <https://arxiv.org/abs/1405.5599> | Formal model of a priority-ordered backtracking matcher; motivates treating ε-path multiplicity as ambiguity. |
| Davis, Coghlan, Servant, Lee, *The Impact of Regular Expression Denial of Service (ReDoS) in Practice*, ESEC/FSE 2018 — <https://dl.acm.org/doi/10.1145/3236024.3236027> | Thousands of super-linear regexes in npm and PyPI modules; heuristics ("star height > 1") have many false positives; most real fixes rewrite the regex. Motivates an engine that makes the whole class impossible instead of a detector. |
| Cloudflare, *Details of the Cloudflare outage on July 2, 2019* — <https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/> | A WAF rule containing `.*(?:.*=.*)` exhausted CPU worldwide for 27 minutes. Polynomial (not exponential) backtracking is enough to cause an outage. Included in the benchmark. |
| Stack Exchange, *Outage Postmortem – July 20, 2016* — <https://stackstatus.tumblr.com/post/147710624694/outage-postmortem-july-20-2016> | `^[\s‌]+\|[\s‌]+$` on a post with ~20,000 consecutive whitespace characters: quadratic, 34-minute outage. Included in the benchmark. |

## 3. ReDoS advisories used in the benchmark corpus

Each vulnerable regex was copied from the vulnerable package version on npm and checked against the fixing version's diff (downloaded with `npm pack`, read but never executed). The attack strings were confirmed empirically by the benchmark itself (see `bench/corpus.mjs`).

| Package | Advisory | Vulnerable regex (abridged) | Fix |
|---|---|---|---|
| `ms` 0.7.0 | CVE-2015-8315 — <https://nvd.nist.gov/vuln/detail/CVE-2015-8315> | `^((?:\d+)?\.?\d+) *(milliseconds?\|…\|y)?$` (i) | 0.7.1 caps input length at 10,000 |
| `trim` 0.0.1 | CVE-2020-7753 — <https://nvd.nist.gov/vuln/detail/CVE-2020-7753> | `^\s*\|\s*$` (g) | none upstream |
| `ansi-regex` 5.0.0 | CVE-2021-3807 — <https://nvd.nist.gov/vuln/detail/CVE-2021-3807> | `[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]*)*)?\u0007)…` | 5.0.1 splits the ambiguous alternative |
| `color-string` 1.5.4 | CVE-2021-29060 — <https://nvd.nist.gov/vuln/detail/CVE-2021-29060> | `^hwb\(\s*([+-]?\d*[\.]?\d+)(?:deg)?…` | 1.5.5 bounds `\d{0,3}` |
| `glob-parent` 5.1.1 | CVE-2020-28469 — <https://nvd.nist.gov/vuln/detail/CVE-2020-28469> | `[\{\[].*[\/]*.*[\}\]]$` | 5.1.2 drops `[\/]*.*` |
| `semver` 7.5.1 | CVE-2022-25883 — <https://nvd.nist.gov/vuln/detail/CVE-2022-25883> | e.g. `(\s*)(?:~>?)\s+` (g) | 7.5.2 rewrites `\s*`→`\s{0,1}` |
| `cross-spawn` 7.0.3 | CVE-2024-21538 — <https://nvd.nist.gov/vuln/detail/CVE-2024-21538> | `(\\*)"` (g) | 7.0.5 uses a lookahead trick |
| `nth-check` 2.0.0 | CVE-2021-3803 — <https://nvd.nist.gov/vuln/detail/CVE-2021-3803> | `^([+-]?\d*n)?\s*(?:([+-]?)\s*(\d+))?$` | 2.0.1 replaces the regex with a parser |
| `normalize-url` 4.5.0 | CVE-2021-33502 — <https://nvd.nist.gov/vuln/detail/CVE-2021-33502> | `^data:(.*?),(.*?)(?:#(.*))?$` | 4.5.1 |
| `http-cache-semantics` 4.1.0 | CVE-2022-25881 — <https://nvd.nist.gov/vuln/detail/CVE-2022-25881> | `\s*,\s*` used with `split` | 4.1.1 |
| `path-to-regexp` 0.1.7 | CVE-2024-45296 / GHSA-9wv6-86v2-598j — <https://github.com/advisories/GHSA-9wv6-86v2-598j> | route `/:a-:b` compiles to `^\/(?:([^\/]+?))-(?:([^\/]+?))\/?$` | 0.1.10 |

## 4. Existing linear-time options for JavaScript

| Option | Notes |
|---|---|
| `re2` (node-re2) — <https://github.com/uhop/node-re2> | Native binding to RE2. Fast; Node only (no browser), needs a compiler toolchain or prebuilt binaries; RE2 syntax and semantics differ from JS in places. |
| `re2js` — <https://github.com/le0pard/re2js> | Pure-JS port of RE2/J. Runs in browsers; RE2 semantics rather than JS semantics. |
| `re2-wasm` — <https://github.com/google/re2-wasm> | RE2 compiled to WebAssembly. |
| V8 experimental engine | Correct JS semantics, but behind a flag; not usable in browsers or default Node. |

**Gap this project fills:** a pure TypeScript engine, no native code, running anywhere JS runs, whose goal is *exact JavaScript semantics* (verified by differential fuzzing against V8) for the subset it supports, with a static ReDoS checker alongside.

## 5. JavaScript semantics checked by hand in Node 22 (V8 12.4)

```
/(a*)*/.exec("b")      → ["", undefined]   // empty iteration rejected
/(a*)+/.exec("b")      → ["", ""]          // first iteration is mandatory, no empty check
/(a?)?/.exec("")       → ["", undefined]   // ? is {0,1} and has the empty check too
/((a)|b)+/.exec("ab")  → ["ab","b",undefined] // captures reset each iteration
/(a|)*/.exec("aa")     → ["aa","a"]
```
Duplicate named groups and pattern modifiers `(?i:)` are *not* supported by this V8; the `v` flag is.
