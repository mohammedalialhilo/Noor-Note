import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bookmarkSchema, newBase, newCanvas } from '@noor-note/core';
import { DexieVaultRepository } from '@noor-note/storage';
import { BookmarksStore } from '../src/lib/bookmarks';

describe('bookmark storage', () => {
  let repository: DexieVaultRepository;
  let databaseName: string;
  beforeEach(() => { vi.stubGlobal('window', {}); databaseName = `noor-note-bookmarks-${crypto.randomUUID()}`; repository = new DexieVaultRepository(databaseName); });
  afterEach(async () => { repository.close(); await Dexie.delete(databaseName); vi.unstubAllGlobals(); });

  it('supports typed targets, nested groups, moves, rename, and group deletion', async () => {
    const vault = await repository.initialize();
    const note = await repository.createNote(vault.id, null, 'Plan', '# Overview\nText ^block-one');
    const base = newBase(vault.id, 'Plans', []), canvas = newCanvas(vault.id, 'Map', []);
    await repository.putObject('base', base); await repository.putObject('canvas', canvas);
    const store = new BookmarksStore(repository, vault.id);
    const group = await store.create({ kind: 'group', title: 'Research', parentId: null });
    const child = await store.create({ kind: 'group', title: 'Sources', parentId: group.id });
    const heading = await store.create({ kind: 'heading', title: 'Overview', parentId: child.id, noteId: note.id, fragment: 'overview' });
    await store.create({ kind: 'block', title: 'Quote', parentId: null, noteId: note.id, fragment: 'block-one' });
    await store.create({ kind: 'base', title: 'Plans', parentId: null, resourceId: base.id });
    await store.create({ kind: 'canvas', title: 'Map', parentId: null, resourceId: canvas.id });
    await store.create({ kind: 'search', title: 'Open', parentId: null, query: 'status:open' });
    await store.create({ kind: 'url', title: 'Reference', parentId: null, url: 'https://example.org' });
    expect((await store.list()).length).toBe(8);
    await expect(store.update(group, { parentId: child.id })).rejects.toThrow('cannot contain itself');
    await expect(store.create({ kind: 'url', title: 'Unsafe', parentId: null, url: 'javascript:alert(1)' })).rejects.toThrow();
    await expect(store.create({ kind: 'heading', title: 'Missing', parentId: null, noteId: note.id, fragment: 'missing' })).rejects.toThrow('Heading was not found');
    await store.update(heading, { title: 'Introduction', parentId: null });
    await store.remove(group);
    const remaining = await store.list();
    expect(remaining.find((item) => item.id === child.id)?.parentId).toBeNull();
    expect(remaining.find((item) => item.id === heading.id)?.title).toBe('Introduction');
  });

  it('toggles favorite and pinned notes without changing Markdown and reads legacy URLs', async () => {
    const vault = await repository.initialize();
    const note = await repository.createNote(vault.id, null, 'Focus', '# Focus');
    const store = new BookmarksStore(repository, vault.id);
    expect((await store.toggleNoteFlag(note.id, 'favorite')).favorite).toBe(true);
    expect((await store.toggleNoteFlag(note.id, 'pinned')).pinned).toBe(true);
    expect((await store.toggleNoteFlag(note.id, 'favorite')).favorite).toBe(false);
    expect((await store.list()).filter((item) => item.kind === 'note')).toHaveLength(1);
    expect((await repository.getNote(note.id))?.markdown).toBe('# Focus');
    const now = new Date().toISOString();
    const legacy = bookmarkSchema.parse({ id: crypto.randomUUID(), vaultId: vault.id, url: 'https://example.org', title: 'Old link', createdAt: now, updatedAt: now, deletedAt: null });
    expect(legacy.kind).toBe('url');
  });
});
