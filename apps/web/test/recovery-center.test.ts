// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DexieVaultRepository, type AttachmentBytesStore } from '@noor-note/storage';
import { loadRecoveryInventory, restoreAsRecoveryCopy } from '../src/lib/recovery-center';
import { listRecoveryDrafts, readRecoveryDraft, writeRecoveryDraft } from '../src/lib/recovery-drafts';

describe('Recovery Center inventory and copies', () => {
  const blobs = new Map<string, Blob>();
  const bytes: AttachmentBytesStore = {
    async write(id, blob) { blobs.set(id, blob); return 'indexeddb'; },
    async read(item) { return blobs.get(item.id); },
    async remove(item) { blobs.delete(item.id); },
  };
  let name: string;
  let repository: DexieVaultRepository;
  beforeEach(() => { name = `noor-recovery-${crypto.randomUUID()}`; repository = new DexieVaultRepository(name, bytes); blobs.clear(); localStorage.clear(); });
  afterEach(async () => { repository.close(); await Dexie.delete(name); localStorage.clear(); });

  it('exposes deleted content, recent history, browser drafts, and sync conflict copies', async () => {
    const vault = await repository.initialize();
    const note = await repository.createNote(vault.id, null, 'Source', 'First');
    await repository.saveNote(note.id, { markdown: 'Second' }, true);
    const attachment = await repository.addAttachment(vault.id, null, new Blob(['image bytes'], { type: 'image/png' }), 'image.png');
    await repository.deleteNote(note.id);
    await repository.deleteAttachment(attachment.id);
    const conflict = await repository.createNote(vault.id, null, 'Source (conflict 2026-10-02)', 'Local changes');
    await repository.addAttachment(vault.id, null, new Blob(['local copy']), 'file (conflict abcdef12)');
    localStorage.setItem(`noor-note-draft:${note.id}`, JSON.stringify({ vaultId: vault.id, title: 'Source', markdown: 'Unsaved changes', updatedAt: Date.now() + 1000 }));
    localStorage.setItem(`noor-note-draft:${crypto.randomUUID()}`, JSON.stringify({ vaultId: crypto.randomUUID(), title: 'Foreign', markdown: 'Secret', updatedAt: Date.now() }));
    const inventory = await loadRecoveryInventory(repository, vault.id);
    expect(inventory.deleted.map((item) => item.kind).sort()).toEqual(['deleted-attachment', 'deleted-note']);
    expect(inventory.revisions.length).toBeGreaterThanOrEqual(3);
    expect(inventory.drafts).toHaveLength(1);
    expect(inventory.conflicts.map((item) => item.kind).sort()).toEqual(['conflict-attachment', 'conflict-note']);
    expect(inventory.conflicts.find((item) => item.kind === 'conflict-note')).toMatchObject({ note: { id: conflict.id } });
    const deletedNote = inventory.deleted.find((item) => item.kind === 'deleted-note')!;
    const deletedAttachment = inventory.deleted.find((item) => item.kind === 'deleted-attachment')!;
    const noteCopy = await restoreAsRecoveryCopy(repository, vault.id, deletedNote);
    expect('markdown' in noteCopy && noteCopy.markdown).toBe('Second');
    expect((await repository.getNote(note.id))?.deletedAt).not.toBeNull();
    const attachmentCopy = await restoreAsRecoveryCopy(repository, vault.id, deletedAttachment);
    expect(await (await repository.getAttachmentBlob(attachmentCopy.id))?.text()).toBe('image bytes');
    const draftCopy = await restoreAsRecoveryCopy(repository, vault.id, inventory.drafts[0]!);
    expect('markdown' in draftCopy && draftCopy.markdown).toBe('Unsaved changes');
  });

  it('validates stored snapshots and reads only newer drafts for automatic recovery', async () => {
    const vault = await repository.initialize();
    const note = await repository.createNote(vault.id, null, 'Draft', 'Saved');
    writeRecoveryDraft({ ...note, markdown: 'Unsaved' });
    expect(readRecoveryDraft(note)?.markdown).toBe('Unsaved');
    expect(listRecoveryDrafts(vault.id)).toHaveLength(1);
    localStorage.setItem(`noor-note-draft:${note.id}`, JSON.stringify({ vaultId: vault.id, title: 'Draft', markdown: '<script>', updatedAt: 'invalid' }));
    expect(listRecoveryDrafts(vault.id)).toEqual([]);
    expect(readRecoveryDraft(note)).toBeNull();
  });

  it('does not bind a forged local draft to a note in another vault', async () => {
    const vault = await repository.initialize();
    const other = await repository.createVault('Other');
    const note = await repository.createNote(other.id, null, 'Private', 'Other vault content');
    localStorage.setItem(`noor-note-draft:${note.id}`, JSON.stringify({ vaultId: vault.id, title: 'Claimed', markdown: 'Local draft only', updatedAt: Date.now() }));
    const inventory = await loadRecoveryInventory(repository, vault.id);
    expect(inventory.drafts[0]).toMatchObject({ kind: 'draft', savedRevision: null });
    const copy = await restoreAsRecoveryCopy(repository, vault.id, inventory.drafts[0]!);
    expect('markdown' in copy && copy.markdown).toBe('Local draft only');
    expect((await repository.getNote(note.id))?.markdown).toBe('Other vault content');
  });
});
