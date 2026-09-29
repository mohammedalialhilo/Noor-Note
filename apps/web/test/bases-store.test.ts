import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readBaseDefinition } from '@noor-note/core';
import { DexieVaultRepository } from '@noor-note/storage';
import { BasesStore } from '../src/lib/bases';

describe('Bases storage', () => {
  let repository: DexieVaultRepository;
  let databaseName: string;
  beforeEach(() => { vi.stubGlobal('window', {}); databaseName = `noor-note-bases-${crypto.randomUUID()}`; repository = new DexieVaultRepository(databaseName); });
  afterEach(async () => { repository.close(); await Dexie.delete(databaseName); vi.unstubAllGlobals(); });

  it('saves, renames, trashes, and restores a Base without changing note Markdown', async () => {
    const vault = await repository.initialize();
    const note = await repository.createNote(vault.id, null, 'Plan', '---\nstatus: Doing\n---\n# Plan');
    const store = new BasesStore(repository, vault.id);
    const created = await store.create('Projects');
    const definition = readBaseDefinition(created);
    const updated = await store.save(created, { ...definition, query: { ...definition.query, property: { field: 'property:status', operator: 'equals', value: 'Doing' } } });
    expect(readBaseDefinition((await store.list())[0]!).query.property?.value).toBe('Doing');
    const renamed = await store.rename(updated, 'Project board');
    expect(renamed.path).toBe('/Bases/Project board.base');
    await expect(store.create('Project board')).rejects.toThrow('already exists');
    const deleted = await store.remove(renamed);
    expect(deleted.deletedAt).not.toBeNull();
    expect((await store.restore(deleted)).deletedAt).toBeNull();
    expect((await repository.getNote(note.id))?.markdown).toBe('---\nstatus: Doing\n---\n# Plan');
  });
});
