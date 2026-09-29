import type { Attachment } from '@noor-note/core';

const rasterMime = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'image/tiff']);
const rasterExtension = /\.(?:png|jpe?g|webp|gif|bmp|tiff?)$/iu;

export function isOcrImage(input: Pick<Attachment, 'mime' | 'name'>): boolean {
  return rasterMime.has(input.mime) || (!input.mime || input.mime === 'application/octet-stream') && rasterExtension.test(input.name);
}
