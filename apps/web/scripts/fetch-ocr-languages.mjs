import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

// Maintainer-only asset refresh. Production builds never download OCR models.
const output = resolve(dirname(fileURLToPath(import.meta.url)), '../public/ocr/lang');
await mkdir(output, { recursive: true });
for (const code of ['eng', 'swe', 'ara']) {
  const response = await fetch(`https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/${code}.traineddata`);
  if (!response.ok) throw new Error(`Could not download ${code}: ${response.status}`);
  const raw = Buffer.from(await response.arrayBuffer());
  if (raw.length < 100_000 || raw.length > 20_000_000) throw new Error(`Unexpected ${code} model size`);
  const compressed = gzipSync(raw, { level: 9 });
  await writeFile(resolve(output, `${code}.traineddata.gz`), compressed);
  console.log(`${code}: ${raw.length} bytes, SHA-256 ${createHash('sha256').update(raw).digest('hex')}, gzip ${compressed.length} bytes`);
}
const license = await fetch('https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/LICENSE');
if (!license.ok) throw new Error('Could not download model license');
await writeFile(resolve(output, 'LICENSE'), await license.text());
