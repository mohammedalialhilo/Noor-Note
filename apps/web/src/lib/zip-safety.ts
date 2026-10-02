import { BlobWriter, TextWriter, type FileEntry } from '@zip.js/zip.js';

/** Enforce a limit against the bytes actually produced by the decompressor. */
async function readBounded<T>(entry: FileEntry, writer: { writable: WritableStream; getData(): Promise<T> }, limit: number): Promise<T> {
  if (!Number.isSafeInteger(limit) || limit < 0 || !Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 || entry.uncompressedSize > limit) throw new Error('ZIP entry exceeds its size limit');
  const sink = writer.writable.getWriter();
  let size = 0;
  const bounded = new WritableStream<Uint8Array>({
    async write(chunk) {
      size += chunk.byteLength;
      if (size > limit) throw new Error('ZIP entry exceeds its size limit');
      await sink.write(chunk);
    },
    async close() { await sink.close(); },
    async abort(reason) { await sink.abort(reason); },
  });
  try {
    await entry.getData(bounded, { checkSignature: true });
    if (size !== entry.uncompressedSize) throw new Error('ZIP entry size does not match its contents');
    return await writer.getData();
  } catch (error) {
    await sink.abort(error).catch(() => undefined);
    throw error;
  }
}

export function readBoundedZipText(entry: FileEntry, limit: number): Promise<string> {
  return readBounded(entry, new TextWriter(), limit);
}

export function readBoundedZipBlob(entry: FileEntry, limit: number, mime?: string): Promise<Blob> {
  return readBounded(entry, new BlobWriter(mime), limit);
}

/** Verify ZIP decompression and CRC without retaining attachment bytes. */
export async function verifyBoundedZipEntry(entry: FileEntry, limit: number): Promise<void> {
  if (!Number.isSafeInteger(limit) || limit < 0 || !Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 || entry.uncompressedSize > limit) throw new Error('ZIP entry exceeds its size limit');
  let size = 0;
  await entry.getData(new WritableStream<Uint8Array>({
    write(chunk) {
      size += chunk.byteLength;
      if (size > limit) throw new Error('ZIP entry exceeds its size limit');
    },
  }), { checkSignature: true });
  if (size !== entry.uncompressedSize) throw new Error('ZIP entry size does not match its contents');
}
