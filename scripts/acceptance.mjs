#!/usr/bin/env node
// Runs every check in docs/ACCEPTANCE.md and prints PASS/FAIL per check.
//   node scripts/acceptance.mjs [--skip-slow]
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const results = [];
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', stdio: 'pipe', shell: false, ...opts });
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function check(id, name, fn) {
  const t = Date.now();
  let ok = false;
  let detail = '';
  try {
    const r = fn();
    ok = r === true || (r && r.ok);
    detail = r && r.detail ? r.detail : '';
  } catch (e) {
    detail = String(e && e.stack ? e.stack.split('\n')[0] : e);
  }
  results.push({ id, name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${name}${detail ? `  — ${detail}` : ''}  (${((Date.now() - t) / 1000).toFixed(1)} s)`);
}
const tail = (r) => (r.stdout + r.stderr).trim().split('\n').slice(-3).join(' | ');

check('A1', 'lint passes', () => {
  const r = run(npm, ['run', 'lint']);
  return { ok: r.status === 0, detail: r.status ? tail(r) : '' };
});

check('A2', 'build produces ESM, CJS, types and playground', () => {
  const r = run(npm, ['run', 'build']);
  const files = ['dist/esm/index.js', 'dist/cjs/index.js', 'dist/types/index.d.ts', 'dist/playground/index.html', 'dist/playground/app.js'];
  const missing = files.filter((f) => !existsSync(f));
  return { ok: r.status === 0 && missing.length === 0, detail: missing.length ? `missing ${missing.join(', ')}` : '' };
});

check('A3', 'unit tests pass', () => {
  const r = run(npm, ['test']);
  return { ok: r.status === 0, detail: r.status ? tail(r) : '' };
});

check('A4', 'no host regex in the core, no runtime dependencies', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.ts')) {
        const lines = readFileSync(p, 'utf8').split('\n');
        lines.forEach((line, i) => {
          const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
          // `RegExp(` constructor calls (instanceof RegExp is allowed: it only inspects a type).
          if (/\bRegExp\s*\(/.test(code)) offenders.push(`${p}:${i + 1}`);
          // A regex literal: `/.../flags` after an operator or bracket.
          if (/(^|[=(,:!&|?{};]|return)\s*\/(?![/*])(\\.|[^/\n])+\/[dgimsuyv]*\s*(\.|[,;)\]}]|$)/.test(code)) offenders.push(`${p}:${i + 1}`);
        });
      }
    }
  };
  walk('src');
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const deps = Object.keys(pkg.dependencies ?? {});
  return { ok: offenders.length === 0 && deps.length === 0, detail: [...offenders, ...deps].join(', ') };
});

check('A5', 'differential fuzzing: 20 000 patterns, 0 mismatches', () => {
  const r = run(process.execPath, ['scripts/fuzz.mjs', '--cases', '20000', '--seed', '1'], { timeout: 900000 });
  const m = r.stdout.match(/\{[\s\S]*?\n\}/);
  const s = m ? JSON.parse(m[0]) : {};
  return { ok: r.status === 0 && s.failed === 0 && s.unsupportedAmongGenerated === 0, detail: `${s.comparisons} comparisons, ${s.passed} passed, ${s.failed} failed, ${s.v8SpecDeviations} V8 spec deviations, ${s.nativeTimeouts} native timeouts` };
});

check('A6', 'linear time on known ReDoS patterns (quick benchmark)', () => {
  const out = join(tmpdir(), `bench-${process.pid}.json`);
  const r = run(process.execPath, ['bench/run.mjs', '--quick', '--out', out], { timeout: 1800000 });
  const { summary } = JSON.parse(readFileSync(out, 'utf8'));
  rmSync(out, { force: true });
  const ok = summary.safeLinear === summary.entries && summary.nativeSuperLinear >= 0.8 * summary.entries;
  return { ok: ok && r.status === 0, detail: `SafeRegExp linear on ${summary.safeLinear}/${summary.entries} (max slope ${summary.maxSafeSlope.toFixed(2)}), native super-linear on ${summary.nativeSuperLinear}/${summary.entries}` };
});

check('A7', 'unsupported features rejected with a reason', () => {
  const code = `
    import { SafeRegExp, SafeRegexUnsupportedError } from './dist/esm/index.js';
    const cases = [['(a)\\\\1',''],['(?<x>a)\\\\k<x>',''],['(?<=a)b',''],['(?<!a)b',''],['(?=a)',''],['(?!a)',''],['\\\\p{L}','u'],['a','v']];
    let bad = [];
    for (const [p, f] of cases) {
      try { new SafeRegExp(p, f); bad.push(p); }
      catch (e) { if (!(e instanceof SafeRegexUnsupportedError) || !/not supported/.test(e.message) || !/: /.test(e.message)) bad.push(p); }
    }
    console.log(JSON.stringify(bad));`;
  const r = run(process.execPath, ['--input-type=module', '-e', code]);
  const bad = JSON.parse(r.stdout.trim() || '["error"]');
  return { ok: bad.length === 0, detail: bad.join(' ') };
});

check('A8', 'ReDoS checker flags every corpus entry and passes every safe fixture', () => {
  const r = run(process.execPath, ['--test', 'test/analyze.test.mjs']);
  return { ok: r.status === 0, detail: r.status ? tail(r) : '' };
});

check('A9', 'String methods give native results', () => {
  const r = run(process.execPath, ['--test', 'test/api.test.mjs']);
  return { ok: r.status === 0, detail: r.status ? tail(r) : '' };
});

check('A10', 'installable package: npm pack, then import and require', () => {
  const dir = mkdtempSync(join(tmpdir(), 'safe-regex-pack-'));
  try {
    const p = run(npm, ['pack', '--pack-destination', dir]);
    if (p.status !== 0) return { ok: false, detail: tail(p) };
    const tgz = readdirSync(dir).find((f) => f.endsWith('.tgz'));
    writeFileSync(join(dir, 'package.json'), '{"name":"consumer","version":"1.0.0","private":true}');
    const i = run(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund', join(dir, tgz)], { cwd: dir });
    if (i.status !== 0) return { ok: false, detail: tail(i) };
    const esm = run(process.execPath, ['--input-type=module', '-e', "import { SafeRegExp } from '@vincentwesley/safe-regex'; console.log(new SafeRegExp('(a+)+$').test('a'.repeat(5e4)+'!'))"], { cwd: dir });
    const cjs = run(process.execPath, ['-e', "const { SafeRegExp } = require('@vincentwesley/safe-regex'); console.log(new SafeRegExp('b(c)').exec('abc')[1])"], { cwd: dir });
    return { ok: esm.stdout.trim() === 'false' && cjs.stdout.trim() === 'c', detail: `esm: ${esm.stdout.trim() || esm.stderr.trim()}, cjs: ${cjs.stdout.trim() || cjs.stderr.trim()}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

check('A11', 'repository hygiene files exist and no secrets are committed', () => {
  const required = ['LICENSE', 'SECURITY.md', 'CHANGELOG.md', 'README.md', 'CONTRIBUTING.md', '.github/workflows/ci.yml',
    'docs/RESEARCH.md', 'docs/DECISIONS.md', 'docs/PLAN.md', 'docs/ACCEPTANCE.md', 'docs/HANDOVER.md', 'docs/NEEDS-VIN.md'];
  const missing = required.filter((f) => !existsSync(f));
  const mit = existsSync('LICENSE') && readFileSync('LICENSE', 'utf8').startsWith('MIT License');
  const files = run('git', ['ls-files']).stdout.split('\n').filter(Boolean);
  const secretRe = [/AKIA[0-9A-Z]{16}/, /gh[pousr]_[A-Za-z0-9]{36}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /xox[baprs]-[A-Za-z0-9-]{10,}/, /npm_[A-Za-z0-9]{36}/];
  const leaks = [];
  for (const f of files) {
    if (!existsSync(f) || statSync(f).size > 2e6) continue;
    const text = readFileSync(f, 'utf8');
    if (secretRe.some((re) => re.test(text))) leaks.push(f);
  }
  return { ok: missing.length === 0 && mit && leaks.length === 0, detail: [...missing.map((m) => `missing ${m}`), ...leaks.map((l) => `secret-like text in ${l}`), mit ? '' : 'LICENSE is not MIT'].filter(Boolean).join(', ') };
});

check('A12', 'playground loads and works in headless Chromium', () => {
  const r = run(process.execPath, ['scripts/playground-smoke.mjs'], { timeout: 180000 });
  return { ok: r.status === 0, detail: (r.stdout + r.stderr).trim().split('\n').pop() };
});

check('A13', 'README lists every unsupported feature code', () => {
  const readme = readFileSync('README.md', 'utf8');
  const codes = [...readFileSync('src/errors.ts', 'utf8').matchAll(/\| '([a-z-]+)'/g)].map((m) => m[1]);
  const missing = codes.filter((c) => !readme.includes('`' + c + '`'));
  return { ok: codes.length > 0 && missing.length === 0, detail: missing.join(', ') };
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} acceptance checks passed.`);
process.exit(failed.length ? 1 : 0);
