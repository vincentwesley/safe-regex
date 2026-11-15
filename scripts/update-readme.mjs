// Rewrites the result tables in README.md from committed result files:
//   bench/results/results.json (bench/run.mjs), bench/results/fuzz.json (scripts/fuzz.mjs --out),
//   bench/results/throughput.md (node bench/throughput.mjs > bench/results/throughput.md)
// Sections live between <!-- NAME:start --> and <!-- NAME:end --> markers.
import { readFileSync, writeFileSync } from 'node:fs';

let readme = readFileSync('README.md', 'utf8');
const put = (name, body) => {
  const re = new RegExp(`<!-- ${name}:start -->[\\s\\S]*?<!-- ${name}:end -->`);
  if (!re.test(readme)) throw new Error(`marker ${name} missing`);
  readme = readme.replace(re, `<!-- ${name}:start -->\n${body.trim()}\n<!-- ${name}:end -->`);
};
const fmtMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms.toFixed(ms < 10 ? 1 : 0)} ms`);
const k = (n) => (n >= 1024 ? `${Math.round(n / 1024)}k` : String(n));

const fuzz = JSON.parse(readFileSync('bench/results/fuzz.json', 'utf8'));
const total = fuzz.comparisons.toLocaleString('en-US');
put('FUZZ', `
| | |
|---|---|
| Random patterns | **${fuzz.patterns.toLocaleString('en-US')}** (${fuzz.patternsFromGrammar.toLocaleString('en-US')} from the grammar, ${fuzz.patternsFromSyntaxSoup.toLocaleString('en-US')} syntax soup) |
| Inputs | ${fuzz.inputs.toLocaleString('en-US')} |
| Comparisons (pattern × input × operation) | **${total}** |
| Passed | **${fuzz.passed.toLocaleString('en-US')}** |
| Failed | **${fuzz.failed}** |
| Generated patterns SafeRegExp refused as unsupported | ${fuzz.unsupportedAmongGenerated} |
| Patterns both engines rejected as invalid | ${fuzz.bothRejectedAsInvalid.toLocaleString('en-US')} |
| V8 deviations from the spec (SafeRegExp matched the spec oracle) | ${fuzz.v8SpecDeviations} |
| Cases skipped because *V8* took over 5 s | ${fuzz.nativeTimeouts} |

Seed ${fuzz.seed}, ${fuzz.node} (V8 ${fuzz.v8}), ${Math.round(fuzz.durationMs / 60000)} min on 4 cores. Raw summary: [bench/results/fuzz.json](bench/results/fuzz.json).`);
readme = readme.replace(/\*\*[\d,]+\*\* comparisons, \d+ failures/, `**${total}** comparisons, ${fuzz.failed} failures`);

const { summary, results } = JSON.parse(readFileSync('bench/results/results.json', 'utf8'));
const rows = results.map((r) => {
  const nat = r.nativeTimeoutAt
    ? `killed after ${summary.budgetMs / 1000} s at n = ${k(r.nativeTimeoutAt)}`
    : `${r.nativeSlope.toFixed(2)} (${fmtMs(r.native.at(-1).ms)} at n = ${k(r.native.at(-1).n)})`;
  return `| ${r.id} | ${r.kind} | ${nat} | **${r.safeSlope.toFixed(2)}** | ${fmtMs(r.safeMsAtMaxN)} at n = ${k(r.safeMaxN)} |`;
});
put('BENCH', `
| Pattern | Class | Built-in RegExp: growth exponent | SafeRegExp: growth exponent | SafeRegExp at the largest input |
|---|---|---|---|---|
${rows.join('\n')}

SafeRegExp was linear (exponent ≤ ${summary.slopeLimit}) on **${summary.safeLinear} of ${summary.entries}**; the largest exponent was ${summary.maxSafeSlope.toFixed(2)}. The built-in engine was super-linear on ${summary.nativeSuperLinear} of ${summary.entries} and had to be killed on ${summary.nativeTimedOut}.`);
put('BENCHENV', `Measured ${summary.date.slice(0, 10)} on ${summary.cpu} (${summary.platform}), ${summary.node}, V8 ${summary.v8}.`);
put('THROUGHPUT', readFileSync('bench/results/throughput.md', 'utf8'));
writeFileSync('README.md', readme);
console.log('README updated');
