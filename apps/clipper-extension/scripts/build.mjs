import { build } from 'esbuild';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const entries = ['background', 'capture-page', 'receiver', 'popup'];
for (const browser of ['chrome', 'firefox']) {
  const outdir = resolve(root, 'dist', browser);
  await mkdir(outdir, { recursive: true });
  await build({
    entryPoints: entries.map((entry) => resolve(root, 'src', `${entry}.ts`)),
    outdir, bundle: true, format: 'iife', platform: 'browser', target: 'es2022', minify: true,
    entryNames: '[name]', logLevel: 'warning',
  });
  const manifest = await readFile(resolve(root, `manifest.${browser}.json`));
  await writeFile(resolve(outdir, 'manifest.json'), manifest);
  await cp(resolve(root, 'src', 'popup.html'), resolve(outdir, 'popup.html'));
  await cp(resolve(root, 'src', 'popup.css'), resolve(outdir, 'popup.css'));
}
