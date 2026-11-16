import { SafeRegExp, analyze, attackString, buildNfa, checkSupport, OP_NAMES } from '../src/index.ts';
import { initThemeToggle } from './house/js/theme.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const SVGNS = 'http://www.w3.org/2000/svg';

initThemeToggle($('theme-toggle'));

// [group, friendly name, pattern, flags, sample text]
const EXAMPLES = [
  ['risky', 'Classic nested repeat (OWASP example)', '^(a+)+$', 'g', 'aaaaaaaa'],
  ['risky', 'Overlapping choices (OWASP example)', '^(a|aa)+$', 'g', 'aaaaaa'],
  ['risky', 'Email checker (OWASP example)', '^([a-zA-Z0-9])(([\\-.]|[_]+)?([a-zA-Z0-9]+))*(@){1}[a-z0-9]+[.]{1}(([a-z]{2,3})|([a-z]{2,3}[.]{1}[a-z]{2,3}))$', 'g', 'someone@example.com'],
  ['risky', 'Stack Overflow outage, 2016', '^[\\s\\u200c]+|[\\s\\u200c]+$', 'g', '   hello world   '],
  ['risky', 'Cloudflare outage, 2019 (excerpt)', '.*(?:.*=.*)', 'g', 'name=value'],
  ['risky', 'ms package vulnerability (CVE-2015-8315)', '^((?:\\d+)?\\.?\\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|years?|yrs?|y)?$', 'gi', '100 ms'],
  ['risky', 'normalize-url vulnerability (CVE-2021-33502)', '^data:(.*?),(.*?)(?:#(.*))?$', 'g', 'data:text/plain,hello'],
  ['safe', 'A date like 2026-11-16', '^(?<y>\\d{4})-(?<m>\\d\\d)-(?<d>\\d\\d)$', 'g', '2026-11-16'],
  ['safe', 'A website name like www.example.com', '^(?:[a-z0-9]+\\.)*[a-z]+$', 'gi', 'www.example.com'],
];

const SAFE_LINE = '✓ Safe with SafeRegExp: it always finishes in time proportional to the length of the text.';
const VALID_FLAGS = 'dgimsuvy';
// g and y only change how repeated searches continue, not backtracking; analyze() validates its attack with exec(), where a g flag would make the check stateful.
const forAnalysis = (flags) => flags.replace(/[gy]/g, '');

// ---------------- tabs ----------------
const TABS = ['match', 'race', 'check', 'how'];
const ALIAS = { checker: 'check', automaton: 'how' };
const tabEls = TABS.map((t) => $(`tab-${t}`));
let activeTab = 'match';

function selectTab(name, { focus = false, hash = true } = {}) {
  name = ALIAS[name] ?? name;
  if (!TABS.includes(name)) name = 'match';
  activeTab = name;
  for (const t of TABS) {
    const on = t === name;
    const tab = $(`tab-${t}`);
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    $(`panel-${t}`).hidden = !on;
  }
  if (focus) $(`tab-${name}`).focus();
  if (hash) {
    try { history.replaceState(null, '', `#${name}`); } catch { /* sandboxed: the hash stays as is */ }
  }
  if (name === 'how') renderAutomaton();
  if (name === 'race') prepareRace();
}
for (const tab of tabEls) tab.addEventListener('click', () => selectTab(tab.dataset.tab));
$('tabs').querySelector('[role="tablist"]').addEventListener('keydown', (e) => {
  const i = tabEls.indexOf(document.activeElement);
  if (i < 0) return;
  const n = TABS.length;
  const next = { ArrowRight: (i + 1) % n, ArrowLeft: (i + n - 1) % n, Home: 0, End: n - 1 }[e.key];
  if (next === undefined) return;
  e.preventDefault();
  selectTab(TABS[next], { focus: true });
});
addEventListener('hashchange', () => {
  const h = location.hash.slice(1);
  if ((ALIAS[h] ?? h) !== activeTab && (TABS.includes(h) || ALIAS[h])) selectTab(h, { hash: false });
});

// ---------------- pattern state ----------------
const sel = $('examples');
const group = (g, label) => `<optgroup label="${label}">${EXAMPLES.map((e, i) => (e[0] === g ? `<option value="${i}">${esc(e[1])}</option>` : '')).join('')}</optgroup>`;
sel.innerHTML = group('risky', 'Risky patterns (from real incidents)') + group('safe', 'Safe patterns') + '<option value="custom" hidden>Your own pattern</option>';
sel.value = '0';
const boxes = [...document.querySelectorAll('[data-flag]')];

function loadExample(i) {
  const e = EXAMPLES[i];
  if (!e) return;
  $('pattern').value = e[2];
  $('flags').value = e[3];
  $('subject').value = e[4];
  syncBoxes();
  update();
}
sel.addEventListener('change', () => loadExample(Number(sel.value)));

function syncBoxes() {
  const f = $('flags').value;
  for (const b of boxes) b.checked = f.includes(b.dataset.flag);
}
for (const b of boxes) {
  b.addEventListener('change', () => {
    const known = boxes.map((x) => x.dataset.flag);
    const extras = [...$('flags').value].filter((c) => !known.includes(c));
    $('flags').value = boxes.filter((x) => x.checked).map((x) => x.dataset.flag).join('') + extras.join('');
    update();
  });
}
$('flags').addEventListener('input', () => { syncBoxes(); update(); });
$('pattern').addEventListener('input', () => { sel.value = 'custom'; update(); });
$('subject').addEventListener('input', renderMatches);

function checkFlags(flags) {
  const bad = [...new Set([...flags].filter((c) => !VALID_FLAGS.includes(c)))];
  if (bad.length) return `“${bad.join('')}” is not a flag. Flags are single letters from ${[...VALID_FLAGS].join(', ')}.`;
  if (new Set(flags).size !== flags.length) return 'Each flag letter can only be used once.';
  return '';
}

let current = null; // { re, pattern, flags, report } or null

function update() {
  const pattern = $('pattern').value;
  const flags = $('flags').value;
  const msg = checkFlags(flags);
  const fm = $('flags-msg');
  fm.textContent = msg;
  fm.classList.toggle('bad', Boolean(msg));
  $('flags').setAttribute('aria-invalid', String(Boolean(msg)));
  current = null;
  let html;
  if (msg) {
    html = infoCard('The options need a fix', `<p>${esc(msg)}</p>`);
  } else if (pattern === '') {
    html = infoCard('Type or pick a pattern', '<p>Choose an example above, or type your own pattern in the box, and the verdict appears here.</p>');
  } else {
    let s;
    try { s = checkSupport(pattern, flags); } catch (err) { s = { ok: false, kind: 'syntax', message: String(err && err.message) }; }
    if (!s.ok) {
      html = supportCard(s);
    } else {
      current = { re: new SafeRegExp(pattern, flags), pattern, flags, report: analyze(pattern, forAnalysis(flags)) };
      html = verdictCard(current.report, { pattern, flags, button: 'Watch it happen' });
    }
  }
  $('verdict').innerHTML = html;
  renderMatches();
  if (activeTab === 'how') renderAutomaton();
  if (activeTab === 'race') prepareRace();
}

$('verdict').addEventListener('click', (e) => {
  if (!e.target.closest('[data-action="watch"]')) return;
  selectTab('race');
  startRace();
});

// ---------------- verdict wording ----------------
function infoCard(title, body, cls = 'verdict--info') {
  return `<div class="verdict ${cls}"><h3>${esc(title)}</h3>${body}</div>`;
}

function supportCard(s) {
  let body = `<p>${esc(s.message)}</p>`;
  if (s.kind === 'unsupported') {
    body += '<p>SafeRegExp leaves out backreferences, lookaround, <code>\\p{…}</code> and the <code>v</code> flag. They can\'t be guaranteed to finish quickly, or aren\'t supported yet. The built-in engine can still run this pattern, but without the freeze protection.</p>';
    return infoCard('SafeRegExp can\'t run this pattern', body);
  }
  if (s.kind === 'syntax') return infoCard('This isn\'t a valid pattern yet', `${body}<p>Check for a missing bracket or a stray symbol.</p>`);
  return infoCard('SafeRegExp can\'t run this pattern', body);
}

function patHtml(r, pattern, flags) {
  let out = '';
  let pos = 0;
  for (const c of [...r.culprits].sort((a, b) => a.start - b.start)) {
    if (c.start < pos) continue;
    out += `${esc(pattern.slice(pos, c.start))}<mark>${esc(pattern.slice(c.start, c.end))}</mark>`;
    pos = c.end;
  }
  return `/${out}${esc(pattern.slice(pos))}/${esc(flags)}`;
}

function techBlock(r, pattern, flags) {
  let t = `<span class="tech-label">Technical detail</span><p><strong>${esc(r.summary)}.</strong> ${esc(r.explanation)}</p>`;
  if (r.degree) t += `<p>Growth: O(n^${r.degree}). Doubling the text length multiplies the time by about ${2 ** r.degree}.</p>`;
  t += `<code class="pat">${patHtml(r, pattern, flags)}</code>`;
  if (r.attack) t += `<p class="mono">Tricky text: ${esc(JSON.stringify(r.attack.prefix))} + ${esc(JSON.stringify(r.attack.pump))} × n + ${esc(JSON.stringify(r.attack.suffix))}${r.validated ? '' : ' (not confirmed)'}</p>`;
  return `<div class="tech">${t}</div>`;
}

function verdictCard(r, { pattern, flags, button, compact = false }) {
  const cls = compact ? ' compact' : '';
  const action = (a) => `<div class="verdict-actions"><button type="button" class="hs-btn" data-action="${a}">${esc(button)}</button><span class="confirm-out" role="status"></span></div>`;
  const label = compact ? `<code class="pat">${patHtml(r, pattern, flags)}</code>` : '';
  if (r.status === 'exponential' || r.status === 'polynomial') {
    const exp = r.status === 'exponential';
    const body = exp
      ? 'With the regex engine built into browsers and Node.js, a specially crafted text of just a few dozen characters can make this pattern run for minutes and freeze the page or server.'
      : 'With the regex engine built into browsers and Node.js, a long text (thousands of characters) can make this pattern take seconds to check, which can slow down a page or server.';
    return `<div class="verdict verdict--risk${cls}">${label}<h3>${exp ? '⚠ Risky with ordinary regex engines' : 'Can be slow with ordinary regex engines'}</h3>
      <p>${body}</p>
      <p class="reassure">${SAFE_LINE}</p>
      <details><summary>What should I do?</summary>
        <p>Use <code>SafeRegExp</code> instead of <code>RegExp</code> for this pattern, or rewrite the pattern so the same text can't be matched in more than one way.</p>
        ${techBlock(r, pattern, flags)}
      </details>
      ${action(compact ? 'confirm' : 'watch')}</div>`;
  }
  if (r.status === 'safe') {
    return `<div class="verdict verdict--ok${cls}">${label}<h3>✓ Safe with both engines</h3>
      <p>Our checker found no way to make this pattern slow, so it stays fast in the built-in engine and in SafeRegExp, however long the text is.</p>
      <details><summary>Technical detail</summary>${techBlock(r, pattern, flags)}</details></div>`;
  }
  if (r.status === 'too-complex') {
    return `<div class="verdict verdict--info${cls}">${label}<h3>Couldn't fully check this pattern</h3>
      <p>${esc(r.explanation)}</p>
      <p class="reassure">✓ SafeRegExp still matches it in time proportional to the length of the text.</p></div>`;
  }
  if (r.status === 'unsupported') {
    return `<div class="verdict verdict--info${cls}">${label}<h3>SafeRegExp can't run this pattern</h3>
      <p>${esc(r.explanation)}</p>
      <p>SafeRegExp leaves out backreferences, lookaround, <code>\\p{…}</code> and the <code>v</code> flag. They can't be guaranteed to finish quickly, or aren't supported yet, so this checker can't tell whether the pattern is risky.</p></div>`;
  }
  if (r.status === 'invalid') {
    return `<div class="verdict verdict--info${cls}">${label}<h3>This isn't a valid pattern</h3><p>${esc(r.explanation)}</p></div>`;
  }
  return `<div class="verdict verdict--info${cls}">${label}<h3>Couldn't fully check this pattern</h3><p>${esc(r.summary)}. ${esc(r.explanation)}</p></div>`;
}

// ---------------- match tab ----------------
function renderMatches() {
  const out = $('match-out');
  const sum = $('match-summary');
  const gwrap = $('groups-wrap');
  const gout = $('groups-out');
  gwrap.hidden = true;
  if (!current) {
    out.textContent = '';
    gout.innerHTML = '';
    sum.textContent = 'Pick or type a valid pattern above to see matches.';
    return;
  }
  const s = $('subject').value;
  if (s === '') {
    out.textContent = '';
    gout.innerHTML = '';
    sum.textContent = 'Type or paste some text above to search it.';
    return;
  }
  const all = current.flags.includes('g');
  const re = new SafeRegExp(current.pattern, all ? current.flags : current.flags + 'g');
  const matches = [];
  let m;
  const t = performance.now();
  while ((m = re.exec(s)) !== null && matches.length < (all ? 1000 : 1)) {
    matches.push(m);
    if (m[0] === '') re.lastIndex++;
  }
  const ms = performance.now() - t;
  let html = '';
  let pos = 0;
  for (const mm of matches) {
    html += esc(s.slice(pos, mm.index));
    html += mm[0] === '' ? '<mark class="empty"></mark>' : `<mark>${esc(mm[0])}</mark>`;
    pos = mm.index + mm[0].length;
  }
  html += esc(s.slice(pos));
  out.innerHTML = html;
  sum.textContent = matches.length
    ? `Found ${matches.length} match${matches.length === 1 ? '' : 'es'} (${ms.toFixed(2)} ms).${all ? '' : ' "Find every match" is off, so only the first one is shown.'}`
    : 'No matches.';
  const names = current.re.program.groupNames;
  const n = current.re.program.groupCount;
  if (!matches.length) {
    gout.innerHTML = '';
    return;
  }
  let table = '<div class="table-scroll"><table class="data"><thead><tr><th scope="col">Match number</th><th scope="col">Position</th>';
  for (let g = 0; g < n; g++) table += `<th scope="col">${g === 0 ? 'Whole match' : esc(names[g] ? `Group ${g} (${names[g]})` : `Group ${g}`)}</th>`;
  table += '</tr></thead><tbody>';
  matches.slice(0, 50).forEach((mm, i) => {
    table += `<tr><td>${i + 1}</td><td>${mm.index}</td>`;
    for (let g = 0; g < n; g++) table += `<td class="mono">${mm[g] === undefined ? '<em>not found</em>' : esc(JSON.stringify(mm[g]))}</td>`;
    table += '</tr>';
  });
  table += '</tbody></table></div>';
  gout.innerHTML = table;
  gwrap.hidden = false;
}

// ---------------- automaton ("How it works") ----------------
function renderAutomaton() {
  const host = $('graph');
  const pre = $('program');
  if (!current) {
    host.innerHTML = '<p class="hint pad">Pick or type a valid pattern to see its diagram.</p>';
    pre.textContent = '';
    return;
  }
  const prog = current.re.program;
  pre.textContent = Array.from(prog.ops, (op, pc) => {
    const a = prog.arg1[pc];
    const b = prog.arg2[pc];
    let arg = '';
    if (OP_NAMES[op] === 'CHAR') arg = JSON.stringify(String.fromCodePoint(a));
    else if (OP_NAMES[op] === 'SET') arg = `#${a} ${current.pattern.slice(prog.spans[2 * pc], prog.spans[2 * pc + 1])}`;
    else if (OP_NAMES[op] === 'SPLIT') arg = `${a}, ${b}`;
    else if (OP_NAMES[op] === 'CLEAR') arg = `slots ${a}..${b - 1}`;
    else if (OP_NAMES[op] !== 'MATCH') arg = String(a);
    return `${String(pc).padStart(4)}  ${OP_NAMES[op].padEnd(10)}${arg}`;
  }).join('\n');

  const nfa = buildNfa(prog, { unanchoredRetry: false });
  const N = nfa.states.length;
  if (N > 160) {
    host.innerHTML = `<p class="hint pad">The diagram has ${N} steps, too many to draw legibly. The program listing below still shows it.</p>`;
    return;
  }
  // Layers by BFS depth from the start state.
  const depth = new Array(N).fill(-1);
  depth[0] = 0;
  const q = [0];
  while (q.length) {
    const v = q.shift();
    for (const e of nfa.out[v]) if (depth[e.to] < 0) { depth[e.to] = depth[v] + 1; q.push(e.to); }
  }
  const ACCEPT = N;
  const reachable = [...Array(N).keys()].filter((v) => depth[v] >= 0);
  const maxD = Math.max(...reachable.map((v) => depth[v]));
  depth[ACCEPT] = maxD + 1;
  const layers = [];
  for (const v of [...reachable, ACCEPT]) (layers[depth[v]] ??= []).push(v);
  const label = (v) => {
    if (v === 0) return 'start';
    if (v === ACCEPT) return 'match';
    const [a, b] = nfa.states[v].span;
    const t = current.pattern.slice(a, b);
    return t.length > 12 ? t.slice(0, 11) + '…' : t;
  };
  const W = (v) => Math.max(36, label(v).length * 7.4 + 16);
  const colW = 150;
  const rowH = 64;
  const maxRows = Math.max(...layers.map((l) => l.length));
  const height = Math.max(160, maxRows * rowH + 120);
  const pos = [];
  layers.forEach((l, d) => l.forEach((v, i) => {
    pos[v] = { x: 60 + d * colW, y: height / 2 + (i - (l.length - 1) / 2) * rowH };
  }));
  const width = 120 + (layers.length - 1) * colW;
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Diagram of the pattern with ${reachable.length - 1} character steps`);
  const marker = (id, cls) => `<marker id="${id}" class="${cls}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z"/></marker>`;
  let html = `<defs>${marker('arrow', 'arrow')}${marker('arrow-hot', 'arrow-hot')}</defs>`;
  const edges = [];
  for (const v of reachable) {
    for (const e of nfa.out[v]) edges.push([v, e.to, e.mult]);
    if (nfa.acceptMult[v] > 0) edges.push([v, ACCEPT, nfa.acceptMult[v]]);
  }
  for (const [a, b, mult] of edges) {
    const p = pos[a];
    const r = pos[b];
    const cls = `edge${mult > 1 ? ' ambiguous' : ''}`;
    let d;
    let lx;
    let ly;
    if (a === b) {
      const w = W(a) / 2;
      d = `M${p.x - 8},${p.y - 14} C${p.x - w},${p.y - 60} ${p.x + w},${p.y - 60} ${p.x + 8},${p.y - 14}`;
      lx = p.x;
      ly = p.y - 52;
    } else if (depth[b] > depth[a]) {
      const x1 = p.x + W(a) / 2;
      const x2 = r.x - W(b) / 2 - 2;
      const mx = (x1 + x2) / 2;
      d = `M${x1},${p.y} C${mx},${p.y} ${mx},${r.y} ${x2},${r.y}`;
      lx = mx;
      ly = (p.y + r.y) / 2 - 6;
    } else {
      // back (or same-layer) edge: arc below
      const dip = 40 + Math.abs(depth[a] - depth[b]) * 18;
      const y0 = Math.max(p.y, r.y) + 14;
      d = `M${p.x},${p.y + 14} C${p.x},${y0 + dip} ${r.x},${y0 + dip} ${r.x},${r.y + 16}`;
      lx = (p.x + r.x) / 2;
      ly = y0 + dip * 0.75;
    }
    html += `<path class="${cls}" d="${d}" marker-end="url(#${mult > 1 ? 'arrow-hot' : 'arrow'})"/>`;
    if (mult > 1) html += `<text class="edge-label" x="${lx}" y="${ly}" text-anchor="middle">×2</text>`;
  }
  for (const v of [...reachable, ACCEPT]) {
    const { x, y } = pos[v];
    const w = W(v);
    const span = v > 0 && v < ACCEPT ? nfa.states[v].span.join(',') : '';
    const rx = v === 0 || v === ACCEPT ? 14 : 6;
    const sp = v > 0 && v < ACCEPT ? nfa.states[v].span : null;
    const blamed = sp && (current.report?.culprits ?? []).some((c) => sp[0] >= c.start && sp[1] <= c.end);
    html += `<g class="node${blamed ? ' culprit' : ''}" data-span="${span}" tabindex="0"><title>${esc(v === 0 ? 'start' : v === ACCEPT ? 'match succeeds' : `reads ${label(v)} (pattern position ${span})`)}</title>`;
    html += `<rect${v === ACCEPT ? ' class="accept"' : ''} x="${x - w / 2}" y="${y - 14}" width="${w}" height="28" rx="${rx}"/>`;
    html += `<text x="${x}" y="${y + 4}" text-anchor="middle">${esc(label(v))}</text></g>`;
  }
  svg.innerHTML = html;
  host.replaceChildren(svg);
  const input = $('pattern');
  for (const g of svg.querySelectorAll('.node')) {
    const show = () => {
      const [a, b] = (g.dataset.span || '').split(',').map(Number);
      if (Number.isFinite(a)) input.setSelectionRange(a, b);
    };
    g.addEventListener('mouseenter', show);
    g.addEventListener('focus', show);
  }
}

// ---------------- race tab ----------------
let raceWorkers = { native: null, safe: null };
let raceRun = 0;
let racing = false;

function prepareRace() {
  if (racing) return;
  const note = $('race-note');
  $('race-go').disabled = !current;
  if (!current) {
    note.textContent = 'Pick or type a valid pattern first (step 1), then come back and start the race.';
    return;
  }
  const r = current.report;
  if (r?.attack) {
    $('atk-prefix').value = r.attack.prefix;
    $('atk-pump').value = r.attack.pump;
    $('atk-suffix').value = r.attack.suffix;
    note.textContent = r.status === 'safe'
      ? 'This pattern looks safe, so both lines should stay low.'
      : 'This pattern looks risky: expect the built-in engine to slow down or give up while SafeRegExp stays fast.';
  } else {
    if (!$('atk-pump').value) $('atk-pump').value = 'a';
    note.textContent = r?.status === 'safe'
      ? 'This pattern looks safe, so both lines should stay low. Press start to check.'
      : 'We have no ready-made tricky text for this pattern. You can still run the race, or write your own text under "Advanced".';
  }
}

function worker(kind) {
  if (!raceWorkers[kind]) raceWorkers[kind] = new Worker(new URL('./race-worker.js', import.meta.url), { type: 'module' });
  return raceWorkers[kind];
}

function timeOne(kind, job, limit) {
  return new Promise((resolve) => {
    const w = worker(kind);
    const id = Math.random();
    const timer = setTimeout(() => {
      w.terminate();
      raceWorkers[kind] = null;
      resolve({ timeout: true });
    }, limit);
    w.onmessage = (e) => {
      if (e.data.id !== id) return;
      clearTimeout(timer);
      resolve(e.data);
    };
    w.postMessage({ ...job, id, engine: kind });
  });
}

const fmtMs = (ms) => (ms < 1 ? `${ms.toFixed(2)} ms` : ms < 1000 ? `${ms.toFixed(1)} ms` : `${(ms / 1000).toFixed(1)} s`);

$('race-stop').addEventListener('click', () => {
  raceRun++;
  racing = false;
  $('race-go').disabled = !current;
  $('race-progress').textContent = '';
  setSummary('Race stopped.', false);
});
$('race-go').addEventListener('click', startRace);

function setSummary(text, risk) {
  const el = $('race-summary');
  el.textContent = text;
  el.classList.toggle('risk', risk);
}

async function startRace() {
  if (!current) return;
  const run = ++raceRun;
  racing = true;
  $('race-go').disabled = true;
  setSummary('', false);
  const limit = Number($('race-limit').value);
  const base = { pattern: current.pattern, flags: current.flags, prefix: $('atk-prefix').value, pump: $('atk-pump').value || 'a', suffix: $('atk-suffix').value };
  const tbody = $('race-table').querySelector('tbody');
  tbody.innerHTML = '';
  $('race-chart').innerHTML = '';
  const points = { safe: [], native: [] };
  let nativeDead = false;
  let failed = '';
  const sizes = [];
  for (let n = 4; n <= 1 << 17; n = Math.ceil(n * 1.5)) sizes.push(n);
  let step = 0;
  for (const n of sizes) {
    if (run !== raceRun) return;
    const job = { ...base, n };
    const len = base.prefix.length + base.pump.length * n + base.suffix.length;
    if (len > 400000) break;
    $('race-progress').textContent = `Testing a text of ${len.toLocaleString()} characters…`;
    const s = await timeOne('safe', job, 60000);
    let nat = { skipped: true };
    if (!nativeDead) {
      nat = await timeOne('native', job, limit);
      if (nat.timeout) nativeDead = true;
    }
    if (run !== raceRun) return;
    step++;
    if (s.ms !== undefined) points.safe.push({ n: len, ms: s.ms });
    if (nat.ms !== undefined) points.native.push({ n: len, ms: nat.ms });
    if (nat.timeout) points.nativeTimeout = { n: len, ms: limit };
    const fmt = (r) => (r.error ? esc(r.error) : r.timeout ? `<strong>gave up after ${limit / 1000} s</strong>` : r.skipped ? '—' : fmtMs(r.ms));
    tbody.insertAdjacentHTML('beforeend', `<tr><td>${step}</td><td>${len.toLocaleString()}</td><td>${fmt(s)}</td><td>${fmt(nat)}</td></tr>`);
    drawRaceChart(points, limit);
    if (s.error) { failed = s.error; break; }
    if (s.ms > 3000) break;
  }
  racing = false;
  $('race-go').disabled = false;
  $('race-progress').textContent = '';
  if (failed) {
    setSummary(`The race could not run: ${failed}`, true);
    return;
  }
  const lastSafe = points.safe.at(-1);
  const lastNat = points.native.at(-1);
  const t = points.nativeTimeout;
  if (t) {
    const sp = points.safe.find((p) => p.n === t.n);
    setSummary(`Built-in engine: gave up after ${limit / 1000} s on a ${t.n.toLocaleString()}-character text. SafeRegExp: ${sp ? fmtMs(sp.ms) : 'finished'} on the same text.`, true);
  } else if (lastNat && lastSafe && lastNat.ms > 50 && lastNat.ms > lastSafe.ms * 10) {
    setSummary(`Built-in engine: slowed down to ${fmtMs(lastNat.ms)} on a ${lastNat.n.toLocaleString()}-character text. SafeRegExp: ${fmtMs(lastSafe.ms)} on the same text.`, true);
  } else if (current.report?.status === 'safe') {
    setSummary('Both engines stayed fast, so this pattern is safe.', false);
  } else {
    setSummary('Both engines stayed fast on this text. Try another tricky text under "Advanced", or a longer time limit.', false);
  }
}

function drawRaceChart(points, limit) {
  const host = $('race-chart');
  const all = [...points.safe, ...points.native, ...(points.nativeTimeout ? [points.nativeTimeout] : [])];
  if (!all.length) return;
  const W = Math.max(260, Math.min(host.clientWidth || 800, 900));
  const H = 300;
  const m = { l: 74, r: 20, t: 10, b: 52 };
  const xs = all.map((p) => Math.log10(p.n));
  const ys = all.map((p) => Math.log10(Math.max(p.ms, 0.001)));
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs, x0 + 1);
  const y0 = Math.floor(Math.min(...ys));
  const y1 = Math.max(Math.ceil(Math.max(...ys, Math.log10(limit))), y0 + 1);
  const X = (n) => m.l + ((Math.log10(n) - x0) / (x1 - x0)) * (W - m.l - m.r);
  const Y = (ms) => H - m.b - ((Math.log10(Math.max(ms, 0.001)) - y0) / (y1 - y0)) * (H - m.t - m.b);
  let g = '';
  for (let e = y0; e <= y1; e++) {
    const y = Y(10 ** e);
    g += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}"/>`;
    g += `<text x="${m.l - 6}" y="${y + 4}" text-anchor="end">${e >= 3 ? `${10 ** (e - 3)} s` : `${10 ** e} ms`}</text>`;
  }
  for (let e = Math.ceil(x0); e <= Math.floor(x1); e++) {
    g += `<text x="${X(10 ** e)}" y="${H - m.b + 16}" text-anchor="middle">${(10 ** e).toLocaleString()}</text>`;
  }
  g += `<text x="${(W + m.l) / 2}" y="${H - 6}" text-anchor="middle">text length (characters)</text>`;
  g += `<text transform="translate(12 ${(H - m.b + m.t) / 2}) rotate(-90)" text-anchor="middle">time taken</text>`;
  const line = (pts, cls) => (pts.length ? `<path class="${cls}" d="${pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.n)},${Y(p.ms)}`).join('')}"/>` : '');
  g += line(points.native, 's-native');
  g += line(points.safe, 's-safe');
  g += points.native.map((p) => `<rect class="dot-native" x="${X(p.n) - 4}" y="${Y(p.ms) - 4}" width="8" height="8"/>`).join('');
  g += points.safe.map((p) => `<circle class="dot-safe" cx="${X(p.n)}" cy="${Y(p.ms)}" r="4.5"/>`).join('');
  if (points.nativeTimeout) {
    const cx = X(points.nativeTimeout.n);
    const cy = Y(limit);
    g += `<path class="kill" d="M${cx - 7},${cy - 7}L${cx + 7},${cy + 7}M${cx - 7},${cy + 7}L${cx + 7},${cy - 7}"/>`;
  }
  host.innerHTML = `<div class="legend"><span><span class="swatch"></span>SafeRegExp (solid line, circles)</span><span><span class="swatch native"></span>Built-in engine (dashed line, squares)${points.nativeTimeout ? ' (× = gave up)' : ''}</span></div><p class="hint">Lower is better. Each gridline is 10 times more than the one before.</p><svg width="${W}" height="${H}" role="img" aria-label="Chart of the time each engine took, against the length of the text">${g}<line class="xhair" y1="${m.t}" y2="${H - m.b}" visibility="hidden"/></svg><div class="tooltip" hidden></div>`;
  const svg = host.querySelector('svg');
  const tip = host.querySelector('.tooltip');
  const xh = svg.querySelector('.xhair');
  const ns = [...new Set(all.map((p) => p.n))].sort((a, b) => a - b);
  svg.addEventListener('mousemove', (ev) => {
    const r = svg.getBoundingClientRect();
    const mx = ev.clientX - r.left;
    let best = ns[0];
    for (const n of ns) if (Math.abs(X(n) - mx) < Math.abs(X(best) - mx)) best = n;
    const s = points.safe.find((p) => p.n === best);
    const nat = points.native.find((p) => p.n === best);
    const killed = points.nativeTimeout?.n === best;
    xh.setAttribute('x1', X(best));
    xh.setAttribute('x2', X(best));
    xh.setAttribute('visibility', 'visible');
    tip.hidden = false;
    tip.style.left = `${Math.min(X(best) + 12, W - 190)}px`;
    tip.style.top = '80px';
    tip.innerHTML = `<strong>${best.toLocaleString()} characters</strong><br>SafeRegExp: ${s ? fmtMs(s.ms) : '—'}<br>Built-in: ${nat ? fmtMs(nat.ms) : killed ? `gave up after ${limit / 1000} s` : '—'}`;
  });
  svg.addEventListener('mouseleave', () => { tip.hidden = true; xh.setAttribute('visibility', 'hidden'); });
}

// ---------------- "Check my patterns" tab ----------------
function parseLine(line) {
  const t = line.trim();
  if (!t) return null;
  if (t.startsWith('/')) {
    const end = t.lastIndexOf('/');
    if (end > 0) return { pattern: t.slice(1, end), flags: t.slice(end + 1) };
  }
  return { pattern: t, flags: '' };
}

const MAX_LINES = 50;

$('checker-go').addEventListener('click', () => {
  const out = $('checker-out');
  out.innerHTML = '';
  const lines = $('checker-in').value.split('\n').map(parseLine).filter(Boolean);
  if (!lines.length) {
    out.innerHTML = infoCard('Nothing to check yet', '<p>Paste at least one pattern above, one per line, then press the button again.</p>');
    return;
  }
  for (const p of lines.slice(0, MAX_LINES)) {
    const div = document.createElement('div');
    div.className = 'result';
    const ferr = checkFlags(p.flags);
    if (ferr) {
      div.innerHTML = `<div class="verdict verdict--info compact"><code class="pat">/${esc(p.pattern)}/${esc(p.flags)}</code><h3>The flags aren't valid</h3><p>${esc(ferr)}</p></div>`;
      out.append(div);
      continue;
    }
    const r = analyze(p.pattern, forAnalysis(p.flags));
    div.innerHTML = verdictCard(r, { pattern: p.pattern, flags: p.flags, button: 'Test it in this browser', compact: true });
    const btn = div.querySelector('[data-action="confirm"]');
    if (btn) btn.addEventListener('click', () => confirmInBrowser(btn, div.querySelector('.confirm-out'), p, r));
    out.append(div);
  }
  if (lines.length > MAX_LINES) out.insertAdjacentHTML('beforeend', `<p class="hint">Only the first ${MAX_LINES} patterns were checked.</p>`);
});

async function confirmInBrowser(btn, span, p, r) {
  btn.disabled = true;
  let last = null;
  let killedAt = null;
  for (const n of r.status === 'exponential' ? [10, 15, 20, 25, 30] : [1000, 4000, 16000, 64000]) {
    span.textContent = 'Timing the built-in engine…';
    const res = await timeOne('native', { pattern: p.pattern, flags: p.flags, ...r.attack, n }, 3000);
    if (res.error) {
      span.textContent = `Couldn't run the test: ${res.error}`;
      btn.disabled = false;
      return;
    }
    if (res.timeout) { killedAt = n; break; }
    last = { n, ms: res.ms };
  }
  const n = killedAt ?? last.n;
  const len = attackString(r.attack, n).length.toLocaleString();
  const safeMs = timeSafe(p, r, n);
  span.textContent = killedAt
    ? `Built-in engine: gave up after 3 s on a ${len}-character text. SafeRegExp: ${safeMs} on the same text.`
    : last.ms > 50
      ? `Built-in engine: took ${fmtMs(last.ms)} on a ${len}-character text. SafeRegExp: ${safeMs} on the same text.`
      : `Built-in engine stayed fast in this browser (${fmtMs(last.ms)} on a ${len}-character text). Other browsers or longer texts may behave differently. SafeRegExp: ${safeMs}.`;
  btn.disabled = false;
}

function timeSafe(p, r, n) {
  const re = new SafeRegExp(p.pattern, [...p.flags].filter((c) => c !== 'g' && c !== 'y').join(''));
  const s = attackString(r.attack, n);
  const t = performance.now();
  re.test(s);
  return fmtMs(performance.now() - t);
}

// ---------------- start ----------------
syncBoxes();
loadExample(0);
{
  const h = location.hash.slice(1);
  if (TABS.includes(h) || ALIAS[h]) selectTab(h, { hash: false });
}
