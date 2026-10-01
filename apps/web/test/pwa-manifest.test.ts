import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const publicDirectory = fileURLToPath(new URL('../public/', import.meta.url));
const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../public/manifest.webmanifest', import.meta.url)), 'utf8')) as {
  name: string; id: string; start_url: string; scope: string; display: string;
  icons: { src: string; sizes: string; type: string; purpose: string }[];
};

describe('install manifest and icons', () => {
  it('names Noor Note and points to valid square PNG install icons', () => {
    expect(manifest).toMatchObject({ name: 'Noor Note', id: 'noor-note', start_url: '/', scope: '/', display: 'standalone' });
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
    for (const size of [192, 512]) {
      const icon = manifest.icons.find((item) => item.sizes === `${size}x${size}` && item.type === 'image/png');
      expect(icon).toBeDefined();
      const image = readFileSync(join(publicDirectory, icon!.src.slice(1)));
      expect(image.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(image.readUInt32BE(16)).toBe(size);
      expect(image.readUInt32BE(20)).toBe(size);
    }
  });
});
