import { describe, expect, it, vi } from 'vitest';
import { attachmentSchema, makeVaultNote, ocrRecordSchema, transcriptSchema, type VaultNote } from '@noor-note/core';
import { toNoteEntry, type VaultRepository } from '@noor-note/storage';
import { SearchClient } from '../src/lib/search-client';

describe('search client', () => {
  it('fetches bodies once, then only changed revisions and removes deleted notes', async () => {
    const vaultId = crypto.randomUUID();
    const one = await makeVaultNote({ vaultId, title: 'One', markdown: 'orchid' });
    const two = await makeVaultNote({ vaultId, title: 'Two', markdown: 'orchid' });
    const notes = new Map<string, VaultNote>([[one.id, one], [two.id, two]]);
    const getNote = vi.fn(async (id: string) => notes.get(id));
    const repository = { listTree: async () => ({ notes: [...notes.values()].map(toNoteEntry), attachments: [] }), listObjects: async () => [], getNote } as unknown as VaultRepository;
    const client = new SearchClient();
    expect(await client.search(repository, vaultId, 'orchid')).toHaveLength(2);
    expect(getNote).toHaveBeenCalledTimes(2);
    expect(await client.search(repository, vaultId, 'orchid')).toHaveLength(2);
    expect(getNote).toHaveBeenCalledTimes(2);
    notes.set(one.id, { ...one, revision: 2, markdown: 'marigold' });
    expect(await client.search(repository, vaultId, 'marigold')).toHaveLength(1);
    expect(getNote).toHaveBeenCalledTimes(3);
    notes.delete(two.id);
    expect(await client.search(repository, vaultId, 'orchid')).toHaveLength(0);
    client.close();
  });

  it('indexes OCR attachments incrementally and refreshes corrected text on invalidation', async () => {
    const vaultId = crypto.randomUUID(), attachmentId = crypto.randomUUID();
    const timestamp = '2026-09-25T12:00:00.000Z';
    const attachment = attachmentSchema.parse({ id: attachmentId, vaultId, folderId: null, path: '/scan.png', name: 'scan.png', mime: 'image/png', size: 4, storage: 'indexeddb', createdAt: timestamp, updatedAt: timestamp, deletedAt: null, trashGroupId: null });
    let record = ocrRecordSchema.parse({ id: crypto.randomUUID(), vaultId, attachmentId, page: 1, providerId: 'tesseract-browser', languages: ['swe'], detectedText: 'fakfura', text: 'faktura', confidence: 80, createdAt: timestamp, updatedAt: timestamp });
    const listObjects = vi.fn(async (kind: string) => kind === 'ocrRecord' ? [record] : []);
    const repository = { listTree: async () => ({ notes: [], attachments: [attachment] }), listObjects, getNote: vi.fn() } as unknown as VaultRepository;
    const client = new SearchClient();
    expect(await client.search(repository, vaultId, 'faktura')).toMatchObject([{ kind: 'ocr', attachmentId, page: 1 }]);
    expect(await client.search(repository, vaultId, 'faktura')).toHaveLength(1);
    expect(listObjects).toHaveBeenCalledTimes(2);
    record = ocrRecordSchema.parse({ ...record, text: 'kvitto', updatedAt: '2026-09-25T12:01:00.000Z' });
    client.invalidateOcr();
    expect(await client.search(repository, vaultId, 'kvitto')).toHaveLength(1);
    expect(await client.search(repository, vaultId, 'faktura')).toHaveLength(0);
    client.close();
  });

  it('indexes corrected transcript segments with their seek timestamps and removes deleted segments', async () => {
    const vaultId = crypto.randomUUID(), attachmentId = crypto.randomUUID();
    const timestamp = '2026-09-25T12:00:00.000Z';
    const attachment = attachmentSchema.parse({ id: attachmentId, vaultId, folderId: null, path: '/voice.webm', name: 'voice.webm', mime: 'audio/webm', size: 5, storage: 'indexeddb', createdAt: timestamp, updatedAt: timestamp, deletedAt: null, trashGroupId: null });
    const first = { id: crypto.randomUUID(), startMs: 0, endMs: 1000, text: 'hello', speaker: null, confidence: null };
    const second = { id: crypto.randomUUID(), startMs: 1200, endMs: 2600, text: 'marigold', speaker: null, confidence: null };
    let transcript = transcriptSchema.parse({ id: crypto.randomUUID(), vaultId, attachmentId, providerId: 'whisper-browser', language: null, text: 'hello marigold', segments: [first, second], createdAt: timestamp, updatedAt: timestamp });
    const listObjects = vi.fn(async (kind: string) => kind === 'transcript' ? [transcript] : []);
    const repository = { listTree: async () => ({ notes: [], attachments: [attachment] }), listObjects, getNote: vi.fn() } as unknown as VaultRepository;
    const client = new SearchClient();
    expect(await client.search(repository, vaultId, 'marigold')).toMatchObject([{ kind: 'transcript', attachmentId, timeMs: 1200 }]);
    expect(await client.search(repository, vaultId, 'has:transcript')).toHaveLength(2);
    transcript = transcriptSchema.parse({ ...transcript, text: 'hello', segments: [first], updatedAt: '2026-09-25T12:01:00.000Z' });
    client.invalidateDerived();
    expect(await client.search(repository, vaultId, 'marigold')).toHaveLength(0);
    expect(await client.search(repository, vaultId, 'has:transcript')).toHaveLength(1);
    client.close();
  });
});
