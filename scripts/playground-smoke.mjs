// Loads the built playground in headless Chromium and checks each feature produces output.
// Exits 0 with a notice if Playwright isn't installed (it is optional).
import { createRequire } from 'node:module';
import { serve } from './serve.mjs';

let chromium;
try {
  ({ chromium } = createRequire(import.meta.url)('playwright'));
} catch {
  console.log('SKIP: playwright not available');
  process.exit(0);
}
const server = await serve('dist/playground', 0);
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: process.env.SHOT ? 2 : 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const fail = (msg) => { console.log('FAIL:', msg); process.exitCode = 1; };
try {
  await page.goto(url);
  await page.waitForSelector('#verdict .verdict');
  const status = await page.textContent('#verdict');
  if (!/Risky with ordinary regex engines/.test(status)) fail(`status line: ${status}`);
  if ((await page.locator('#match-out mark').count()) < 1) fail('no highlighted match');

  await page.click('button[data-tab="how"]');
  await page.waitForSelector('#graph svg .node');
  const nodes = await page.locator('#graph svg .node').count();
  const amb = await page.locator('#graph svg .node.culprit').count();
  if (nodes < 3 || amb < 1) fail(`automaton: ${nodes} nodes, ${amb} culprit nodes`);
  if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/automaton.png` });

  await page.click('button[data-tab="check"]');
  await page.click('#checker-go');
  await page.waitForSelector('#checker-out .result');
  const results = await page.locator('#checker-out .result').count();
  const text = await page.textContent('#checker-out');
  if (results !== 6 || !/Risky with ordinary/.test(text) || !/Safe with both engines/.test(text) || !/can't run this pattern/.test(text)) fail(`checker output: ${results} results`);
  if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/checker.png`, fullPage: true });

  await page.click('button[data-tab="race"]');
  await page.locator('details:has(#race-limit) > summary').click();
  await page.selectOption('#race-limit', '1000');
  await page.click('#race-go');
  await page.waitForFunction(() => /gave up/.test(document.querySelector('#race-table').textContent), null, { timeout: 60000 });
  await page.waitForSelector('#race-chart svg path');
  if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/race.png`, fullPage: true });
  await page.click('#race-stop');
  if (errors.length) fail(`console errors: ${errors.join(' | ')}`);
  if (!process.exitCode) console.log(`PASS: playground smoke test (${nodes} automaton nodes, ${results} checker results, built-in engine gave up)`);
} catch (e) {
  fail(String(e));
} finally {
  await browser.close();
  server.close();
}
