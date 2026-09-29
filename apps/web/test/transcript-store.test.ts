import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DexieVaultRepository, type AttachmentBytesStore } from '@noor-note/storage';
import { TranscriptStore } from '../src/lib/transcript-store';

describe('transcript sidecars', () => {
  let repository: DexieVaultRepository;
  let databaseName: string;
  const blobs = new Map<string, Blob>();
  const bytes: AttachmentBytesStore = {
    async write(id, blob) { blobs.set(id, blob); return 'indexeddb'; },
    async read(item) { return blobs.get(item.id); },
    async remove(item) { blobs.delete(item.id); },
  };
  beforeEach(() => { vi.stubGlobal('window', {}); blobs.clear(); databaseName = `noor-note-transcript-${crypto.randomUUID()}`; repository = new DexieVaultRepository(databaseName, bytes); });
  afterEach(async () => { repository.close(); await Dexie.delete(databaseName); vi.unstubAllGlobals(); });

  it('saves timestamped segments without rewriting audio, supports correction and removes sidecar only on permanent delete', async () => {
    const vault = await repository.initialize();
    const attachment = await repository.addAttachment(vault.id, null, new Blob(['original recording'], { type: 'audio/webm' }), 'voice.webm');
    const store = new TranscriptStore(repository, vault.id);
    const segment = { id: crypto.randomUUID(), startMs: 0, endMs: 1200, text: 'hello worid', speaker: null, confidence: null };
    const first = await store.save(attachment.id, { providerId: 'whisper-browser', language: null, segments: [segment] }, null);
    const corrected = await store.save(attachment.id, { providerId: 'whisper-browser', language: 'en', segments: [{ ...segment, text: 'hello world', speaker: 'Speaker 1' }] }, first.updatedAt);
    expect(corrected).toMatchObject({ id: first.id, text: 'hello world', segments: [{ id: segment.id, speaker: 'Speaker 1' }] });
    await expect(store.save(attachment.id, { providerId: 'whisper-browser', language: null, segments: [segment] }, first.updatedAt)).rejects.toThrow('changed');
    expect(await (await repository.getAttachmentBlob(attachment.id))?.text()).toBe('original recording');
    await repository.deleteAttachment(attachment.id); await repository.restoreAttachment(attachment.id);
    expect(await store.get(attachment.id)).not.toBeNull();
    await repository.deleteAttachment(attachment.id); await repository.permanentlyDeleteAttachment(attachment.id);
    expect(await store.get(attachment.id)).toBeNull();
  });

  it('rejects invalid segment timing and nonmedia sources', async () => {
    const vault = await repository.initialize();
    const audio = await repository.addAttachment(vault.id, null, new Blob(['audio']), 'voice.mp3');
    const draft = { providerId: 'test', language: null, segments: [{ id: crypto.randomUUID(), startMs: 10, endMs: 10, text: 'invalid', speaker: null, confidence: null }] };
    await expect(new TranscriptStore(repository, vault.id).save(audio.id, draft, null)).rejects.toThrow();
    const file = await repository.addAttachment(vault.id, null, new Blob(['data']), 'data.bin');
    await expect(new TranscriptStore(repository, vault.id).save(file.id, { ...draft, segments: [] }, null)).rejects.toThrow('unavailable');
  });
});
