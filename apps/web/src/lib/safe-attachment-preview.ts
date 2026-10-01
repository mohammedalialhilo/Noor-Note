/** Only bounded headers are read; full attachment bytes remain in browser storage. */
export async function safeAttachmentPreview(blob: Blob, mime: string): Promise<Blob | null> {
  if (blob.size < 5) return null;
  const bytes = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
  const ascii = (start: number, value: string): boolean =>
    [...value].every((character, index) => bytes[start + index] === character.charCodeAt(0));
  let valid = false;
  switch (mime) {
    case 'application/pdf': valid = ascii(0, '%PDF-'); break;
    case 'image/png': valid = bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value); break;
    case 'image/jpeg': valid = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff; break;
    case 'image/gif': valid = ascii(0, 'GIF87a') || ascii(0, 'GIF89a'); break;
    case 'image/webp': valid = ascii(0, 'RIFF') && ascii(8, 'WEBP'); break;
    case 'image/bmp': valid = ascii(0, 'BM'); break;
    case 'image/tiff': valid = ascii(0, 'II') && bytes[2] === 42 && bytes[3] === 0
      || ascii(0, 'MM') && bytes[2] === 0 && bytes[3] === 42; break;
    case 'image/avif': valid = ascii(4, 'ftyp') && (ascii(8, 'avif') || ascii(8, 'avis')); break;
  }
  return valid ? blob.slice(0, blob.size, mime) : null;
}

export const previewImageTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);

export function previewImageMime(mime: string, filename: string): string {
  if (mime && mime !== 'application/octet-stream') return mime;
  const extension = filename.split('.').at(-1)?.toLowerCase();
  const byExtension: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
  };
  return extension ? byExtension[extension] ?? '' : '';
}
