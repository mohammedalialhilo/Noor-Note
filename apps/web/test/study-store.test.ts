import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { studyCandidatesFromMarkdown } from '@noor-note/core';
import { DexieVaultRepository } from '@noor-note/storage';
import { exportVaultZip, importVaultZip } from '../src/lib/vault-archive';
import { StudyStore } from '../src/lib/study';

describe('study storage and portability', () => {
  let repository: DexieVaultRepository, name: string;
  beforeEach(() => { vi.stubGlobal('window', {}); name = `noor-note-study-${crypto.randomUUID()}`; repository = new DexieVaultRepository(name); });
  afterEach(async () => { repository.close(); await Dexie.delete(name); vi.unstubAllGlobals(); });

  it('imports candidates once, records reviews, and remaps note IDs in a vault ZIP', async () => {
    const vault = await repository.initialize();
    const note = await repository.createNote(vault.id, null, 'Biology', 'Q:: Cell?\nA:: Basic unit');
    const store = new StudyStore(repository, vault.id);
    const candidates = studyCandidatesFromMarkdown(note.markdown);
    const added = await store.add(note.id, candidates);
    expect(added).toHaveLength(1);
    expect(await store.add(note.id, candidates)).toHaveLength(0);
    const reviewed = await store.review(added[0]!.id, 'good', added[0]!.updatedAt);
    expect(reviewed.history).toHaveLength(1);
    await expect(store.review(reviewed.id, 'easy', added[0]!.updatedAt)).rejects.toThrow('changed');
    const importedId = await importVaultZip(repository, await exportVaultZip(repository, vault.id));
    const imported = (await new StudyStore(repository, importedId).list())[0]!;
    expect(imported.id).not.toBe(added[0]!.id);
    expect(imported.sourceNoteId).toBe((await repository.listTree(importedId)).notes[0]!.id);
    expect(imported.history).toHaveLength(1);
  });

  it('does not create cards for a missing or cross-vault source', async () => {
    const first = await repository.initialize();
    const second = await repository.createVault('Second');
    const note = await repository.createNote(second.id, null, 'Other', 'Q:: A\nA:: B');
    await expect(new StudyStore(repository, first.id).add(note.id, studyCandidatesFromMarkdown(note.markdown))).rejects.toThrow('unavailable');
  });
});
