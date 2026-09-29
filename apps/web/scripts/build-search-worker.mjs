import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'public/search-worker.js');
await mkdir(resolve(root, 'public'), { recursive: true });
await build({
  entryPoints: [resolve(root, 'src/lib/search-worker.ts')],
  outfile: output,
  bundle: true,
  minify: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  legalComments: 'none',
});
await build({
  entryPoints: [resolve(root, 'src/lib/graph-worker.ts')],
  outfile: resolve(root, 'public/graph-worker.js'),
  bundle: true,
  minify: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  legalComments: 'none',
});
await build({
  entryPoints: [resolve(root, 'src/lib/transcription-worker.ts')],
  outfile: resolve(root, 'public/transcription-worker.js'),
  bundle: true,
  minify: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  legalComments: 'none',
});
await build({
  entryPoints: [resolve(root, 'src/lib/ai-note-worker.ts')],
  outfile: resolve(root, 'public/ai-note-worker.js'),
  bundle: true,
  minify: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  legalComments: 'none',
});
await build({
  entryPoints: [resolve(root, 'src/lib/semantic-worker.ts')],
  outfile: resolve(root, 'public/semantic-worker.js'),
  bundle: true,
  minify: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  legalComments: 'none',
});
