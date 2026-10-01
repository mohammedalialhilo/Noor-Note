import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { DexieVaultRepository, type AttachmentBytesStore } from '../src';
import type { Attachment, VaultNote } from '@noor-note/core';
import { checksumMarkdown, planAttachmentLinkRename, planLinkRename, planNoteRefactor, planTagRewrite } from '@noor-note/core';

describe('DexieVaultRepository', () => {
  let repository: DexieVaultRepository;
  let databaseName: string;
  const storedBytes = new Map<string, Blob>();
  const bytes: AttachmentBytesStore = {
    async write(id, blob) { storedBytes.set(id, blob); return 'indexeddb'; },
    async read(attachment: Attachment) { return storedBytes.get(attachment.id); },
    async remove(attachment: Attachment) { storedBytes.delete(attachment.id); },
  };

  beforeEach(() => {
    vi.stubGlobal('window', {});
    databaseName = `noor-note-vault-test-${crypto.randomUUID()}`;
    storedBytes.clear();
    repository = new DexieVaultRepository(databaseName, bytes);
  });
  afterEach(async () => {
    repository.close();
    await Dexie.delete(databaseName);
    vi.unstubAllGlobals();
  });

  it('upgrades legacy checkbox summaries from source Markdown without changing note bodies', async () => {
    const legacy = new Dexie(databaseName);
    legacy.version(3).stores({
      notes: 'id, updatedAt, createdAt', vaults: 'id, deletedAt', folders: 'id, vaultId, parentId, path, deletedAt',
      noteEntries: 'id, vaultId, folderId, path, updatedAt, deletedAt', noteBodies: 'id',
      attachments: 'id, vaultId, folderId, path, deletedAt', attachmentBlobs: 'id',
      revisions: 'id, noteId, vaultId, createdAt', objects: 'id, vaultId, kind, [vaultId+kind]',
      state: 'key', reservations: 'key, id', connectedDirectories: 'vaultId',
    });
    const vaultId = crypto.randomUUID();
    const noteId = crypto.randomUUID();
    const timestamp = '2026-09-24T10:00:00.000Z';
    const markdown = '- [ ] Review #work @due(2026-10-01) @priority(high)';
    await legacy.table('vaults').put({ id: vaultId, name: 'Legacy', createdAt: timestamp, updatedAt: timestamp, deletedAt: null, settings: { sortBy: 'name', sortDirection: 'asc' } });
    await legacy.table('state').put({ key: 'activeVaultId', value: vaultId });
    await legacy.table('noteEntries').put({ id: noteId, vaultId, folderId: null, path: '/Review.md', title: 'Review', createdAt: timestamp, updatedAt: timestamp, deletedAt: null, trashGroupId: null, aliases: [], properties: {}, revision: 1, checksum: await checksumMarkdown(markdown), excerpt: 'Review', tags: [], links: [], tasks: [{ line: 1, text: 'Review', completed: false }], taskCount: 1 });
    await legacy.table('noteBodies').put({ id: noteId, markdown });
    legacy.close();

    const vault = await repository.initialize();
    const entry = (await repository.listTree(vault.id)).notes[0];
    expect(entry?.tasks[0]).toMatchObject({ line: 1, text: 'Review', dueDate: '2026-10-01', priority: 'high', tags: ['work'] });
    expect((await repository.getNote(noteId))?.markdown).toBe(markdown);
  });

  it('indexes wiki and local Markdown links in note summaries for Base queries', async () => {
    const vault = await repository.initialize();
    const note = await repository.createNote(vault.id, null, 'Sources', '[[Alpha]] and [Beta](Beta.md)');
    const tree = await repository.listTree(vault.id);
    expect(tree.notes.find((item) => item.id === note.id)?.links).toEqual(['Alpha', 'Beta.md']);
  });

  it('reads note bodies in input order with one batch and skips missing IDs', async () => {
    const vault = await repository.initialize();
    const first = await repository.createNote(vault.id, null, 'First', '# First');
    const second = await repository.createNote(vault.id, null, 'Second', '# Second');
    expect((await repository.getNotes([second.id, crypto.randomUUID(), first.id])).map((note) => [note.id, note.markdown])).toEqual([
      [second.id, '# Second'], [first.id, '# First'],
    ]);
  });

  it('renders note content against the final collision-free path atomically', async () => {
    const vault = await repository.initialize();
    await repository.createNote(vault.id, null, 'Plan', 'First');
    const second = await repository.createNote(vault.id, null, 'Plan', (path) => `Filename: ${path.split('/').at(-1)}`);
    expect(second.path).toBe('/Plan (2).md');
    expect((await repository.getNote(second.id))?.markdown).toBe('Filename: Plan (2).md');
    await expect(repository.createNote(vault.id, null, 'Broken', () => { throw new Error('Template failed'); })).rejects.toThrow('Template failed');
    expect((await repository.listTree(vault.id)).notes.map((note) => note.title)).toEqual(['Plan', 'Plan']);
  });

  it('creates, renames, switches, and soft deletes vaults with statistics', async () => {
    const first = await repository.initialize();
    const second = await repository.createVault('Research');
    expect((await repository.listVaults()).length).toBe(2);
    expect((await repository.getActiveVault()).id).toBe(second.id);
    expect((await repository.renameVault(second.id, 'Research 2026')).name).toBe('Research 2026');
    await repository.setActiveVault(first.id);
    const folder = await repository.createFolder(first.id, null, 'Sources');
    await repository.createNote(first.id, folder.id, 'Article', 'Text');
    expect(await repository.getStatistics(first.id)).toMatchObject({ folders: 1, notes: 1, trashed: 0 });
    await repository.deleteVault(first.id);
    expect((await repository.getActiveVault()).id).toBe(second.id);
    expect((await repository.listDeletedVaults()).map((item) => item.id)).toContain(first.id);
    expect((await repository.restoreVault(first.id)).deletedAt).toBeNull();
    expect(await repository.listDeletedVaults()).toHaveLength(0);
  });

  it('moves a nested folder and its note without losing body, and rejects collisions and cycles', async () => {
    const vault = await repository.initialize();
    const parent = await repository.createFolder(vault.id, null, 'Projects');
    const child = await repository.createFolder(vault.id, parent.id, 'Client');
    const note = await repository.createNote(vault.id, child.id, 'Brief', 'Private body');
    const destination = await repository.createFolder(vault.id, null, 'Archive');
    await repository.moveFolder(parent.id, destination.id);
    expect((await repository.getNote(note.id))?.path).toBe('/Archive/Projects/Client/Brief.md');
    expect((await repository.getNote(note.id))?.markdown).toBe('Private body');
    await expect(repository.moveFolder(destination.id, child.id)).rejects.toThrow(/into itself/);
    await repository.createFolder(vault.id, destination.id, 'Existing');
    await expect(repository.renameFolder(parent.id, 'Existing')).rejects.toThrow(/Path already exists/);
  });

  it('renames, moves, duplicates, trashes, restores, and permanently deletes notes', async () => {
    const vault = await repository.initialize();
    const target = await repository.createFolder(vault.id, null, 'Target');
    const first = await repository.createNote(vault.id, null, 'Draft', 'One');
    const second = await repository.createNote(vault.id, null, 'Other', 'Two');
    await expect(repository.renameNote(second.id, 'Draft')).rejects.toThrow(/Path already exists/);
    expect((await repository.renameNote(first.id, 'Plan')).path).toBe('/Plan.md');
    expect((await repository.moveNote(first.id, target.id)).path).toBe('/Target/Plan.md');
    const copy = await repository.duplicateNote(first.id);
    expect(copy.id).not.toBe(first.id);
    expect(copy.markdown).toBe(first.markdown);
    await repository.deleteNote(first.id);
    expect((await repository.listTree(vault.id)).notes.some((note) => note.id === first.id)).toBe(false);
    expect((await repository.restoreNote(first.id)).deletedAt).toBeNull();
    await repository.deleteNote(first.id);
    await repository.permanentlyDeleteNote(first.id);
    expect(await repository.getNote(first.id)).toBeUndefined();
  });

  it('retains the old title as an alias and atomically applies a confirmed link rename', async () => {
    const vault = await repository.initialize();
    const target = await repository.createNote(vault.id, null, 'Plan', '# Scope');
    const source = await repository.createNote(vault.id, null, 'Source', 'See [[Plan#Scope]].');
    const plan = planLinkRename([target, source], target, 'Strategy');
    await repository.renameNoteWithLinks(target.id, 'Strategy', target.revision, plan, [target, source].map(({ id, revision }) => ({ id, revision })));
    expect((await repository.getNote(target.id))?.aliases).toContain('Plan');
    expect((await repository.getNote(source.id))?.markdown).toBe('See [[Strategy#Scope]].');
    await repository.saveNote(target.id, { markdown: '# Scope\nMore detail' });
    expect((await repository.getNote(target.id))?.aliases).toContain('Plan');
    const stale = planLinkRename([await repository.getNote(target.id) ?? target, await repository.getNote(source.id) ?? source], await repository.getNote(target.id) ?? target, 'Outline');
    const before = [await repository.getNote(target.id), await repository.getNote(source.id)].filter((item): item is VaultNote => Boolean(item));
    await repository.saveNote(source.id, { markdown: 'Changed [[Strategy]].' });
    await expect(repository.renameNoteWithLinks(target.id, 'Outline', before[0]!.revision, stale, before.map(({ id, revision }) => ({ id, revision })))).rejects.toThrow(/changed after the preview/i);
    expect((await repository.getNote(target.id))?.title).toBe('Strategy');
    const refreshed = [await repository.getNote(target.id), await repository.getNote(source.id)].filter((item): item is VaultNote => Boolean(item));
    const nextPlan = planLinkRename(refreshed, refreshed[0]!, 'Outline');
    await repository.createNote(vault.id, null, 'New note', '[[Strategy]]');
    await expect(repository.renameNoteWithLinks(target.id, 'Outline', refreshed[0]!.revision, nextPlan, refreshed.map(({ id, revision }) => ({ id, revision })))).rejects.toThrow(/vault changed after the rename preview/i);
  });

  it('applies vault-wide tag edits atomically and rejects a stale preview', async () => {
    const vault = await repository.initialize();
    const first = await repository.createNote(vault.id, null, 'First', '#work');
    const second = await repository.createNote(vault.id, null, 'Second', 'Study #work/notes');
    const snapshot = [first, second].map(({ id, revision }) => ({ id, revision }));
    const changes = planTagRewrite([first, second], 'work', 'projects', true);
    await repository.applyVaultNoteEdits(vault.id, changes, snapshot);
    expect((await repository.getNote(first.id))?.markdown).toBe('#projects');
    expect((await repository.getNote(second.id))?.markdown).toBe('Study #projects/notes');
    await expect(repository.applyVaultNoteEdits(vault.id, changes, snapshot)).rejects.toThrow(/changed after the preview/i);
  });

  it('restores a deleted folder subtree and empties trash', async () => {
    const vault = await repository.initialize();
    const folder = await repository.createFolder(vault.id, null, 'Work');
    const child = await repository.createFolder(vault.id, folder.id, 'Nested');
    const note = await repository.createNote(vault.id, child.id, 'Idea', 'Body');
    await repository.deleteFolder(folder.id);
    expect((await repository.listTrash(vault.id)).notes.map((item) => item.id)).toContain(note.id);
    await repository.restoreFolder(folder.id);
    expect((await repository.listTree(vault.id)).notes.map((item) => item.id)).toContain(note.id);
    await repository.deleteFolder(folder.id);
    await repository.emptyTrash(vault.id);
    expect(await repository.getNote(note.id)).toBeUndefined();
    expect((await repository.listTrash(vault.id)).folders).toHaveLength(0);
  });

  it('stores attachment bytes separately from tree metadata and supports trash', async () => {
    const vault = await repository.initialize();
    const attachment = await repository.addAttachment(vault.id, null, new Blob(['audio'], { type: 'audio/mpeg' }), 'clip.mp3');
    expect((await repository.listTree(vault.id)).attachments[0]?.size).toBe(5);
    expect(await (await repository.getAttachmentBlob(attachment.id))?.text()).toBe('audio');
    await repository.renameAttachment(attachment.id, 'renamed.mp3');
    const folder = await repository.createFolder(vault.id, null, 'Media');
    expect((await repository.moveAttachment(attachment.id, folder.id)).path).toBe('/Media/renamed.mp3');
    await repository.deleteAttachment(attachment.id);
    expect((await repository.restoreAttachment(attachment.id)).path).toBe('/Media/renamed.mp3');
    await repository.deleteAttachment(attachment.id);
    await repository.permanentlyDeleteAttachment(attachment.id);
    expect(storedBytes.size).toBe(0);
  });

  it('validates recording metadata before storing bytes', async () => {
    const vault = await repository.initialize();
    const before = storedBytes.size;
    await expect(repository.addAttachment(vault.id, null, new Blob(['audio'], { type: 'audio/webm' }), 'Bad.webm', { recordedAt: 'invalid', durationMs: -1 })).rejects.toThrow();
    expect(storedBytes.size).toBe(before);
    const saved = await repository.addAttachment(vault.id, null, new Blob(['audio'], { type: 'audio/webm' }), 'Good.webm', { recordedAt: new Date().toISOString(), durationMs: 500 });
    expect((await repository.listTree(vault.id)).attachments[0]?.recording).toEqual(saved.recording);
  });

  it('renames a recording and its Markdown links in one revision-checked transaction', async () => {
    const vault = await repository.initialize();
    const attachment = await repository.addAttachment(vault.id, null, new Blob(['audio'], { type: 'audio/webm' }), 'Voice.webm', { recordedAt: new Date().toISOString(), durationMs: 500 });
    const note = await repository.createNote(vault.id, null, 'Plan', '[Listen](Voice.webm)');
    const changes = planAttachmentLinkRename([note], attachment.path, '/Interview.webm');
    const renamed = await repository.renameAttachmentWithLinks(attachment.id, 'Interview.webm', attachment.path, attachment.updatedAt, changes, [{ id: note.id, revision: note.revision }]);
    expect(renamed.path).toBe('/Interview.webm');
    expect(renamed.recording).toEqual(attachment.recording);
    expect((await repository.getNote(note.id))?.markdown).toBe('[Listen](Interview.webm)');
    await expect(repository.renameAttachmentWithLinks(attachment.id, 'Again.webm', attachment.path, attachment.updatedAt, changes, [{ id: note.id, revision: note.revision }])).rejects.toThrow(/changed after the preview/);
    expect((await repository.listTree(vault.id)).attachments[0]?.path).toBe('/Interview.webm');
    const latest = await repository.getNote(note.id);
    const nextChanges = planAttachmentLinkRename([latest!], renamed.path, '/Again.webm');
    await repository.saveNote(note.id, { markdown: '[Listen](Interview.webm)\nChanged' });
    await expect(repository.renameAttachmentWithLinks(renamed.id, 'Again.webm', renamed.path, renamed.updatedAt, nextChanges, [{ id: latest!.id, revision: latest!.revision }])).rejects.toThrow(/changed after the preview/);
    expect((await repository.listTree(vault.id)).attachments[0]?.path).toBe('/Interview.webm');
  });

  it('migrates existing version 1 notes into an active vault', async () => {
    repository.close();
    const legacy = new Dexie(databaseName);
    legacy.version(1).stores({ notes: 'id, updatedAt, createdAt' });
    await legacy.table('notes').add({ id: crypto.randomUUID(), title: 'Old', content: 'Kept body', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
    legacy.close();
    repository = new DexieVaultRepository(databaseName, bytes);
    const vault = await repository.initialize();
    const tree = await repository.listTree(vault.id);
    expect(tree.notes).toHaveLength(1);
    expect((await repository.getNote(tree.notes[0]!.id))?.markdown).toBe('Kept body');
  });

  it('keeps trash intact when its path has been reused and rolls back a blocked restore', async () => {
    const vault = await repository.initialize();
    const original = await repository.createNote(vault.id, null, 'Same', 'Original body');
    await repository.deleteNote(original.id);
    const replacement = await repository.createNote(vault.id, null, 'Same', 'Replacement body');
    await expect(repository.restoreNote(original.id)).rejects.toThrow(/Path already exists/);
    expect((await repository.listTrash(vault.id)).notes.map((item) => item.id)).toContain(original.id);
    expect((await repository.getNote(replacement.id))?.markdown).toBe('Replacement body');
  });

  it('groups rapid autosaves into one checkpoint and records a folder move checkpoint', async () => {
    const vault = await repository.initialize();
    const folder = await repository.createFolder(vault.id, null, 'Work');
    const note = await repository.createNote(vault.id, folder.id, 'Draft', 'First');
    await repository.saveNote(note.id, { markdown: 'Second' });
    await repository.saveNote(note.id, { markdown: 'Third' });
    expect((await repository.listRevisions(note.id)).map((item) => item.markdown).sort()).toEqual(['First', 'Third']);
    await repository.renameFolder(folder.id, 'Archive');
    expect((await repository.getNote(note.id))?.path).toBe('/Archive/Draft.md');
    expect((await repository.listRevisions(note.id)).some((item) => item.kind === 'move' && item.path === '/Archive/Draft.md')).toBe(true);
  });

  it('restores content and metadata as a new checkpoint and duplicates an earlier revision', async () => {
    const vault = await repository.initialize();
    const folder = await repository.createFolder(vault.id, null, 'Research');
    const note = await repository.createNote(vault.id, folder.id, 'Draft', 'Original');
    await repository.saveNote(note.id, { aliases: ['Idea'], properties: { status: 'open' } }, true);
    const source = (await repository.listRevisions(note.id))[0]!;
    await repository.moveNote(note.id, null);
    await repository.saveNote(note.id, { title: 'Final', markdown: 'Changed', aliases: [], properties: { status: 'done' } }, true);
    const before = (await repository.getNote(note.id))!;
    await expect(repository.restoreRevision(note.id, source.id, before.revision - 1)).rejects.toThrow(/changed after opening history/i);
    const restored = await repository.restoreRevision(note.id, source.id, before.revision);
    expect(restored).toMatchObject({ path: '/Research/Draft.md', folderId: folder.id, title: 'Draft', markdown: 'Original', aliases: ['Idea'], properties: { status: 'open' }, revision: before.revision + 1 });
    const history = await repository.listRevisions(note.id);
    expect(history[0]).toMatchObject({ kind: 'restore', restoredFromId: source.id, metadata: { folderId: folder.id } });
    expect(history.some((item) => item.markdown === 'Changed')).toBe(true);
    const duplicate = await repository.duplicateRevision(note.id, source.id);
    expect(duplicate).toMatchObject({ markdown: 'Original', folderId: folder.id, aliases: ['Idea'], properties: { status: 'open' } });
    expect(duplicate.id).not.toBe(note.id);
  });

  it('keeps the current note untouched when an archived path is occupied', async () => {
    const vault = await repository.initialize();
    const note = await repository.createNote(vault.id, null, 'Draft', 'First');
    const source = (await repository.listRevisions(note.id))[0]!;
    await repository.renameNote(note.id, 'Renamed');
    await repository.createNote(vault.id, null, 'Draft', 'Other');
    const before = (await repository.getNote(note.id))!;
    await expect(repository.restoreRevision(note.id, source.id, before.revision)).rejects.toThrow(/Path already exists/);
    expect(await repository.getNote(note.id)).toEqual(before);
  });

  it('applies a multi-note refactor atomically, checkpoints revisions, and rejects stale previews', async () => {
    const vault = await repository.initialize();
    const source = await repository.createNote(vault.id, null, 'Source', '# Source\n\n## Topic\nBody ^stable\n');
    const index = await repository.createNote(vault.id, null, 'Index', `[[Source^stable]]<!-- noor-note-id:${source.id} -->`);
    const plan = planNoteRefactor([source, index], { kind: 'extract-heading', sourceId: source.id, headingId: 'topic' });
    const result = await repository.applyNoteRefactor(vault.id, plan);
    expect(result.created).toHaveLength(1);
    expect((await repository.getNote(result.created[0]!.id))?.markdown).toContain('Body ^stable');
    expect((await repository.getNote(index.id))?.markdown).toContain(`noor-note-id:${result.created[0]!.id}`);
    expect((await repository.listRevisions(source.id)).some((revision) => revision.kind === 'manual')).toBe(true);
    await expect(repository.applyNoteRefactor(vault.id, plan)).rejects.toThrow(/changed after the preview/);
    expect((await repository.listTree(vault.id)).notes).toHaveLength(3);
  });
});
