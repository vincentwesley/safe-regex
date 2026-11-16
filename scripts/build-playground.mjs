// Builds the static playground into dist/playground: bundles playground/*.js with the library
// (esbuild) and copies the HTML/CSS and the house kit folder. The output is plain static files: serve the folder with
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
  loader: { '.txt': 'text' }, // sample files are bundled into app.js as strings
  minify: true,
  sourcemap: false,
  logLevel: 'warning',
});
for (const f of ['index.html', 'style.css', 'logo.css', 'logo-resize.js']) cpSync(`playground/${f}`, `${out}/${f}`);
cpSync('playground/samples', `${out}/samples`, { recursive: true }); // downloadable sample files
cpSync('playground/house',`${out}/house`, { recursive: true }); // house kit: tokens, components, fonts, theme-init, credits
console.log(`playground built in ${out}/`);
