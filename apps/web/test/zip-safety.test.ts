import { BlobReader, BlobWriter, TextReader, ZipReader, ZipWriter, type FileEntry } from '@zip.js/zip.js';
import { describe, expect, it } from 'vitest';
import { readBoundedZipBlob, readBoundedZipText } from '../src/lib/zip-safety';

async function archivedEntry(text: string): Promise<{ reader: ZipReader<Blob>; entry: FileEntry }> {
  const writer = new ZipWriter(new BlobWriter('application/zip'));
  await writer.add('note.md', new TextReader(text));
  const reader = new ZipReader(new BlobReader(await writer.close()));
  const entry = (await reader.getEntries()).find((item): item is FileEntry => !item.directory);
  if (!entry) throw new Error('Test ZIP entry is missing');
  return { reader, entry };
}

describe('ZIP extraction limits', () => {
  it('reads valid text and binary entries within the actual byte limit', async () => {
    const { reader, entry } = await archivedEntry('Noor Note');
    try {
      expect(await readBoundedZipText(entry, 9)).toBe('Noor Note');
      expect((await readBoundedZipBlob(entry, 9)).size).toBe(9);
    } finally { await reader.close(); }
  });

  it('stops a ZIP entry whose declared size understates its decompressed bytes', async () => {
    const { reader, entry } = await archivedEntry('a'.repeat(128 * 1024));
    const forged = new Proxy(entry, { get(target, property, receiver) {
      return property === 'uncompressedSize' ? 1 : Reflect.get(target, property, receiver);
    } });
    try {
      await expect(readBoundedZipText(forged, 1024)).rejects.toThrow('ZIP entry exceeds its size limit');
    } finally { await reader.close(); }
  });

  it('rejects an entry whose declared size is larger than its actual content', async () => {
    const { reader, entry } = await archivedEntry('short');
    const forged = new Proxy(entry, { get(target, property, receiver) {
      return property === 'uncompressedSize' ? 10 : Reflect.get(target, property, receiver);
    } });
    try {
      await expect(readBoundedZipText(forged, 20)).rejects.toThrow('ZIP entry size does not match its contents');
    } finally { await reader.close(); }
  });
});
