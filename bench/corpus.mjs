// ReDoS corpus: patterns from public advisories, outage post-mortems and the OWASP list,
// each with an attack-string generator. Sources and fix versions: docs/RESEARCH.md §2–3.
//
// kind: expected native behaviour ('exponential' or 'polynomial').
// op:   how the pattern is used by the affected code ('test', 'replace', 'split').
// sizes: input sizes n to run (attack(n) has length ~n).

const doubling = (from, to) => {
  const out = [];
  for (let n = from; n <= to; n *= 2) out.push(n);
  return out;
};
const EXP_SIZES = [8, 12, 16, 20, 24, 28, 32, 48, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536];
const POLY_SIZES = doubling(256, 131072);

export const CORPUS = [
  // ---------- OWASP "evil regex" examples ----------
  {
    id: 'owasp-nested-plus', source: 'OWASP ReDoS page: (a+)+', kind: 'exponential',
    pattern: '^(a+)+$', flags: '', op: 'test', attack: (n) => 'a'.repeat(n) + '!', sizes: EXP_SIZES,
  },
  {
    id: 'owasp-letters-star', source: 'OWASP ReDoS page: ([a-zA-Z]+)*', kind: 'exponential',
    pattern: '^([a-zA-Z]+)*$', flags: '', op: 'test', attack: (n) => 'a'.repeat(n) + '1', sizes: EXP_SIZES,
  },
  {
    id: 'owasp-alt-overlap', source: 'OWASP ReDoS page: (a|aa)+', kind: 'exponential',
    pattern: '^(a|aa)+$', flags: '', op: 'test', attack: (n) => 'a'.repeat(n) + '!', sizes: EXP_SIZES,
  },
  {
    id: 'owasp-alt-optional', source: 'OWASP ReDoS page: (a|a?)+', kind: 'exponential',
    pattern: '^(a|a?)+$', flags: '', op: 'test', attack: (n) => 'a'.repeat(n) + '!', sizes: EXP_SIZES,
  },
  {
    id: 'owasp-java-classname', source: 'OWASP Validation Regex Repository: Java class name', kind: 'exponential',
    pattern: '^(([a-z])+.)+[A-Z]([a-z])+$', flags: '', op: 'test', attack: (n) => 'a'.repeat(n) + '!', sizes: EXP_SIZES,
  },
  {
    id: 'owasp-email', source: 'OWASP ReDoS page: email validation regex', kind: 'exponential',
    pattern: '^([a-zA-Z0-9])(([\\-.]|[_]+)?([a-zA-Z0-9]+))*(@){1}[a-z0-9]+[.]{1}(([a-z]{2,3})|([a-z]{2,3}[.]{1}[a-z]{2,3}))$',
    flags: '', op: 'test', attack: (n) => 'a'.repeat(n) + '!', sizes: EXP_SIZES,
  },
  {
    id: 'nested-star', source: 'Cox, "Regular Expression Matching Can Be Simple And Fast": (a*)*b', kind: 'exponential',
    pattern: '(a*)*b', flags: '', op: 'test', attack: (n) => 'a'.repeat(n), sizes: EXP_SIZES,
  },
  // ---------- outages ----------
  {
    id: 'cloudflare-2019', source: 'Cloudflare outage, 2 July 2019 (WAF rule)', kind: 'polynomial',
    pattern: '(?:(?:\\"|\'|\\]|\\}|\\\\|\\d|(?:nan|infinity|true|false|null|undefined|symbol|math)|\\`|\\-|\\+)+[)]*;?((?:\\s|-|~|!|{}|\\|\\||\\+)*.*(?:.*=.*)))',
    flags: '', op: 'test', attack: (n) => '"' + 'x'.repeat(n), sizes: POLY_SIZES,
  },
  {
    id: 'stackoverflow-2016', source: 'Stack Overflow outage, 20 July 2016 (trim regex)', kind: 'polynomial',
    pattern: '^[\\s\\u200c]+|[\\s\\u200c]+$', flags: '', op: 'test', attack: (n) => 'a' + ' '.repeat(n) + 'a', sizes: POLY_SIZES,
  },
  // ---------- npm advisories ----------
  {
    id: 'ms-CVE-2015-8315', source: 'ms 0.7.0, CVE-2015-8315', kind: 'polynomial',
    pattern: '^((?:\\d+)?\\.?\\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|years?|yrs?|y)?$',
    flags: 'i', op: 'test', attack: (n) => '1'.repeat(n) + '!', sizes: POLY_SIZES,
  },
  {
    id: 'trim-CVE-2020-7753', source: 'trim 0.0.1, CVE-2020-7753', kind: 'polynomial',
    pattern: '^\\s*|\\s*$', flags: 'g', op: 'replace', attack: (n) => 'a' + ' '.repeat(n) + 'a', sizes: POLY_SIZES,
  },
  {
    id: 'ansi-regex-CVE-2021-3807', source: 'ansi-regex 5.0.0, CVE-2021-3807', kind: 'polynomial',
    pattern: '[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:[a-zA-Z\\d]*(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)|(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))',
    flags: 'g', op: 'replace', attack: (n) => '\u001B[' + ';'.repeat(n) + '\u0000', sizes: POLY_SIZES,
  },
  {
    id: 'color-string-CVE-2021-29060', source: 'color-string 1.5.4, CVE-2021-29060 (hwb)', kind: 'polynomial',
    pattern: '^hwb\\(\\s*([+-]?\\d*[\\.]?\\d+)(?:deg)?\\s*,\\s*([+-]?[\\d\\.]+)%\\s*,\\s*([+-]?[\\d\\.]+)%\\s*(?:,\\s*([+-]?[\\d\\.]+)\\s*)?\\)$',
    flags: '', op: 'test', attack: (n) => 'hwb(' + '1'.repeat(n) + '!', sizes: POLY_SIZES,
  },
  {
    id: 'glob-parent-CVE-2020-28469', source: 'glob-parent 5.1.1, CVE-2020-28469', kind: 'polynomial',
    pattern: '[\\{\\[].*[\\/]*.*[\\}\\]]$', flags: '', op: 'test', attack: (n) => '{' + '/'.repeat(n), sizes: POLY_SIZES,
  },
  {
    id: 'semver-CVE-2022-25883', source: 'semver 7.5.1, CVE-2022-25883 (TILDETRIM)', kind: 'polynomial',
    pattern: '(\\s*)(?:~>?)\\s+', flags: 'g', op: 'replace', attack: (n) => ' '.repeat(n) + 'x', sizes: POLY_SIZES,
  },
  {
    id: 'cross-spawn-CVE-2024-21538', source: 'cross-spawn 7.0.3, CVE-2024-21538', kind: 'polynomial',
    pattern: '(\\\\*)"', flags: 'g', op: 'replace', attack: (n) => '\\'.repeat(n), sizes: POLY_SIZES,
  },
  {
    id: 'nth-check-CVE-2021-3803', source: 'nth-check 2.0.0, CVE-2021-3803', kind: 'polynomial',
    pattern: '^([+-]?\\d*n)?\\s*(?:([+-]?)\\s*(\\d+))?$', flags: '', op: 'test', attack: (n) => '2n' + ' '.repeat(n) + '!', sizes: POLY_SIZES,
  },
  {
    id: 'normalize-url-CVE-2021-33502', source: 'normalize-url 4.5.0, CVE-2021-33502', kind: 'polynomial',
    pattern: '^data:(.*?),(.*?)(?:#(.*))?$', flags: '', op: 'test', attack: (n) => 'data:' + ','.repeat(n) + '\n', sizes: POLY_SIZES,
  },
  {
    id: 'http-cache-semantics-CVE-2022-25881', source: 'http-cache-semantics 4.1.0, CVE-2022-25881', kind: 'polynomial',
    pattern: '\\s*,\\s*', flags: '', op: 'split', attack: (n) => 'a' + ' '.repeat(n) + 'x', sizes: POLY_SIZES,
  },
  {
    id: 'path-to-regexp-CVE-2024-45296', source: 'path-to-regexp 0.1.7 route "/:a-:b", CVE-2024-45296', kind: 'polynomial',
    pattern: '^\\/(?:([^\\/]+?))-(?:([^\\/]+?))\\/?$', flags: 'i', op: 'test', attack: (n) => '/' + '-'.repeat(n) + '/x', sizes: POLY_SIZES,
  },
];

/** Runs the entry's operation once with the given engine constructor. */
export function runOnce(entry, Ctor, input) {
  const re = new Ctor(entry.pattern, entry.flags);
  switch (entry.op) {
    case 'test': return re.test(input);
    case 'replace': return input.replace(re, '');
    case 'split': return input.split(re).length;
    default: throw new Error(`unknown op ${entry.op}`);
  }
}
