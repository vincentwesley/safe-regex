// Builds the static playground into dist/playground: bundles playground/*.js with the library
// (esbuild) and copies the HTML/CSS. The output is plain static files: serve the folder with
// any static file server (ES modules and Web Workers need http://, not file://).
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';

const out = 'dist/playground';
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
if (!existsSync('playground/index.html')) {
  console.log('playground/ not present yet; skipping');
  process.exit(0);
}
await build({
  entryPoints: ['playground/app.js', 'playground/race-worker.js'],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  outdir: out,
  minify: true,
  sourcemap: false,
  logLevel: 'warning',
});
for (const f of ['index.html', 'style.css', 'logo.css', 'logo-init.js', 'logo-resize.js']) cpSync(`playground/${f}`, `${out}/${f}`);
console.log(`playground built in ${out}/`);
