import type { Attachment } from '@noor-note/core';

const OPFS_THRESHOLD = 1024 * 1024;

export interface AttachmentBytesStore {
  write(id: string, blob: Blob): Promise<'opfs' | 'indexeddb'>;
  read(attachment: Attachment): Promise<Blob | undefined>;
  remove(attachment: Attachment): Promise<void>;
}

export interface BlobFallback {
  put(id: string, blob: Blob): Promise<void>;
  get(id: string): Promise<Blob | undefined>;
  delete(id: string): Promise<void>;
}

export class BrowserAttachmentStore implements AttachmentBytesStore {
  constructor(private readonly fallback: BlobFallback) {}

  private async directory(): Promise<FileSystemDirectoryHandle | null> {
    if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return null;
    try {
      const root = await navigator.storage.getDirectory();
      return await root.getDirectoryHandle('noor-note-attachments', { create: true });
    } catch { return null; }
  }

  async write(id: string, blob: Blob): Promise<'opfs' | 'indexeddb'> {
    if (blob.size >= OPFS_THRESHOLD) {
      const directory = await this.directory();
      if (directory) {
        const handle = await directory.getFileHandle(id, { create: true });
        const writable = await handle.createWritable();
        try { await blob.stream().pipeTo(writable); }
        catch (error) { await writable.abort().catch(() => undefined); await directory.removeEntry(id).catch(() => undefined); throw error; }
        return 'opfs';
      }
    }
    await this.fallback.put(id, blob);
    return 'indexeddb';
  }

  async read(attachment: Attachment): Promise<Blob | undefined> {
    if (attachment.storage === 'indexeddb') return this.fallback.get(attachment.id);
    const directory = await this.directory();
    if (!directory) throw new Error('Attachment storage is unavailable');
    try { return await (await directory.getFileHandle(attachment.id)).getFile(); }
    catch (error) { if (error instanceof DOMException && error.name === 'NotFoundError') return undefined; throw error; }
  }

  async remove(attachment: Attachment): Promise<void> {
    if (attachment.storage === 'indexeddb') { await this.fallback.delete(attachment.id); return; }
    const directory = await this.directory();
    if (!directory) return;
    await directory.removeEntry(attachment.id).catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
    });
  }
}
