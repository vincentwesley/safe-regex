// Builds the CommonJS entry point (a single bundled file) and marks dist/cjs as CommonJS.
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'neutral',
  target: 'es2020',
  outfile: 'dist/cjs/index.js',
  logLevel: 'warning',
});
writeFileSync('dist/cjs/package.json', JSON.stringify({ type: 'commonjs' }) + '\n');
