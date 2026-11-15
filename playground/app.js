import { SafeRegExp, analyze, attackString, buildNfa, checkSupport, OP_NAMES } from '../src/index.ts';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const SVGNS = 'http://www.w3.org/2000/svg';

const EXAMPLES = [
  ['Nested quantifier (OWASP)', '^(a+)+$', ''],
  ['Overlapping alternation (OWASP)', '^(a|aa)+$', ''],
  ['Email validator (OWASP)', '^([a-zA-Z0-9])(([\\-.]|[_]+)?([a-zA-Z0-9]+))*(@){1}[a-z0-9]+[.]{1}(([a-z]{2,3})|([a-z]{2,3}[.]{1}[a-z]{2,3}))$', ''],
  ['Stack Overflow 2016 outage', '^[\\s\\u200c]+|[\\s\\u200c]+$', ''],
  ['Cloudflare 2019 outage (excerpt)', '.*(?:.*=.*)', ''],
  ['ms CVE-2015-8315', '^((?:\\d+)?\\.?\\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|years?|yrs?|y)?$', 'i'],
  ['normalize-url CVE-2021-33502', '^data:(.*?),(.*?)(?:#(.*))?$', ''],
  ['Safe: ISO date', '^(?<y>\\d{4})-(?<m>\\d\\d)-(?<d>\\d\\d)$', ''],
  ['Safe: hostname', '^(?:[a-z0-9]+\\.)*[a-z]+$', 'i'],
];

// ---------------- tabs ----------------
for (const b of document.querySelectorAll('.tabs button')) {
  b.addEventListener('click', () => {
    for (const o of document.querySelectorAll('.tabs button')) o.setAttribute('aria-selected', String(o === b));
    for (const p of document.querySelectorAll('.panel')) p.hidden = p.id !== `tab-${b.dataset.tab}`;
    if (b.dataset.tab === 'automaton') renderAutomaton();
    if (b.dataset.tab === 'race') prepareRace();
  });
}

// ---------------- pattern state ----------------
const sel = $('examples');
sel.innerHTML = '<option value="">Choose…</option>' + EXAMPLES.map((e, i) => `<option value="${i}">${esc(e[0])}</option>`).join('');
sel.addEventListener('change', () => {
  const e = EXAMPLES[Number(sel.value)];
  if (!e) return;
  $('pattern').value = e[1];
  $('flags').value = e[2];
  update();
});

let current = null; // { re, pattern, flags } or null

function update() {
  const pattern = $('pattern').value;
  const flags = $('flags').value;
  const status = $('pattern-status');
  const s = checkSupport(pattern, flags);
  if (!s.ok) {
    current = null;
    status.className = 'status-line error';
    status.textContent = s.message;
  } else {
    current = { re: new SafeRegExp(pattern, flags), pattern, flags };
    const r = analyze(pattern, flags);
    status.className = 'status-line';
    status.innerHTML = `${badge(r.status, r.degree)} <span>${esc(r.summary)} (for a backtracking engine; SafeRegExp is linear regardless).</span>`;
    current.report = r;
  }
  renderMatches();
  if (!$('tab-automaton').hidden) renderAutomaton();
  if (!$('tab-race').hidden) prepareRace();
}
$('pattern').addEventListener('input', update);
$('flags').addEventListener('input', update);
$('subject').addEventListener('input', renderMatches);

function badge(status, degree) {
  const map = {
    exponential: ['exponential', '⚠ Exponential'],
    polynomial: ['polynomial', `▲ Polynomial${degree ? ` O(n^${degree})` : ''}`],
    safe: ['safe', '✓ Linear'],
  };
  const [cls, label] = map[status] ?? ['other', status];
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

// ---------------- match tab ----------------
function renderMatches() {
  const out = $('match-out');
  const gout = $('groups-out');
  if (!current) {
    out.textContent = '';
    gout.innerHTML = '';
    return;
  }
  const s = $('subject').value;
  const re = new SafeRegExp(current.pattern, current.flags.includes('g') ? current.flags : current.flags + 'g');
  const matches = [];
  let m;
  const t = performance.now();
  while ((m = re.exec(s)) !== null && matches.length < 1000) {
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
  const names = current.re.program.groupNames;
  const n = current.re.program.groupCount;
  let table = `<p class="hint">${matches.length} match${matches.length === 1 ? '' : 'es'} in ${ms.toFixed(2)} ms.</p>`;
  if (matches.length) {
    table += '<table class="data"><thead><tr><th>#</th><th>index</th>';
    for (let g = 0; g < n; g++) table += `<th>${g === 0 ? 'match' : esc(names[g] ? `${g} ‹${names[g]}›` : g)}</th>`;
    table += '</tr></thead><tbody>';
    matches.slice(0, 50).forEach((mm, i) => {
      table += `<tr><td>${i + 1}</td><td>${mm.index}</td>`;
      for (let g = 0; g < n; g++) table += `<td class="mono">${mm[g] === undefined ? '<em>undefined</em>' : esc(JSON.stringify(mm[g]))}</td>`;
      table += '</tr>';
    });
    table += '</tbody></table>';
  }
  gout.innerHTML = table;
}

// ---------------- automaton tab ----------------
function renderAutomaton() {
  const host = $('graph');
  const pre = $('program');
  if (!current) {
    host.innerHTML = '<p class="hint" style="padding:10px">Enter a valid pattern.</p>';
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
    host.innerHTML = `<p class="hint" style="padding:10px">The automaton has ${N} states — too many to draw legibly. The program listing below still shows it.</p>`;
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
  svg.setAttribute('aria-label', `Automaton with ${reachable.length - 1} character states`);
  let html = `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" fill="currentColor"/></marker></defs>`;
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
    html += `<path class="${cls}" d="${d}" marker-end="url(#arrow)" style="color:var(${mult > 1 ? '--critical' : '--text-secondary'})"/>`;
    if (mult > 1) html += `<text class="edge-label" x="${lx}" y="${ly}" text-anchor="middle">×2</text>`;
  }
  for (const v of [...reachable, ACCEPT]) {
    const { x, y } = pos[v];
    const w = W(v);
    const span = v > 0 && v < ACCEPT ? nfa.states[v].span.join(',') : '';
    const rx = v === 0 || v === ACCEPT ? 14 : 6;
    const sp = v > 0 && v < ACCEPT ? nfa.states[v].span : null;
    const blamed = sp && (current.report?.culprits ?? []).some((c) => sp[0] >= c.start && sp[1] <= c.end);
    html += `<g class="node${blamed ? ' culprit' : ''}" data-span="${span}" tabindex="0"><title>${esc(v === 0 ? 'start' : v === ACCEPT ? 'match succeeds' : `consumes ${label(v)} (pattern offset ${span})`)}</title>`;
    html += `<rect x="${x - w / 2}" y="${y - 14}" width="${w}" height="28" rx="${rx}"${v === ACCEPT ? ' style="stroke-width:3"' : ''}/>`;
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

function prepareRace() {
  const note = $('race-note');
  if (!current) {
    note.textContent = 'Enter a valid pattern first.';
    return;
  }
  const r = current.report;
  if (r?.attack) {
    $('atk-prefix').value = r.attack.prefix;
    $('atk-pump').value = r.attack.pump;
    $('atk-suffix').value = r.attack.suffix;
    note.textContent = `Attack string from the checker: ${r.summary}.`;
  } else {
    if (!$('atk-pump').value) $('atk-pump').value = 'a';
    note.textContent = 'The checker found no attack for this pattern; edit the input parts to try your own.';
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

$('race-stop').addEventListener('click', () => { raceRun++; $('race-go').disabled = false; });
$('race-go').addEventListener('click', async () => {
  if (!current) return;
  const run = ++raceRun;
  $('race-go').disabled = true;
  const limit = Number($('race-limit').value);
  const base = { pattern: current.pattern, flags: current.flags, prefix: $('atk-prefix').value, pump: $('atk-pump').value || 'a', suffix: $('atk-suffix').value };
  const tbody = $('race-table').querySelector('tbody');
  tbody.innerHTML = '';
  const points = { safe: [], native: [] };
  let nativeDead = false;
  const sizes = [];
  for (let n = 4; n <= 1 << 17; n = Math.ceil(n * 1.5)) sizes.push(n);
  for (const n of sizes) {
    if (run !== raceRun) break;
    const job = { ...base, n };
    const len = base.prefix.length + base.pump.length * n + base.suffix.length;
    if (len > 400000) break;
    const s = await timeOne('safe', job, 60000);
    let nat = { skipped: true };
    if (!nativeDead) {
      nat = await timeOne('native', job, limit);
      if (nat.timeout) nativeDead = true;
    }
    if (run !== raceRun) break;
    if (s.ms !== undefined) points.safe.push({ n: len, ms: s.ms });
    if (nat.ms !== undefined) points.native.push({ n: len, ms: nat.ms });
    if (nat.timeout) points.nativeTimeout = { n: len, ms: limit };
    const fmt = (r) => (r.error ? esc(r.error) : r.timeout ? `<strong>killed after ${limit / 1000} s</strong>` : r.skipped ? '—' : `${r.ms.toFixed(2)} ms`);
    tbody.insertAdjacentHTML('beforeend', `<tr><td>${n}</td><td>${len}</td><td>${fmt(s)}</td><td>${fmt(nat)}</td></tr>`);
    drawRaceChart(points, limit);
    if (s.ms > 3000) break;
  }
  $('race-go').disabled = false;
});

function drawRaceChart(points, limit) {
  const host = $('race-chart');
  const all = [...points.safe, ...points.native, ...(points.nativeTimeout ? [points.nativeTimeout] : [])];
  if (!all.length) return;
  const W = Math.min(host.clientWidth || 800, 900);
  const H = 300;
  const m = { l: 60, r: 20, t: 10, b: 36 };
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
    g += `<line x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}" stroke="var(--grid)"/>`;
    g += `<text x="${m.l - 6}" y="${y + 4}" text-anchor="end">${e >= 3 ? `${10 ** (e - 3)} s` : `${10 ** e} ms`}</text>`;
  }
  for (let e = Math.ceil(x0); e <= Math.floor(x1); e++) {
    g += `<text x="${X(10 ** e)}" y="${H - 12}" text-anchor="middle">${(10 ** e).toLocaleString()}</text>`;
  }
  g += `<text x="${(W + m.l) / 2}" y="${H - 0}" text-anchor="middle">input length (characters, log scale)</text>`;
  const path = (pts, color) => pts.length ? `<path d="${pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.n)},${Y(p.ms)}`).join('')}" fill="none" stroke="${color}" stroke-width="2"/>` + pts.map((p) => `<circle cx="${X(p.n)}" cy="${Y(p.ms)}" r="4" fill="${color}" stroke="var(--surface-1)" stroke-width="2"/>`).join('') : '';
  g += path(points.native, 'var(--series-native)');
  g += path(points.safe, 'var(--series-safe)');
  if (points.nativeTimeout) {
    const cx = X(points.nativeTimeout.n);
    const cy = Y(limit);
    g += `<path d="M${cx - 6},${cy - 6}L${cx + 6},${cy + 6}M${cx - 6},${cy + 6}L${cx + 6},${cy - 6}" stroke="var(--series-native)" stroke-width="2.5"/>`;
  }
  host.innerHTML = `<div class="legend"><span><span class="swatch" style="background:var(--series-safe)"></span>SafeRegExp</span><span><span class="swatch" style="background:var(--series-native)"></span>built-in RegExp${points.nativeTimeout ? ' (× = killed)' : ''}</span></div><svg width="${W}" height="${H}" role="img" aria-label="Match time against input length for both engines">${g}<line class="xhair" y1="${m.t}" y2="${H - m.b}" stroke="var(--text-secondary)" stroke-dasharray="3 3" visibility="hidden"/></svg><div class="tooltip" hidden></div>`;
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
    tip.style.left = `${Math.min(X(best) + 12, W - 180)}px`;
    tip.style.top = '40px';
    tip.innerHTML = `<strong>${best.toLocaleString()} chars</strong><br>SafeRegExp: ${s ? s.ms.toFixed(2) + ' ms' : '—'}<br>built-in: ${nat ? nat.ms.toFixed(2) + ' ms' : killed ? `killed after ${limit / 1000} s` : '—'}`;
  });
  svg.addEventListener('mouseleave', () => { tip.hidden = true; xh.setAttribute('visibility', 'hidden'); });
}

// ---------------- checker tab ----------------
function parseLine(line) {
  const t = line.trim();
  if (!t) return null;
  if (t.startsWith('/')) {
    const end = t.lastIndexOf('/');
    if (end > 0) return { pattern: t.slice(1, end), flags: t.slice(end + 1) };
  }
  return { pattern: t, flags: '' };
}

$('checker-go').addEventListener('click', () => {
  const out = $('checker-out');
  out.innerHTML = '';
  for (const line of $('checker-in').value.split('\n')) {
    const p = parseLine(line);
    if (!p) continue;
    const r = analyze(p.pattern, p.flags);
    const div = document.createElement('div');
    div.className = 'result';
    let pat = esc(p.pattern);
    if (r.culprits.length) {
      const c = r.culprits[r.culprits.length - 1];
      pat = esc(p.pattern.slice(0, c.start)) + `<mark>${esc(c.text)}</mark>` + esc(p.pattern.slice(c.end));
    }
    let html = `<div class="head">${badge(r.status, r.degree)}<code class="pat culprit">/${pat}/${esc(p.flags)}</code></div>`;
    html += `<p><strong>${esc(r.summary)}.</strong> ${esc(r.explanation)}</p>`;
    if (r.attack) {
      html += `<p class="mono">Attack: ${esc(JSON.stringify(r.attack.prefix))} + ${esc(JSON.stringify(r.attack.pump))} × n + ${esc(JSON.stringify(r.attack.suffix))}${r.validated ? '' : ' (not validated)'}</p>`;
      html += '<button class="confirm">Confirm in this browser</button> <span class="confirm-out"></span>';
    }
    div.innerHTML = html;
    if (r.attack) {
      div.querySelector('.confirm').addEventListener('click', async (ev) => {
        ev.target.disabled = true;
        const span = div.querySelector('.confirm-out');
        const rows = [];
        for (const n of r.status === 'exponential' ? [10, 15, 20, 25, 30] : [1000, 4000, 16000, 64000]) {
          span.textContent = `timing built-in engine, n = ${n}…`;
          const res = await timeOne('native', { pattern: p.pattern, flags: p.flags, ...r.attack, n }, 3000);
          rows.push(res.timeout ? `n=${n}: killed after 3 s` : `n=${n}: ${res.ms.toFixed(1)} ms`);
          if (res.timeout) break;
        }
        span.textContent = `Built-in: ${rows.join(' · ')}. SafeRegExp at the largest n: ${timeSafe(p, r)} ms.`;
      });
    }
    out.append(div);
  }
});

function timeSafe(p, r) {
  const re = new SafeRegExp(p.pattern, [...p.flags].filter((c) => c !== 'g' && c !== 'y').join(''));
  const s = attackString(r.attack, r.status === 'exponential' ? 30 : 64000);
  const t = performance.now();
  re.test(s);
  return (performance.now() - t).toFixed(1);
}

update();
