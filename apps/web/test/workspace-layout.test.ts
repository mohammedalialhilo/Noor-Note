import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DexieVaultRepository } from '@noor-note/storage';
import { defaultWorkspaceLayout, parseWorkspaceLayout, readCurrentLayout, readStartupWorkspaceId, reconcileWorkspaceLayout, remapWorkspaceLayout, WorkspacesStore, writeCurrentLayout, writeStartupWorkspaceId } from '../src/lib/workspace-layout';

describe('saved workspace layouts', () => {
  let repository: DexieVaultRepository;
  let databaseName: string;
  beforeEach(() => {
    vi.stubGlobal('window', {});
    databaseName = `noor-note-workspaces-${crypto.randomUUID()}`;
    repository = new DexieVaultRepository(databaseName);
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } });
  });
  afterEach(async () => { repository.close(); await Dexie.delete(databaseName); vi.unstubAllGlobals(); });

  it('validates the pane tree and prunes deleted notes and resources', () => {
    const noteId = crypto.randomUUID(), canvasId = crypto.randomUUID(), baseId = crypto.randomUUID();
    const layout = defaultWorkspaceLayout(noteId);
    layout.editor.closedTabs = [{ paneId: layout.editor.activePaneId, tab: { id: crypto.randomUUID(), noteId, pinned: true } }];
    layout.canvasTabs = { ids: [canvasId], activeId: canvasId };
    layout.baseTabs = { ids: [baseId], activeId: baseId };
    expect(parseWorkspaceLayout(layout).editor.selectedNoteId).toBe(noteId);
    expect(() => parseWorkspaceLayout({ ...layout, editor: { ...layout.editor, activePaneId: crypto.randomUUID() } })).toThrow();
    const pruned = reconcileWorkspaceLayout(layout, new Set(), new Set(), new Set());
    expect(pruned.editor.selectedNoteId).toBeNull();
    expect(pruned.editor.closedTabs).toEqual([]);
    expect(pruned.editor.root.kind === 'pane' && pruned.editor.root.tabs).toEqual([]);
    expect(pruned.canvasTabs).toEqual({ ids: [], activeId: null });
    expect(pruned.baseTabs).toEqual({ ids: [], activeId: null });
  });

  it('persists current and startup layouts per vault', () => {
    const vaultId = crypto.randomUUID(), startupId = crypto.randomUUID();
    const layout = defaultWorkspaceLayout();
    writeCurrentLayout(vaultId, layout);
    writeStartupWorkspaceId(vaultId, startupId);
    expect(readCurrentLayout(vaultId)).toEqual(layout);
    expect(readStartupWorkspaceId(vaultId)).toBe(startupId);
    expect(readCurrentLayout(crypto.randomUUID())).toBeNull();
    writeStartupWorkspaceId(vaultId, null);
    expect(readStartupWorkspaceId(vaultId)).toBeNull();
  });

  it('creates, updates, renames, duplicates, and deletes vault scoped snapshots', async () => {
    const vault = await repository.initialize();
    const note = await repository.createNote(vault.id, null, 'Plan', '# Plan');
    const store = new WorkspacesStore(repository, vault.id);
    const original = await store.create('Research', defaultWorkspaceLayout(note.id));
    expect((await store.list()).map((item) => item.name)).toEqual(['Research']);
    const updated = await store.save(original, { ...defaultWorkspaceLayout(note.id), view: 'graph' });
    expect(parseWorkspaceLayout(updated.layout).view).toBe('graph');
    const renamed = await store.rename(updated, 'Writing');
    const copy = await store.duplicate(renamed);
    expect(copy.id).not.toBe(renamed.id);
    expect((await store.list()).map((item) => item.name)).toEqual(['Writing', 'Writing copy']);
    await store.delete(renamed);
    expect((await store.list()).map((item) => item.id)).toEqual([copy.id]);
  });

  it('remaps imported note, resource, and calendar references', () => {
    const oldNote = crypto.randomUUID(), oldCanvas = crypto.randomUUID(), oldBase = crypto.randomUUID(), oldFolder = crypto.randomUUID();
    const newNote = crypto.randomUUID(), newCanvas = crypto.randomUUID(), newBase = crypto.randomUUID(), newFolder = crypto.randomUUID();
    const layout = defaultWorkspaceLayout(oldNote);
    layout.editor.closedTabs = [{ paneId: layout.editor.activePaneId, tab: { id: crypto.randomUUID(), noteId: oldNote, pinned: false } }];
    layout.canvasTabs = { ids: [oldCanvas], activeId: oldCanvas };
    layout.baseTabs = { ids: [oldBase], activeId: oldBase };
    layout.calendar = { ...layout.calendar, folderId: oldFolder, baseId: oldBase };
    const mapped = remapWorkspaceLayout(layout, new Map([[oldNote, newNote]]), new Map([[oldCanvas, newCanvas]]), new Map([[oldBase, newBase]]), new Map([[oldFolder, newFolder]]));
    expect(mapped.editor.selectedNoteId).toBe(newNote);
    expect(mapped.editor.closedTabs[0]?.tab.noteId).toBe(newNote);
    expect(mapped.canvasTabs.activeId).toBe(newCanvas);
    expect(mapped.baseTabs.activeId).toBe(newBase);
    expect(mapped.calendar.folderId).toBe(newFolder);
  });
});
