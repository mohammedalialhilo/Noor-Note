import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const modelPath = fileURLToPath(new URL('../public/ocr/lang/', import.meta.url));
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(name: string, data: Buffer): Buffer {
  const type = Buffer.from(name);
  const header = Buffer.alloc(4); header.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([header, type, data, checksum]);
}
function textPng(): string {
  const glyphs: Record<string, string[]> = {
    N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
    O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  };
  const width = 300, height = 110, scale = 12;
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const pixels = Buffer.alloc(height * (1 + width * 3), 255);
  for (let row = 0; row < height; row += 1) pixels[row * (1 + width * 3)] = 0;
  for (const [index, letter] of [...'NOOR'].entries()) for (const [row, line] of glyphs[letter]!.entries()) for (const [column, filled] of [...line].entries()) if (filled === '1') {
    for (let y = 0; y < scale; y += 1) for (let x = 0; x < scale; x += 1) {
      const top = 13 + row * scale + y, left = 13 + index * 7 * scale + column * scale + x;
      const offset = top * (1 + width * 3) + 1 + left * 3;
      pixels[offset] = 0; pixels[offset + 1] = 0; pixels[offset + 2] = 0;
    }
  }
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

describe('local OCR engine', () => {
  it('loads the bundled English model and recognizes local image text without a remote model path', async () => {
    const { createWorker, OEM } = await import('tesseract.js');
    const worker = await createWorker('eng', OEM.LSTM_ONLY, { langPath: resolve(modelPath), cacheMethod: 'none' });
    try {
      const result = await worker.recognize(textPng());
      expect(result.data.text.trim().length).toBeGreaterThan(0);
      expect(result.data.confidence).toBeGreaterThanOrEqual(0);
    } finally { await worker.terminate(); }
  }, 30_000);

  it('initializes Swedish and Arabic together from packaged language files', async () => {
    const { createWorker, OEM } = await import('tesseract.js');
    const worker = await createWorker(['swe', 'ara'], OEM.LSTM_ONLY, { langPath: resolve(modelPath), cacheMethod: 'none' });
    try {
      const result = await worker.recognize(textPng());
      expect(typeof result.data.text).toBe('string');
    } finally { await worker.terminate(); }
  }, 30_000);
});
