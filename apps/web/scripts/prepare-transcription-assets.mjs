import { createRequire } from 'node:module';
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const transformersDirectory = resolve(dirname(require.resolve('@huggingface/transformers')), '..');
const runtimeDirectory = resolve(dirname(require.resolve('onnxruntime-web', { paths: [transformersDirectory] })), '..');
const output = resolve(packageDirectory, 'public/transcription/runtime');
await mkdir(output, { recursive: true });
for (const name of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']) {
  await copyFile(resolve(runtimeDirectory, 'dist', name), resolve(output, name));
}
await copyFile(resolve(transformersDirectory, 'LICENSE'), resolve(output, 'transformers.LICENSE'));
