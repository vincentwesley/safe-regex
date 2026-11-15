// Renders benchmark results as a static SVG of small multiples (log–log axes, one panel per
// corpus entry). Blue = SafeRegExp, orange = built-in RegExp; a cross marks where native was
// killed. Palette: validated reference categorical slots 1 and 2 (light surface).
const C = {
  surface: '#fcfcfb',
  text: '#0b0b0b',
  muted: '#52514e',
  grid: '#e4e3df',
  safe: '#2a78d6',
  native: '#eb6834',
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function renderChart(results, summary) {
  const cols = 4;
  const pw = 250;
  const ph = 170;
  const pad = { l: 44, r: 12, t: 34, b: 30 };
  const rows = Math.ceil(results.length / cols);
  const W = cols * pw + 20;
  const H = rows * ph + 92;
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui, -apple-system, Segoe UI, sans-serif">`);
  parts.push(`<rect width="${W}" height="${H}" fill="${C.surface}"/>`);
  parts.push(`<text x="10" y="24" font-size="16" font-weight="600" fill="${C.text}">Time to reject a hostile input (log–log): SafeRegExp stays linear, the built-in engine does not</text>`);
  parts.push(`<text x="10" y="44" font-size="11" fill="${C.muted}">${esc(`${summary.node} (V8 ${summary.v8}), ${summary.cpu ?? ''}. Median of ${summary.repsPerPoint} runs per point, each point in a fresh process; native killed after ${summary.budgetMs} ms (×).`)}</text>`);
  // legend
  parts.push(`<line x1="10" y1="62" x2="30" y2="62" stroke="${C.safe}" stroke-width="2"/><text x="35" y="66" font-size="12" fill="${C.text}">SafeRegExp</text>`);
  parts.push(`<line x1="120" y1="62" x2="140" y2="62" stroke="${C.native}" stroke-width="2"/><text x="145" y="66" font-size="12" fill="${C.text}">built-in RegExp</text>`);

  results.forEach((r, i) => {
    const ox = 10 + (i % cols) * pw;
    const oy = 80 + Math.floor(i / cols) * ph;
    const all = [...r.safe, ...r.native].filter((p) => p.ms !== null);
    const ns = [...r.safe.map((p) => p.n)];
    const xmin = Math.log10(Math.min(...ns));
    const xmax = Math.log10(Math.max(...ns));
    const ymin = Math.floor(Math.log10(Math.max(1e-3, Math.min(...all.map((p) => p.ms)))));
    const ymax = Math.max(ymin + 1, Math.ceil(Math.log10(Math.max(r.nativeTimeoutAt ? summary.budgetMs : 0, ...all.map((p) => p.ms)))));
    const x = (n) => ox + pad.l + ((Math.log10(n) - xmin) / (xmax - xmin || 1)) * (pw - pad.l - pad.r);
    const y = (ms) => oy + ph - pad.b - ((Math.log10(Math.max(ms, 1e-3)) - ymin) / (ymax - ymin)) * (ph - pad.t - pad.b);
    parts.push(`<text x="${ox + 4}" y="${oy + 14}" font-size="12" font-weight="600" fill="${C.text}">${esc(r.id)}</text>`);
    parts.push(`<text x="${ox + 4}" y="${oy + 27}" font-size="10" fill="${C.muted}">${esc(`slope: safe ${r.safeSlope?.toFixed(2)} · native ${r.nativeTimeoutAt ? 'timeout' : r.nativeSlope?.toFixed(2)}`)}</text>`);
    for (let e = ymin; e <= ymax; e++) {
      const yy = y(10 ** e);
      parts.push(`<line x1="${ox + pad.l}" x2="${ox + pw - pad.r}" y1="${yy}" y2="${yy}" stroke="${C.grid}" stroke-width="1"/>`);
      const lbl = e >= 3 ? `${10 ** (e - 3)}s` : e >= 0 ? `${10 ** e}ms` : `${10 ** e}ms`;
      parts.push(`<text x="${ox + pad.l - 4}" y="${yy + 3}" font-size="9" text-anchor="end" fill="${C.muted}">${lbl}</text>`);
    }
    const ticks = [ns[0], ns[Math.floor(ns.length / 2)], ns[ns.length - 1]];
    for (const n of ticks) {
      parts.push(`<text x="${x(n)}" y="${oy + ph - pad.b + 13}" font-size="9" text-anchor="middle" fill="${C.muted}">n=${n >= 1024 ? `${n / 1024}k` : n}</text>`);
    }
    const line = (pts, color) => {
      const d = pts.filter((p) => p.ms !== null).map((p, k) => `${k ? 'L' : 'M'}${x(p.n).toFixed(1)},${y(p.ms).toFixed(1)}`).join('');
      if (d) parts.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`);
    };
    line(r.native, C.native);
    line(r.safe, C.safe);
    if (r.nativeTimeoutAt) {
      const cx = x(r.nativeTimeoutAt);
      const cy = y(summary.budgetMs);
      parts.push(`<path d="M${cx - 4},${cy - 4}L${cx + 4},${cy + 4}M${cx - 4},${cy + 4}L${cx + 4},${cy - 4}" stroke="${C.native}" stroke-width="2"/>`);
    }
  });
  parts.push('</svg>');
  return parts.join('\n');
}
