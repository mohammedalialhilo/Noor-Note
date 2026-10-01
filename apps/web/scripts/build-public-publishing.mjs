import { build } from 'esbuild';
import { copyFile, cp } from 'node:fs/promises';

await Promise.all([
  build({ entryPoints: ['src/lib/public-mermaid.ts'], outfile: 'public/publish-mermaid.js', bundle: true, minify: true, format: 'iife', platform: 'browser', target: 'es2022' }),
  copyFile('node_modules/katex/dist/katex.min.css', 'public/publish-katex.css'),
  cp('node_modules/katex/dist/fonts', 'public/fonts', { recursive: true }),
]);
