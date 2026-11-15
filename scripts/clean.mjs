// Removes library build output before a fresh build.
import { rmSync } from 'node:fs';
for (const dir of ['dist/esm', 'dist/cjs', 'dist/types']) rmSync(dir, { recursive: true, force: true });
