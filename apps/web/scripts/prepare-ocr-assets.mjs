import { createRequire } from 'node:module';
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tesseractDirectory = dirname(require.resolve('tesseract.js/package.json'));
const coreDirectory = dirname(require.resolve('tesseract.js-core/package.json', { paths: [tesseractDirectory] }));
const output = resolve(packageDirectory, 'public/ocr/runtime');
await mkdir(output, { recursive: true });
await copyFile(resolve(tesseractDirectory, 'dist/worker.min.js'), resolve(output, 'worker.min.js'));
await copyFile(resolve(tesseractDirectory, 'dist/worker.min.js.LICENSE.txt'), resolve(output, 'worker.min.js.LICENSE.txt'));
await copyFile(resolve(tesseractDirectory, 'LICENSE.md'), resolve(output, 'tesseract.js.LICENSE.md'));
await copyFile(resolve(coreDirectory, 'LICENSE'), resolve(output, 'tesseract.js-core.LICENSE'));
for (const variant of ['tesseract-core-lstm', 'tesseract-core-simd-lstm', 'tesseract-core-relaxedsimd-lstm']) {
  for (const suffix of ['.wasm.js', '.wasm']) await copyFile(resolve(coreDirectory, `${variant}${suffix}`), resolve(output, `${variant}${suffix}`));
}
