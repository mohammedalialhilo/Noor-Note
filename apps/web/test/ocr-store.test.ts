import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DexieVaultRepository, type AttachmentBytesStore } from '@noor-note/storage';
import { OcrStore } from '../src/lib/ocr-store';

describe('OCR sidecar storage', () => {
  let repository: DexieVaultRepository;
  let databaseName: string;
  const blobs = new Map<string, Blob>();
  const bytes: AttachmentBytesStore = {
    async write(id, blob) { blobs.set(id, blob); return 'indexeddb'; },
    async read(item) { return blobs.get(item.id); },
    async remove(item) { blobs.delete(item.id); },
  };
  beforeEach(() => {
    vi.stubGlobal('window', {});
    databaseName = `noor-note-ocr-test-${crypto.randomUUID()}`;
    repository = new DexieVaultRepository(databaseName, bytes);
    blobs.clear();
  });
  afterEach(async () => { repository.close(); await Dexie.delete(databaseName); vi.unstubAllGlobals(); });

  it('preserves the image and raw OCR while saving and correcting searchable text', async () => {
    const vault = await repository.initialize();
    const attachment = await repository.addAttachment(vault.id, null, new Blob(['original image bytes'], { type: 'image/png' }), 'scan.png');
    const store = new OcrStore(repository, vault.id);
    const draft = { providerId: 'tesseract-browser', languages: ['swe', 'ara'], detectedText: 'fakfura', text: 'fakfura', confidence: 76 };
    const saved = await store.save(attachment.id, 1, draft, null);
    const corrected = await store.correct(saved, 'faktura فاتورة');
    expect(corrected.id).toBe(saved.id);
    expect(corrected.detectedText).toBe('fakfura');
    expect(corrected.text).toBe('faktura فاتورة');
    await expect(store.correct(saved, 'stale edit')).rejects.toThrow('changed');
    expect(await (await repository.getAttachmentBlob(attachment.id))?.text()).toBe('original image bytes');
    await repository.deleteAttachment(attachment.id);
    await repository.restoreAttachment(attachment.id);
    expect(await store.list(attachment.id)).toHaveLength(1);
    await repository.deleteAttachment(attachment.id);
    await repository.permanentlyDeleteAttachment(attachment.id);
    expect(await store.list(attachment.id)).toHaveLength(0);
  });

  it('rejects unsupported sources and invalid language or page input', async () => {
    const vault = await repository.initialize();
    const attachment = await repository.addAttachment(vault.id, null, new Blob(['binary'], { type: 'application/octet-stream' }), 'archive.bin');
    const store = new OcrStore(repository, vault.id);
    const draft = { providerId: 'tesseract-browser', languages: ['eng'], detectedText: 'text', text: 'text', confidence: null };
    await expect(store.save(attachment.id, 1, draft, null)).rejects.toThrow('unavailable');
    const image = await repository.addAttachment(vault.id, null, new Blob(['image'], { type: 'image/png' }), 'image.png');
    await expect(store.save(image.id, 0, draft, null)).rejects.toThrow();
    await expect(store.save(image.id, 1, { ...draft, languages: ['bad-code'] }, null)).rejects.toThrow();
    const genericImage = await repository.addAttachment(vault.id, null, new Blob(['image']), 'scan.jpeg');
    expect((await store.save(genericImage.id, 1, draft, null)).attachmentId).toBe(genericImage.id);
  });
});
