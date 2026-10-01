import {
  attachmentSchema, checksumMarkdown, extractTags, folderSchema, joinVaultPath, makeVaultNote, normalizeVaultPath, revisionSchema,
  ocrRecordSchema, parseInternalLinks, parsePortableMarkdown, parseTaskRecords, pathKey, pdfAnnotationSchema, recordingMetadataSchema, safeFileStem, transcriptSchema, vaultNoteSchema, vaultObjectSchemas, vaultSchema,
  type Attachment, type AttachmentLinkChange, type Folder, type NoteRefactorPlan, type RenameChange, type TagChange, type Revision, type Vault, type VaultNote, type VaultObject, type VaultObjectKind,
} from '@noor-note/core';
import Dexie, { type Table } from 'dexie';
import { BrowserAttachmentStore, type AttachmentBytesStore } from './attachment-store';
import type { NoteEntry, StoredVaultObject, SyncTombstone, VaultRepository, VaultStatistics, VaultTree } from './vault-types';

interface LegacyNote { id: string; title: string; content: string; createdAt: string; updatedAt: string }
interface NoteBody { id: string; markdown: string }
interface BlobRecord { id: string; blob: Blob }
interface StateRecord { key: string; value: string }
interface ConnectedDirectory { vaultId: string; handle: FileSystemDirectoryHandle }
interface PathReservation { key: string; id: string; kind: 'folder' | 'note' | 'attachment' }
interface StoredSyncTombstone { key: string; vaultId: string; value: SyncTombstone }
const now = () => new Date().toISOString();
const reservationKey = (vaultId: string, pathname: string) => `${vaultId}:${pathKey(pathname)}`;
const isWithin = (pathname: string, root: string) => pathname === root || pathname.startsWith(`${root}/`);
const rebase = (pathname: string, oldRoot: string, newRoot: string) => normalizeVaultPath(`${newRoot}${pathname.slice(oldRoot.length)}`);
const emptyMarkdownChecksum = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

function makeCheckpoint(note: VaultNote, kind: Revision['kind'], options: { id?: string; restoredFromId?: string } = {}): Revision {
  return revisionSchema.parse({
    id: options.id ?? crypto.randomUUID(), vaultId: note.vaultId, noteId: note.id,
    number: note.revision, title: note.title, path: note.path, markdown: note.markdown,
    checksum: note.checksum, createdAt: note.updatedAt, kind,
    metadata: { folderId: note.folderId, aliases: note.aliases, properties: note.properties },
    origin: 'local', ...(options.restoredFromId ? { restoredFromId: options.restoredFromId } : {}),
  });
}

export function toNoteEntry(note: VaultNote): NoteEntry {
  const { markdown, ...metadata } = note;
  const excerpt = markdown.replace(/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/u, '').replace(/```[\s\S]*?```/gu, ' ').replace(/[#>*_`~]/gu, ' ').replaceAll('[', ' ').replaceAll(']', ' ').replace(/\s+/gu, ' ').trim().slice(0, 140);
  const tasks = parseTaskRecords(markdown);
  return { ...metadata, excerpt, tags: extractTags(markdown), links: parseInternalLinks(markdown).map((link) => link.target || link.targetId || '').filter(Boolean), tasks, taskCount: tasks.filter((task) => !task.completed).length };
}

class VaultDatabase extends Dexie {
  notes!: Table<LegacyNote, string>;
  vaults!: Table<Vault, string>;
  folders!: Table<Folder, string>;
  noteEntries!: Table<NoteEntry, string>;
  noteBodies!: Table<NoteBody, string>;
  attachments!: Table<Attachment, string>;
  attachmentBlobs!: Table<BlobRecord, string>;
  revisions!: Table<Revision, string>;
  objects!: Table<StoredVaultObject, string>;
  state!: Table<StateRecord, string>;
  connectedDirectories!: Table<ConnectedDirectory, string>;
  reservations!: Table<PathReservation, string>;
  syncTombstones!: Table<StoredSyncTombstone, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({ notes: 'id, updatedAt, createdAt' });
    this.version(2).stores({
      notes: 'id, updatedAt, createdAt',
      vaults: 'id, deletedAt', folders: 'id, vaultId, parentId, path, deletedAt',
      noteEntries: 'id, vaultId, folderId, path, updatedAt, deletedAt', noteBodies: 'id',
      attachments: 'id, vaultId, folderId, path, deletedAt', attachmentBlobs: 'id',
      revisions: 'id, noteId, vaultId, createdAt', objects: 'id, vaultId, kind, [vaultId+kind]',
      state: 'key', reservations: 'key, id',
    }).upgrade(async (transaction) => {
      const oldNotes = await transaction.table<LegacyNote, string>('notes').toArray();
      if (!oldNotes.length) return;
      const vaultId = crypto.randomUUID();
      const createdAt = now();
      const vault = vaultSchema.parse({ id: vaultId, name: 'My vault', createdAt, updatedAt: createdAt, deletedAt: null, settings: { sortBy: 'name', sortDirection: 'asc' } });
      await transaction.table<Vault, string>('vaults').add(vault);
      await transaction.table<StateRecord, string>('state').put({ key: 'activeVaultId', value: vaultId });
      const used = new Set<string>();
      const migrated = await Dexie.waitFor(Promise.all(oldNotes.map(async (legacy) => {
        const title = legacy.title || 'Untitled note';
        const stem = safeFileStem(title);
        let path = joinVaultPath('/', `${stem}.md`);
        let suffix = 2;
        while (used.has(pathKey(path))) path = joinVaultPath('/', `${stem} (${suffix++}).md`);
        used.add(pathKey(path));
        return vaultNoteSchema.parse({
          id: legacy.id, vaultId, folderId: null, path, title: legacy.title, markdown: legacy.content,
          createdAt: legacy.createdAt, updatedAt: legacy.updatedAt, deletedAt: null, trashGroupId: null,
          aliases: [], properties: {}, revision: 1, checksum: await checksumMarkdown(legacy.content),
        });
      })));
      await transaction.table<NoteEntry, string>('noteEntries').bulkAdd(migrated.map(toNoteEntry));
      await transaction.table<NoteBody, string>('noteBodies').bulkAdd(migrated.map((note) => ({ id: note.id, markdown: note.markdown })));
      await transaction.table<PathReservation, string>('reservations').bulkAdd(migrated.map((note) => ({ key: reservationKey(vaultId, note.path), id: note.id, kind: 'note' })));
      await transaction.table<Revision, string>('revisions').bulkAdd(migrated.map((note) => makeCheckpoint(note, 'manual')));
      await transaction.table<LegacyNote, string>('notes').clear();
    });
    this.version(3).stores({ connectedDirectories: 'vaultId' });
    this.version(4).stores({}).upgrade(async (transaction) => {
      const entries = await transaction.table<NoteEntry, string>('noteEntries').toArray();
      const entryTable = transaction.table<NoteEntry, string>('noteEntries');
      const bodyTable = transaction.table<NoteBody, string>('noteBodies');
      for (const entry of entries) {
        if (Array.isArray(entry.tasks) && entry.tasks.every((task) => 'priority' in task && 'issues' in task)) continue;
        const body = await bodyTable.get(entry.id);
        if (!body) continue;
        const tasks = parseTaskRecords(body.markdown);
        await entryTable.put({ ...entry, tasks, taskCount: tasks.filter((task) => !task.completed).length });
      }
    });
    this.version(5).stores({ syncTombstones: 'key, vaultId' });
  }
}

export class DexieVaultRepository implements VaultRepository {
  private readonly database: VaultDatabase;
  private readonly bytes: AttachmentBytesStore;

  constructor(databaseName = 'noor-note', bytes?: AttachmentBytesStore) {
    if (typeof window === 'undefined' || typeof indexedDB === 'undefined') throw new Error('Vault storage requires a browser with IndexedDB');
    this.database = new VaultDatabase(databaseName);
    this.bytes = bytes ?? new BrowserAttachmentStore({
      put: async (id, blob) => { await this.database.attachmentBlobs.put({ id, blob }); },
      get: async (id) => (await this.database.attachmentBlobs.get(id))?.blob,
      delete: async (id) => { await this.database.attachmentBlobs.delete(id); },
    });
  }

  private async removeAttachmentSidecars(vaultId: string, attachmentIds: ReadonlySet<string>): Promise<void> {
    if (!attachmentIds.size) return;
    for (const [kind, schema] of [['pdfAnnotation', pdfAnnotationSchema], ['ocrRecord', ocrRecordSchema], ['transcript', transcriptSchema]] as const) {
      const objects = await this.database.objects.where('[vaultId+kind]').equals([vaultId, kind]).toArray();
      for (const object of objects) {
        const parsed = schema.safeParse(object.value);
        if (parsed.success && attachmentIds.has(parsed.data.attachmentId)) await this.database.objects.delete(object.id);
      }
    }
  }

  async initialize(): Promise<Vault> {
    const active = await this.database.state.get('activeVaultId');
    if (active) {
      const vault = await this.database.vaults.get(active.value);
      if (vault && !vault.deletedAt) return vault;
    }
    const existing = (await this.listVaults())[0];
    if (existing) { await this.setActiveVault(existing.id); return existing; }
    return this.createVault('My vault');
  }

  async listVaults(): Promise<Vault[]> {
    return (await this.database.vaults.toArray()).filter((vault) => !vault.deletedAt).sort((a, b) => a.name.localeCompare(b.name));
  }
  async listDeletedVaults(): Promise<Vault[]> {
    return (await this.database.vaults.toArray()).filter((vault) => Boolean(vault.deletedAt)).sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? ''));
  }
  getVault(id: string): Promise<Vault | undefined> { return this.database.vaults.get(id); }

  async importSyncedVault(input: Vault): Promise<Vault> {
    const vault = vaultSchema.parse(input);
    const current = await this.database.vaults.get(vault.id);
    if (current?.settings.syncEncryptionMode === 'e2ee' && vault.settings.syncEncryptionMode !== 'e2ee') throw new Error('Encrypted vault cannot accept a plaintext vault snapshot');
    await this.database.vaults.put(vault);
    return vault;
  }

  async applySyncedFolder(input: Folder): Promise<void> {
    const folder = folderSchema.parse(input);
    await this.requireVault(folder.vaultId);
    await this.database.transaction('rw', this.database.folders, this.database.reservations, async () => {
      const current = await this.database.folders.get(folder.id);
      if (current && current.path !== folder.path && !current.deletedAt) await this.release(folder.vaultId, current.path);
      if (!folder.deletedAt) await this.reserve(folder.vaultId, folder.path, folder.id, 'folder');
      if (folder.deletedAt && current && !current.deletedAt) await this.release(folder.vaultId, current.path);
      await this.database.folders.put(folder);
    });
  }

  async applySyncedNote(input: VaultNote): Promise<void> {
    const note = vaultNoteSchema.parse(input);
    if (await checksumMarkdown(note.markdown) !== note.checksum) throw new Error('Remote note checksum does not match its Markdown');
    await this.requireVault(note.vaultId);
    await this.database.transaction('rw', this.database.noteEntries, this.database.noteBodies, this.database.reservations, async () => {
      const current = await this.database.noteEntries.get(note.id);
      if (current && current.path !== note.path && !current.deletedAt) await this.release(note.vaultId, current.path);
      if (!note.deletedAt) await this.reserve(note.vaultId, note.path, note.id, 'note');
      if (note.deletedAt && current && !current.deletedAt) await this.release(note.vaultId, current.path);
      await this.database.noteEntries.put(toNoteEntry(note));
      await this.database.noteBodies.put({ id: note.id, markdown: note.markdown });
    });
  }

  async applySyncedAttachment(input: Attachment, blob: Blob | null): Promise<void> {
    const attachment = attachmentSchema.parse(input);
    await this.requireVault(attachment.vaultId);
    const current = await this.database.attachments.get(attachment.id);
    if (!current && !blob && !attachment.deletedAt) throw new Error('Remote attachment bytes are missing');
    const previousBlob = blob && current ? await this.bytes.read(current) : undefined;
    let stored = attachmentSchema.parse({ ...attachment, storage: current?.storage ?? 'indexeddb' });
    if (blob) {
      const storage = await this.bytes.write(attachment.id, blob);
      stored = attachmentSchema.parse({ ...attachment, storage });
    }
    try {
      await this.database.transaction('rw', this.database.attachments, this.database.reservations, async () => {
        if (current && current.path !== stored.path && !current.deletedAt) await this.release(stored.vaultId, current.path);
        if (!stored.deletedAt) await this.reserve(stored.vaultId, stored.path, stored.id, 'attachment');
        if (stored.deletedAt && current && !current.deletedAt) await this.release(stored.vaultId, current.path);
        await this.database.attachments.put(stored);
      });
    } catch (error) {
      if (blob) {
        if (previousBlob && current) await this.bytes.write(current.id, previousBlob);
        else await this.bytes.remove(stored);
      }
      throw error;
    }
  }

  async createVault(name: string): Promise<Vault> {
    const time = now();
    const vault = vaultSchema.parse({ id: crypto.randomUUID(), name, createdAt: time, updatedAt: time, deletedAt: null, settings: { sortBy: 'name', sortDirection: 'asc' } });
    await this.database.transaction('rw', this.database.vaults, this.database.state, async () => {
      await this.database.vaults.add(vault);
      await this.database.state.put({ key: 'activeVaultId', value: vault.id });
    });
    return vault;
  }

  async renameVault(id: string, name: string): Promise<Vault> {
    const current = await this.requireVault(id);
    const updated = vaultSchema.parse({ ...current, name, updatedAt: now() });
    await this.database.vaults.put(updated);
    return updated;
  }

  async deleteVault(id: string): Promise<void> {
    const vault = await this.requireVault(id);
    await this.database.vaults.put({ ...vault, deletedAt: now(), updatedAt: now() });
    const active = await this.database.state.get('activeVaultId');
    if (active?.value === id) {
      const replacement = (await this.listVaults())[0];
      if (replacement) await this.setActiveVault(replacement.id);
      else await this.createVault('My vault');
    }
  }

  async purgeVault(id: string): Promise<void> {
    const [folders, notes, attachments, revisions, objects] = await Promise.all([
      this.database.folders.where('vaultId').equals(id).toArray(),
      this.database.noteEntries.where('vaultId').equals(id).toArray(),
      this.database.attachments.where('vaultId').equals(id).toArray(),
      this.database.revisions.where('vaultId').equals(id).toArray(),
      this.database.objects.where('vaultId').equals(id).toArray(),
    ]);
    await this.database.transaction('rw', [this.database.vaults, this.database.folders, this.database.noteEntries, this.database.noteBodies, this.database.attachments, this.database.revisions, this.database.objects, this.database.reservations, this.database.connectedDirectories, this.database.syncTombstones], async () => {
      for (const folder of folders) await this.database.folders.delete(folder.id);
      for (const note of notes) { await this.database.noteEntries.delete(note.id); await this.database.noteBodies.delete(note.id); }
      for (const attachment of attachments) await this.database.attachments.delete(attachment.id);
      for (const revision of revisions) await this.database.revisions.delete(revision.id);
      for (const object of objects) await this.database.objects.delete(object.id);
      for (const item of [...folders, ...notes, ...attachments]) await this.release(id, item.path);
      await this.database.vaults.delete(id);
      await this.database.connectedDirectories.delete(id);
      await this.database.syncTombstones.where('vaultId').equals(id).delete();
    });
    for (const attachment of attachments) await this.bytes.remove(attachment);
  }

  async restoreVault(id: string): Promise<Vault> {
    const vault = await this.database.vaults.get(id);
    if (!vault) throw new Error('Vault not found');
    const restored = vaultSchema.parse({ ...vault, deletedAt: null, updatedAt: now() });
    await this.database.vaults.put(restored);
    return restored;
  }

  async setActiveVault(id: string): Promise<void> {
    await this.requireVault(id);
    await this.database.state.put({ key: 'activeVaultId', value: id });
  }
  async connectDirectory(vaultId: string, handle: FileSystemDirectoryHandle): Promise<void> {
    await this.requireVault(vaultId);
    if (handle?.kind !== 'directory' || typeof handle.getFileHandle !== 'function') throw new Error('A directory handle is required');
    await this.database.connectedDirectories.put({ vaultId, handle });
  }
  async getConnectedDirectory(vaultId: string): Promise<FileSystemDirectoryHandle | undefined> {
    return (await this.database.connectedDirectories.get(vaultId))?.handle;
  }
  async disconnectDirectory(vaultId: string): Promise<void> { await this.database.connectedDirectories.delete(vaultId); }
  async getActiveVault(): Promise<Vault> { return this.initialize(); }

  async updateVaultSettings(id: string, settings: Partial<Vault['settings']>): Promise<Vault> {
    const vault = await this.requireVault(id);
    if (vault.settings.syncEncryptionMode === 'e2ee' && settings.syncEncryptionMode === 'none') throw new Error('Encrypted sync cannot be downgraded to plaintext');
    const updated = vaultSchema.parse({ ...vault, settings: { ...vault.settings, ...settings }, updatedAt: now() });
    await this.database.vaults.put(updated);
    return updated;
  }

  async getStatistics(vaultId: string): Promise<VaultStatistics> {
    await this.requireVault(vaultId);
    const [folders, notes, attachments] = await Promise.all([
      this.database.folders.where('vaultId').equals(vaultId).toArray(),
      this.database.noteEntries.where('vaultId').equals(vaultId).toArray(),
      this.database.attachments.where('vaultId').equals(vaultId).toArray(),
    ]);
    return {
      folders: folders.filter((item) => !item.deletedAt).length,
      notes: notes.filter((item) => !item.deletedAt).length,
      attachments: attachments.filter((item) => !item.deletedAt).length,
      attachmentBytes: attachments.filter((item) => !item.deletedAt).reduce((sum, item) => sum + item.size, 0),
      trashed: [...folders, ...notes, ...attachments].filter((item) => item.deletedAt).length,
    };
  }

  async listTree(vaultId: string): Promise<VaultTree> {
    const vault = await this.requireVault(vaultId);
    const [folders, notes, attachments] = await Promise.all([
      this.database.folders.where('vaultId').equals(vaultId).toArray(),
      this.database.noteEntries.where('vaultId').equals(vaultId).toArray(),
      this.database.attachments.where('vaultId').equals(vaultId).toArray(),
    ]);
    return { vault, folders: folders.filter((item) => !item.deletedAt), notes: notes.filter((item) => !item.deletedAt), attachments: attachments.filter((item) => !item.deletedAt) };
  }

  async searchNoteIds(vaultId: string, query: string): Promise<string[]> {
    const needle = query.trim().toLocaleLowerCase();
    const entries = (await this.database.noteEntries.where('vaultId').equals(vaultId).toArray()).filter((item) => !item.deletedAt);
    if (!needle) return entries.map((item) => item.id);
    const matches = new Set(entries.filter((item) => item.title.toLocaleLowerCase().includes(needle) || item.path.toLocaleLowerCase().includes(needle)).map((item) => item.id));
    const candidates = new Set(entries.map((item) => item.id));
    await this.database.noteBodies.each((body) => { if (candidates.has(body.id) && body.markdown.toLocaleLowerCase().includes(needle)) matches.add(body.id); });
    return [...matches];
  }

  async listTrash(vaultId: string) {
    const [folders, notes, attachments] = await Promise.all([
      this.database.folders.where('vaultId').equals(vaultId).toArray(),
      this.database.noteEntries.where('vaultId').equals(vaultId).toArray(),
      this.database.attachments.where('vaultId').equals(vaultId).toArray(),
    ]);
    return { folders: folders.filter((item) => item.deletedAt), notes: notes.filter((item) => item.deletedAt), attachments: attachments.filter((item) => item.deletedAt) };
  }
  async listSyncTombstones(vaultId: string): Promise<SyncTombstone[]> {
    return (await this.database.syncTombstones.where('vaultId').equals(vaultId).toArray()).map((entry) => entry.value);
  }
  private async retainSyncTombstone(value: { kind: 'folder'; item: Folder } | { kind: 'note'; item: VaultNote } | { kind: 'attachment'; item: Attachment }): Promise<void> {
    const item = value.kind === 'note'
      ? vaultNoteSchema.parse({ ...value.item, folderId: null, path: `/Deleted-${value.item.id}.md`, title: '', markdown: '', aliases: [], properties: {}, checksum: emptyMarkdownChecksum, trashGroupId: null })
      : value.kind === 'folder'
        ? folderSchema.parse({ ...value.item, parentId: null, path: `/Deleted-${value.item.id}`, name: `Deleted-${value.item.id}`, trashGroupId: null })
        : attachmentSchema.parse({ ...value.item, folderId: null, path: `/Deleted-${value.item.id}`, name: `Deleted-${value.item.id}`, mime: 'application/octet-stream', size: 0, recording: undefined, trashGroupId: null });
    const sanitized = { kind: value.kind, item, purged: true } as SyncTombstone;
    await this.database.syncTombstones.put({ key: `${value.kind}:${value.item.id}`, vaultId: value.item.vaultId, value: sanitized });
  }

  private async requireVault(id: string): Promise<Vault> {
    const vault = await this.database.vaults.get(id);
    if (!vault || vault.deletedAt) throw new Error('Vault not found');
    return vault;
  }

  private async folderPath(vaultId: string, parentId: string | null): Promise<string> {
    if (!parentId) return '/';
    const parent = await this.database.folders.get(parentId);
    if (!parent || parent.vaultId !== vaultId || parent.deletedAt) throw new Error('Folder not found');
    return parent.path;
  }

  private async reserve(vaultId: string, path: string, id: string, kind: PathReservation['kind']): Promise<void> {
    const key = reservationKey(vaultId, path);
    const existing = await this.database.reservations.get(key);
    if (existing && existing.id !== id) throw new Error(`Path already exists: ${path}`);
    await this.database.reservations.put({ key, id, kind });
  }

  private async release(vaultId: string, path: string): Promise<void> {
    await this.database.reservations.delete(reservationKey(vaultId, path));
  }

  async createFolder(vaultId: string, parentId: string | null, name: string): Promise<Folder> {
    await this.requireVault(vaultId);
    return this.database.transaction('rw', this.database.folders, this.database.reservations, async () => {
      const path = joinVaultPath(await this.folderPath(vaultId, parentId), name);
      const time = now();
      const folder = folderSchema.parse({ id: crypto.randomUUID(), vaultId, parentId, name, path, createdAt: time, updatedAt: time, deletedAt: null, trashGroupId: null });
      await this.reserve(vaultId, path, folder.id, 'folder');
      await this.database.folders.add(folder);
      return folder;
    });
  }

  async renameFolder(id: string, name: string): Promise<Folder> { return this.relocateFolder(id, undefined, name); }
  async moveFolder(id: string, parentId: string | null): Promise<Folder> { return this.relocateFolder(id, parentId); }

  private async relocateFolder(id: string, destinationId?: string | null, newName?: string): Promise<Folder> {
    return this.database.transaction('rw', [this.database.folders, this.database.noteEntries, this.database.noteBodies, this.database.revisions, this.database.attachments, this.database.reservations], async () => {
      const folder = await this.database.folders.get(id);
      if (!folder || folder.deletedAt) throw new Error('Folder not found');
      const parentId = destinationId === undefined ? folder.parentId : destinationId;
      const parentPath = await this.folderPath(folder.vaultId, parentId);
      if (parentId === id || (parentId && isWithin(parentPath, folder.path))) throw new Error('Cannot move a folder into itself');
      const name = newName ?? folder.name;
      const nextPath = joinVaultPath(parentPath, name);
      if (nextPath === folder.path && parentId === folder.parentId && name === folder.name) return folder;
      const [allFolders, allNotes, allAttachments] = await Promise.all([
        this.database.folders.where('vaultId').equals(folder.vaultId).toArray(),
        this.database.noteEntries.where('vaultId').equals(folder.vaultId).toArray(),
        this.database.attachments.where('vaultId').equals(folder.vaultId).toArray(),
      ]);
      const movedFolders = allFolders.filter((item) => isWithin(item.path, folder.path));
      const movedNotes = allNotes.filter((item) => isWithin(item.path, folder.path));
      const movedAttachments = allAttachments.filter((item) => isWithin(item.path, folder.path));
      const moved = [...movedFolders, ...movedNotes, ...movedAttachments];
      const movedIds = new Set(moved.map((item) => item.id));
      const updates = moved.map((item) => ({ item, path: rebase(item.path, folder.path, nextPath) }));
      for (const update of updates) {
        if (update.item.deletedAt) continue;
        const existing = await this.database.reservations.get(reservationKey(folder.vaultId, update.path));
        if (existing && !movedIds.has(existing.id)) throw new Error(`Path already exists: ${update.path}`);
      }
      for (const item of moved) if (!item.deletedAt) await this.release(folder.vaultId, item.path);
      const time = now();
      for (const update of updates) {
        const { item, path } = update;
        const kind = movedFolders.some((candidate) => candidate.id === item.id) ? 'folder' : movedNotes.some((candidate) => candidate.id === item.id) ? 'note' : 'attachment';
        if (!item.deletedAt) await this.reserve(folder.vaultId, path, item.id, kind);
        if (kind === 'folder') {
          const source = item as Folder;
          await this.database.folders.put({ ...source, path, name: source.id === id ? name : source.name, parentId: source.id === id ? parentId : source.parentId, updatedAt: time });
        } else if (kind === 'note') {
          const source = item as NoteEntry;
          const revision = source.revision + 1;
          await this.database.noteEntries.put({ ...source, path, updatedAt: time, revision });
          const body = await this.database.noteBodies.get(source.id);
          if (!body) throw new Error('Note body is missing');
          const movedNote = await this.getNote(source.id);
          if (!movedNote) throw new Error('Moved note is missing');
          await this.database.revisions.add(makeCheckpoint(movedNote, 'move'));
        } else {
          await this.database.attachments.put({ ...(item as Attachment), path, updatedAt: time });
        }
      }
      const result = await this.database.folders.get(id);
      if (!result) throw new Error('Folder move failed');
      return result;
    });
  }

  async deleteFolder(id: string): Promise<void> {
    await this.database.transaction('rw', this.database.folders, this.database.noteEntries, this.database.attachments, this.database.reservations, async () => {
      const folder = await this.database.folders.get(id);
      if (!folder || folder.deletedAt) throw new Error('Folder not found');
      const [folders, notes, attachments] = await Promise.all([
        this.database.folders.where('vaultId').equals(folder.vaultId).toArray(),
        this.database.noteEntries.where('vaultId').equals(folder.vaultId).toArray(),
        this.database.attachments.where('vaultId').equals(folder.vaultId).toArray(),
      ]);
      const time = now();
      for (const item of folders.filter((item) => !item.deletedAt && isWithin(item.path, folder.path))) {
        await this.release(folder.vaultId, item.path);
        await this.database.folders.put({ ...item, deletedAt: time, trashGroupId: id });
      }
      for (const item of notes.filter((item) => !item.deletedAt && isWithin(item.path, folder.path))) {
        await this.release(folder.vaultId, item.path);
        await this.database.noteEntries.put({ ...item, deletedAt: time, trashGroupId: id });
      }
      for (const item of attachments.filter((item) => !item.deletedAt && isWithin(item.path, folder.path))) {
        await this.release(folder.vaultId, item.path);
        await this.database.attachments.put({ ...item, deletedAt: time, trashGroupId: id });
      }
    });
  }

  async restoreFolder(id: string): Promise<void> {
    await this.database.transaction('rw', this.database.folders, this.database.noteEntries, this.database.attachments, this.database.reservations, async () => {
      const root = await this.database.folders.get(id);
      if (!root || !root.deletedAt) throw new Error('Folder is not in trash');
      await this.folderPath(root.vaultId, root.parentId);
      const [folders, notes, attachments] = await Promise.all([
        this.database.folders.where('vaultId').equals(root.vaultId).toArray(),
        this.database.noteEntries.where('vaultId').equals(root.vaultId).toArray(),
        this.database.attachments.where('vaultId').equals(root.vaultId).toArray(),
      ]);
      const groupedFolders = folders.filter((item) => item.trashGroupId === id && item.deletedAt);
      const groupedNotes = notes.filter((item) => item.trashGroupId === id && item.deletedAt);
      const groupedAttachments = attachments.filter((item) => item.trashGroupId === id && item.deletedAt);
      for (const item of [...groupedFolders, ...groupedNotes, ...groupedAttachments]) {
        if (await this.database.reservations.get(reservationKey(root.vaultId, item.path))) throw new Error(`Path already exists: ${item.path}`);
      }
      for (const item of groupedFolders) { await this.reserve(root.vaultId, item.path, item.id, 'folder'); await this.database.folders.put({ ...item, deletedAt: null, trashGroupId: null }); }
      for (const item of groupedNotes) { await this.reserve(root.vaultId, item.path, item.id, 'note'); await this.database.noteEntries.put({ ...item, deletedAt: null, trashGroupId: null }); }
      for (const item of groupedAttachments) { await this.reserve(root.vaultId, item.path, item.id, 'attachment'); await this.database.attachments.put({ ...item, deletedAt: null, trashGroupId: null }); }
    });
  }

  async permanentlyDeleteFolder(id: string): Promise<void> {
    const root = await this.database.folders.get(id);
    if (!root || !root.deletedAt) throw new Error('Move folder to trash before permanently deleting it');
    const [folders, notes, attachments] = await Promise.all([
      this.database.folders.where('vaultId').equals(root.vaultId).toArray(),
      this.database.noteEntries.where('vaultId').equals(root.vaultId).toArray(),
      this.database.attachments.where('vaultId').equals(root.vaultId).toArray(),
    ]);
    const removedFolders = folders.filter((item) => item.deletedAt && isWithin(item.path, root.path));
    const removedNotes = notes.filter((item) => item.deletedAt && isWithin(item.path, root.path));
    const removedAttachments = attachments.filter((item) => item.deletedAt && isWithin(item.path, root.path));
    await this.database.transaction('rw', [this.database.folders, this.database.noteEntries, this.database.noteBodies, this.database.revisions, this.database.attachments, this.database.objects, this.database.syncTombstones], async () => {
      for (const item of removedFolders) { await this.retainSyncTombstone({ kind: 'folder', item }); await this.database.folders.delete(item.id); }
      for (const item of removedNotes) {
        const note = await this.getNote(item.id);
        if (note) await this.retainSyncTombstone({ kind: 'note', item: note });
        await this.database.noteEntries.delete(item.id); await this.database.noteBodies.delete(item.id); await this.database.revisions.where('noteId').equals(item.id).delete();
      }
      for (const item of removedAttachments) { await this.retainSyncTombstone({ kind: 'attachment', item }); await this.database.attachments.delete(item.id); }
      await this.removeAttachmentSidecars(root.vaultId, new Set(removedAttachments.map((item) => item.id)));
    });
    for (const item of removedAttachments) await this.bytes.remove(item);
  }

  async createNote(vaultId: string, folderId: string | null = null, title = '', markdown: string | ((path: string) => string) = ''): Promise<VaultNote> {
    await this.requireVault(vaultId);
    const folderPath = await this.folderPath(vaultId, folderId);
    const note = await makeVaultNote({ vaultId, folderId, folderPath, title, markdown: typeof markdown === 'string' ? markdown : '' });
    const stem = safeFileStem(note.title);
    let path = note.path;
    let suffix = 2;
    while (true) {
      while (await this.database.reservations.get(reservationKey(vaultId, path))) path = joinVaultPath(folderPath, `${stem} (${suffix++}).md`);
      const content = typeof markdown === 'string' ? markdown : markdown(path);
      const created = typeof markdown === 'string' ? { ...note, path } : await makeVaultNote({ vaultId, folderId, folderPath, path, title, markdown: content, id: note.id, now: new Date(note.createdAt) });
      try {
        return await this.database.transaction('rw', this.database.noteEntries, this.database.noteBodies, this.database.reservations, this.database.revisions, async () => {
          await this.reserve(vaultId, path, note.id, 'note');
          await this.database.noteEntries.add(toNoteEntry(created));
          await this.database.noteBodies.add({ id: created.id, markdown: created.markdown });
          await this.database.revisions.add(makeCheckpoint(created, 'manual'));
          return created;
        });
      } catch (caught) {
        if (caught instanceof Error && caught.message.startsWith('Path already exists:') && await this.database.reservations.get(reservationKey(vaultId, path))) {
          path = joinVaultPath(folderPath, `${stem} (${suffix++}).md`);
          continue;
        }
        throw caught;
      }
    }
  }

  async importNote(vaultId: string, folderId: string | null, input: Pick<VaultNote, 'path' | 'title' | 'markdown' | 'createdAt' | 'updatedAt' | 'aliases' | 'properties'>): Promise<VaultNote> {
    await this.requireVault(vaultId);
    const folderPath = await this.folderPath(vaultId, folderId);
    if (!input.path.startsWith(`${folderPath === '/' ? '' : folderPath}/`) || input.path.slice(folderPath.length + (folderPath === '/' ? 0 : 1)).includes('/')) throw new Error('Imported note path does not match its folder');
    const base = await makeVaultNote({ vaultId, folderId, path: input.path, title: input.title, markdown: input.markdown });
    const note = vaultNoteSchema.parse({ ...base, createdAt: input.createdAt, updatedAt: input.updatedAt, aliases: input.aliases, properties: input.properties });
    await this.database.transaction('rw', this.database.noteEntries, this.database.noteBodies, this.database.revisions, this.database.reservations, async () => {
      await this.reserve(vaultId, note.path, note.id, 'note');
      await this.database.noteEntries.add(toNoteEntry(note));
      await this.database.noteBodies.add({ id: note.id, markdown: note.markdown });
      await this.database.revisions.add(makeCheckpoint(note, 'manual'));
    });
    return note;
  }

  async getNote(id: string): Promise<VaultNote | undefined> {
    const [entry, body] = await Promise.all([this.database.noteEntries.get(id), this.database.noteBodies.get(id)]);
    if (!entry || !body) return undefined;
    const metadata = Object.fromEntries(Object.entries(entry).filter(([key]) => !['excerpt', 'tags', 'links', 'tasks', 'taskCount'].includes(key)));
    return vaultNoteSchema.parse({ ...metadata, markdown: body.markdown });
  }

  async getNotes(ids: readonly string[]): Promise<VaultNote[]> {
    if (!ids.length) return [];
    const [entries, bodies] = await Promise.all([
      this.database.noteEntries.bulkGet([...ids]),
      this.database.noteBodies.bulkGet([...ids]),
    ]);
    const notes: VaultNote[] = [];
    for (let index = 0; index < ids.length; index += 1) {
      const entry = entries[index];
      const body = bodies[index];
      if (!entry || !body) continue;
      const metadata = Object.fromEntries(Object.entries(entry).filter(([key]) => !['excerpt', 'tags', 'links', 'tasks', 'taskCount'].includes(key)));
      notes.push(vaultNoteSchema.parse({ ...metadata, markdown: body.markdown }));
    }
    return notes;
  }

  async saveNote(id: string, patch: Partial<Pick<VaultNote, 'title' | 'markdown' | 'aliases' | 'properties' | 'collaborative'>>, forceCheckpoint = false): Promise<VaultNote> {
    const current = await this.getNote(id);
    if (!current || current.deletedAt) throw new Error('Note not found');
    const markdown = patch.markdown ?? current.markdown;
    const hasFrontmatter = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/u.test(markdown);
    const parsed = patch.markdown === undefined || !hasFrontmatter ? null : parsePortableMarkdown(markdown, current.title || 'Untitled note');
    const title = patch.title === undefined ? current.title : patch.title.trim();
    const nextPath = patch.title === undefined || title === current.title ? current.path : joinVaultPath(current.path.slice(0, current.path.lastIndexOf('/')) || '/', `${safeFileStem(title)}.md`);
    const next = vaultNoteSchema.parse({
      ...current, ...patch, title, markdown, path: nextPath,
      aliases: patch.aliases ?? parsed?.aliases ?? (title !== current.title && current.title ? [...new Set([...current.aliases, current.title])] : current.aliases),
      properties: patch.properties ?? parsed?.properties ?? current.properties,
      updatedAt: new Date(Math.max(Date.now(), Date.parse(current.updatedAt) + 1)).toISOString(),
      revision: current.revision + 1, checksum: await checksumMarkdown(markdown),
    });
    if (next.title === current.title && next.markdown === current.markdown && next.path === current.path && next.collaborative === current.collaborative &&
      JSON.stringify(next.aliases) === JSON.stringify(current.aliases) && JSON.stringify(next.properties) === JSON.stringify(current.properties)) return current;
    return this.database.transaction('rw', this.database.noteEntries, this.database.noteBodies, this.database.reservations, this.database.revisions, async () => {
      const latest = await this.database.noteEntries.get(id);
      if (!latest || latest.revision !== current.revision || latest.deletedAt) throw new Error('Note changed in another tab. Reload before saving.');
      if (next.path !== current.path) {
        await this.reserve(next.vaultId, next.path, id, 'note');
        await this.release(next.vaultId, current.path);
      }
      await this.database.noteEntries.put(toNoteEntry(next));
      await this.database.noteBodies.put({ id, markdown });
      const revisions = await this.database.revisions.where('noteId').equals(id).toArray();
      const latestCheckpoint = revisions.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
      const kind = forceCheckpoint || next.path !== current.path ? 'manual' : 'autosave';
      const checkpointId = kind === 'autosave' && latestCheckpoint?.kind === 'autosave' && Date.now() - Date.parse(latestCheckpoint.createdAt) < 300_000 ? latestCheckpoint.id : undefined;
      await this.database.revisions.put(makeCheckpoint(next, kind, checkpointId ? { id: checkpointId } : {}));
      return next;
    });
  }

  async renameNote(id: string, title: string): Promise<VaultNote> { return this.saveNote(id, { title }, true); }

  async renameNoteWithLinks(id: string, title: string, expectedRevision: number, changes: RenameChange[], expectedRevisions: { id: string; revision: number }[]): Promise<VaultNote> {
    const current = await this.getNote(id);
    if (!current || current.deletedAt || current.revision !== expectedRevision) throw new Error('Note changed after the rename preview. Preview again.');
    const name = title.trim();
    const path = name === current.title ? current.path : joinVaultPath(current.path.slice(0, current.path.lastIndexOf('/')) || '/', `${safeFileStem(name)}.md`);
    const changeById = new Map(changes.map((change) => [change.noteId, change]));
    if (changeById.size !== changes.length) throw new Error('Duplicate rename changes');
    const sourceNotes = await Promise.all(changes.map((change) => this.getNote(change.noteId)));
    const time = new Date(Math.max(Date.now(), Date.parse(current.updatedAt) + 1)).toISOString();
    const prepared = new Map<string, VaultNote>();
    for (let index = 0; index < changes.length; index += 1) {
      const change = changes[index]!;
      const source = sourceNotes[index];
      if (!source || source.deletedAt || source.vaultId !== current.vaultId || source.revision !== change.revision || source.markdown !== change.before) throw new Error('A linked note changed after the preview. Preview again.');
      prepared.set(source.id, vaultNoteSchema.parse({ ...source, markdown: change.after, updatedAt: time, revision: source.revision + 1, checksum: await checksumMarkdown(change.after) }));
    }
    const renamed = vaultNoteSchema.parse({
      ...(prepared.get(id) ?? current), title: name, path,
      aliases: current.title && current.title !== name ? [...new Set([...current.aliases, current.title])] : current.aliases,
      updatedAt: time, revision: current.revision + 1,
    });
    prepared.set(id, renamed);
    await this.database.transaction('rw', [this.database.noteEntries, this.database.noteBodies, this.database.reservations, this.database.revisions], async () => {
      const vaultEntries = (await this.database.noteEntries.where('vaultId').equals(current.vaultId).toArray()).filter((entry) => !entry.deletedAt);
      const expectedById = new Map(expectedRevisions.map((entry) => [entry.id, entry.revision]));
      if (expectedById.size !== expectedRevisions.length || vaultEntries.length !== expectedRevisions.length || vaultEntries.some((entry) => expectedById.get(entry.id) !== entry.revision)) throw new Error('The vault changed after the rename preview. Preview again.');
      for (const [noteId, next] of prepared) {
        const latest = await this.database.noteEntries.get(noteId);
        const body = await this.database.noteBodies.get(noteId);
        const expected = noteId === id ? current : sourceNotes.find((source) => source?.id === noteId);
        if (!latest || !body || !expected || latest.revision !== expected.revision || body.markdown !== expected.markdown || latest.deletedAt) throw new Error('A note changed after the rename preview. Preview again.');
        if (next.vaultId !== current.vaultId) throw new Error('Rename crossed vaults');
      }
      if (path !== current.path) { await this.reserve(current.vaultId, path, id, 'note'); await this.release(current.vaultId, current.path); }
      for (const [noteId, next] of prepared) {
        await this.database.noteEntries.put(toNoteEntry(next));
        await this.database.noteBodies.put({ id: noteId, markdown: next.markdown });
        await this.database.revisions.add(makeCheckpoint(next, 'manual'));
      }
    });
    return renamed;
  }

  async applyVaultNoteEdits(vaultId: string, changes: TagChange[], expectedRevisions: { id: string; revision: number }[]): Promise<VaultNote[]> {
    if (new Set(changes.map((change) => change.noteId)).size !== changes.length) throw new Error('Duplicate note edits are not allowed');
    const originals = await Promise.all(changes.map((change) => this.getNote(change.noteId)));
    const prepared: VaultNote[] = [];
    for (let index = 0; index < changes.length; index += 1) {
      const source = originals[index];
      const change = changes[index]!;
      if (!source || source.vaultId !== vaultId || source.deletedAt || source.revision !== change.revision || source.markdown !== change.before) throw new Error('A note changed after the preview. Preview again.');
      const time = new Date(Math.max(Date.now(), Date.parse(source.updatedAt) + 1)).toISOString();
      prepared.push(vaultNoteSchema.parse({ ...source, markdown: change.after, revision: source.revision + 1, checksum: await checksumMarkdown(change.after), updatedAt: time }));
    }
    await this.database.transaction('rw', [this.database.noteEntries, this.database.noteBodies, this.database.revisions], async () => {
      const entries = (await this.database.noteEntries.where('vaultId').equals(vaultId).toArray()).filter((entry) => !entry.deletedAt);
      const expected = new Map(expectedRevisions.map((entry) => [entry.id, entry.revision]));
      if (expected.size !== expectedRevisions.length || entries.length !== expectedRevisions.length || entries.some((entry) => expected.get(entry.id) !== entry.revision)) throw new Error('The vault changed after the preview. Preview again.');
      for (let index = 0; index < prepared.length; index += 1) {
        const next = prepared[index]!;
        const source = originals[index]!;
        const latest = await this.database.noteBodies.get(next.id);
        if (!latest || latest.markdown !== source.markdown) throw new Error('A note changed after the preview. Preview again.');
        await this.database.noteEntries.put(toNoteEntry(next));
        await this.database.noteBodies.put({ id: next.id, markdown: next.markdown });
        await this.database.revisions.add(makeCheckpoint(next, 'manual'));
      }
    });
    return prepared;
  }

  async applyNoteRefactor(vaultId: string, plan: NoteRefactorPlan): Promise<{ created: VaultNote[]; updated: VaultNote[] }> {
    if (plan.vaultId !== vaultId || plan.canvas || !plan.creates.length && !plan.edits.length) throw new Error('Invalid note refactor plan');
    await this.requireVault(vaultId);
    const ids = [...plan.creates.map((item) => item.id), ...plan.edits.map((item) => item.noteId)];
    if (new Set(ids).size !== ids.length) throw new Error('Duplicate note IDs in refactor plan');
    const paths = plan.creates.map((item) => pathKey(item.path));
    if (new Set(paths).size !== paths.length) throw new Error('Duplicate note paths in refactor plan');
    const created: VaultNote[] = [];
    for (const item of plan.creates) {
      const folderPath = await this.folderPath(vaultId, item.folderId);
      if ((item.path.slice(0, item.path.lastIndexOf('/')) || '/') !== folderPath || !item.path.endsWith('.md')) throw new Error('New note path does not match its folder');
      created.push(await makeVaultNote({ vaultId, folderId: item.folderId, path: item.path, id: item.id, title: item.title, markdown: item.markdown }));
    }
    const originals = await Promise.all(plan.edits.map((item) => this.getNote(item.noteId)));
    const updated: VaultNote[] = [];
    for (let index = 0; index < plan.edits.length; index += 1) {
      const edit = plan.edits[index]!, original = originals[index];
      if (!original || original.vaultId !== vaultId || original.deletedAt || original.revision !== edit.revision || original.markdown !== edit.before || original.path !== edit.path || original.title !== edit.title) throw new Error('A note changed after the preview. Preview again.');
      const time = new Date(Math.max(Date.now(), Date.parse(original.updatedAt) + 1)).toISOString();
      updated.push(vaultNoteSchema.parse({ ...original, markdown: edit.after, revision: original.revision + 1, updatedAt: time, checksum: await checksumMarkdown(edit.after) }));
    }
    await this.database.transaction('rw', [this.database.noteEntries, this.database.noteBodies, this.database.revisions, this.database.reservations], async () => {
      const entries = (await this.database.noteEntries.where('vaultId').equals(vaultId).toArray()).filter((entry) => !entry.deletedAt);
      const expected = new Map(plan.expectedRevisions.map((item) => [item.id, item.revision]));
      if (expected.size !== plan.expectedRevisions.length || entries.length !== expected.size || entries.some((entry) => expected.get(entry.id) !== entry.revision)) throw new Error('The vault changed after the preview. Preview again.');
      for (let index = 0; index < originals.length; index += 1) {
        const original = originals[index]!, latest = await this.database.noteEntries.get(original.id), body = await this.database.noteBodies.get(original.id);
        if (!latest || !body || latest.revision !== original.revision || body.markdown !== original.markdown || latest.deletedAt) throw new Error('A note changed after the preview. Preview again.');
      }
      for (const note of created) {
        if (await this.database.noteEntries.get(note.id)) throw new Error('New note ID already exists');
        await this.reserve(vaultId, note.path, note.id, 'note');
        await this.database.noteEntries.add(toNoteEntry(note));
        await this.database.noteBodies.add({ id: note.id, markdown: note.markdown });
        await this.database.revisions.add(makeCheckpoint(note, 'manual'));
      }
      for (const note of updated) {
        await this.database.noteEntries.put(toNoteEntry(note));
        await this.database.noteBodies.put({ id: note.id, markdown: note.markdown });
        await this.database.revisions.add(makeCheckpoint(note, 'manual'));
      }
    });
    return { created, updated };
  }

  async moveNote(id: string, folderId: string | null): Promise<VaultNote> {
    const current = await this.getNote(id);
    if (!current || current.deletedAt) throw new Error('Note not found');
    const parentPath = await this.folderPath(current.vaultId, folderId);
    const filename = current.path.slice(current.path.lastIndexOf('/') + 1);
    const path = joinVaultPath(parentPath, filename);
    if (current.folderId === folderId && current.path === path) return current;
    const moved = vaultNoteSchema.parse({ ...current, folderId, path, updatedAt: now(), revision: current.revision + 1 });
    await this.database.transaction('rw', this.database.noteEntries, this.database.reservations, this.database.revisions, async () => {
      const latest = await this.database.noteEntries.get(id);
      if (!latest || latest.revision !== current.revision) throw new Error('Note changed in another tab. Reload before moving.');
      await this.reserve(current.vaultId, path, id, 'note');
      await this.release(current.vaultId, current.path);
      await this.database.noteEntries.put(toNoteEntry(moved));
      await this.database.revisions.add(makeCheckpoint(moved, 'move'));
    });
    return moved;
  }

  async duplicateNote(id: string): Promise<VaultNote> {
    const source = await this.getNote(id);
    if (!source || source.deletedAt) throw new Error('Note not found');
    const duplicate = await this.createNote(source.vaultId, source.folderId, `${source.title || 'Untitled note'} copy`, source.markdown);
    if (source.aliases.length || Object.keys(source.properties).length) return this.saveNote(duplicate.id, { aliases: source.aliases, properties: source.properties }, true);
    return duplicate;
  }

  async deleteNote(id: string): Promise<void> {
    await this.database.transaction('rw', this.database.noteEntries, this.database.reservations, async () => {
      const note = await this.database.noteEntries.get(id);
      if (!note || note.deletedAt) throw new Error('Note not found');
      await this.release(note.vaultId, note.path);
      await this.database.noteEntries.put({ ...note, deletedAt: now(), trashGroupId: id });
    });
  }

  async restoreNote(id: string): Promise<VaultNote> {
    await this.database.transaction('rw', this.database.noteEntries, this.database.noteBodies, this.database.folders, this.database.reservations, this.database.revisions, async () => {
      const note = await this.database.noteEntries.get(id);
      if (!note || !note.deletedAt) throw new Error('Note is not in trash');
      await this.folderPath(note.vaultId, note.folderId);
      await this.reserve(note.vaultId, note.path, id, 'note');
      const restored = { ...note, deletedAt: null, trashGroupId: null, updatedAt: now(), revision: note.revision + 1 };
      await this.database.noteEntries.put(restored);
      const body = await this.database.noteBodies.get(id);
      if (!body) throw new Error('Note body is missing');
      const restoredNote = await this.getNote(id);
      if (!restoredNote) throw new Error('Restored note is missing');
      await this.database.revisions.add(makeCheckpoint(restoredNote, 'restore'));
    });
    const restored = await this.getNote(id);
    if (!restored) throw new Error('Restored note is missing');
    return restored;
  }

  async permanentlyDeleteNote(id: string): Promise<void> {
    await this.database.transaction('rw', this.database.noteEntries, this.database.noteBodies, this.database.revisions, this.database.syncTombstones, async () => {
      const note = await this.database.noteEntries.get(id);
      if (!note || !note.deletedAt) throw new Error('Move note to trash before permanently deleting it');
      const snapshot = await this.getNote(id);
      if (snapshot) await this.retainSyncTombstone({ kind: 'note', item: snapshot });
      await this.database.noteEntries.delete(id);
      await this.database.noteBodies.delete(id);
      await this.database.revisions.where('noteId').equals(id).delete();
    });
  }

  async listRevisions(noteId: string): Promise<Revision[]> {
    return (await this.database.revisions.where('noteId').equals(noteId).toArray()).map((item) => revisionSchema.parse(item)).sort((a, b) => b.number - a.number);
  }

  async restoreRevision(noteId: string, revisionId: string, expectedRevision: number): Promise<VaultNote> {
    const record = await this.database.revisions.get(revisionId);
    if (!record) throw new Error('Revision not found');
    const source = revisionSchema.parse(record);
    if (source.noteId !== noteId || await checksumMarkdown(source.markdown) !== source.checksum) throw new Error('Revision does not belong to this note or failed its checksum check');
    return this.database.transaction('rw', [this.database.noteEntries, this.database.noteBodies, this.database.folders, this.database.reservations, this.database.revisions], async () => {
      const current = await this.getNote(noteId);
      if (!current || current.deletedAt) throw new Error('Note not found');
      if (current.revision !== expectedRevision) throw new Error('Note changed after opening history. Reopen history and try again.');
      if (source.vaultId !== current.vaultId) throw new Error('Revision belongs to another vault');
      const folderId = source.metadata?.folderId ?? (source.metadata ? null : current.folderId);
      const path = source.metadata ? source.path : current.path;
      if (source.metadata && (path.slice(0, path.lastIndexOf('/')) || '/') !== await this.folderPath(current.vaultId, folderId)) throw new Error('The original folder moved or no longer exists. Duplicate this revision instead.');
      const next = vaultNoteSchema.parse({
        ...current, folderId, path, title: source.title, markdown: source.markdown,
        aliases: source.metadata?.aliases ?? current.aliases,
        properties: source.metadata?.properties ?? current.properties,
        checksum: source.checksum, revision: current.revision + 1,
        updatedAt: new Date(Math.max(Date.now(), Date.parse(current.updatedAt) + 1)).toISOString(),
      });
      if (path !== current.path) {
        await this.reserve(current.vaultId, path, noteId, 'note');
        if (pathKey(path) !== pathKey(current.path)) await this.release(current.vaultId, current.path);
      }
      await this.database.noteEntries.put(toNoteEntry(next));
      await this.database.noteBodies.put({ id: noteId, markdown: next.markdown });
      await this.database.revisions.add(makeCheckpoint(next, 'restore', { restoredFromId: source.id }));
      return next;
    });
  }

  async duplicateRevision(noteId: string, revisionId: string): Promise<VaultNote> {
    const record = await this.database.revisions.get(revisionId);
    if (!record) throw new Error('Revision not found');
    const source = revisionSchema.parse(record);
    const original = await this.getNote(noteId);
    if (!original || original.deletedAt || source.noteId !== noteId || source.vaultId !== original.vaultId) throw new Error('Revision does not belong to an active note');
    if (await checksumMarkdown(source.markdown) !== source.checksum) throw new Error('Revision failed its checksum check');
    const sourceFolder = source.metadata ? source.metadata.folderId : original.folderId;
    let folderId = original.folderId;
    try { await this.folderPath(original.vaultId, sourceFolder); folderId = sourceFolder; } catch { /* The original folder was removed; use the current folder. */ }
    const title = `${source.title || 'Untitled note'} (revision ${source.number})`.slice(0, 200);
    const created = await this.createNote(original.vaultId, folderId, title, source.markdown);
    if (source.metadata?.aliases.length || Object.keys(source.metadata?.properties ?? {}).length) {
      return this.saveNote(created.id, { aliases: source.metadata?.aliases ?? [], properties: source.metadata?.properties ?? {} }, true);
    }
    return created;
  }

  async importRevisionHistory(noteId: string, revisions: Revision[]): Promise<void> {
    if (!revisions.length) return;
    const note = await this.getNote(noteId);
    if (!note || note.deletedAt) throw new Error('Imported history note is missing');
    const parsed = revisions.map((item) => revisionSchema.parse(item));
    if (new Set(parsed.map((item) => item.id)).size !== parsed.length || new Set(parsed.map((item) => item.number)).size !== parsed.length) throw new Error('Imported history has duplicate IDs or numbers');
    for (const item of parsed) {
      if (item.noteId !== noteId || item.vaultId !== note.vaultId || await checksumMarkdown(item.markdown) !== item.checksum) throw new Error('Imported history failed validation');
    }
    await this.database.transaction('rw', [this.database.noteEntries, this.database.revisions], async () => {
      const latest = await this.database.noteEntries.get(noteId);
      if (!latest || latest.revision !== note.revision || latest.deletedAt) throw new Error('Imported note changed during history import');
      const existing = await this.database.revisions.where('noteId').equals(noteId).toArray();
      if (existing.length !== note.revision) throw new Error('History can only be imported into a newly created note');
      await this.database.revisions.where('noteId').equals(noteId).delete();
      await this.database.revisions.bulkAdd(parsed);
      const next = vaultNoteSchema.parse({ ...note, revision: Math.max(note.revision, ...parsed.map((item) => item.number)) + 1 });
      await this.database.noteEntries.put(toNoteEntry(next));
      await this.database.revisions.add(makeCheckpoint(next, 'manual'));
    });
  }

  async addAttachment(vaultId: string, folderId: string | null, file: Blob, name: string, recording?: Attachment['recording']): Promise<Attachment> {
    await this.requireVault(vaultId);
    const validatedRecording = recording === undefined ? undefined : recordingMetadataSchema.parse(recording);
    const path = joinVaultPath(await this.folderPath(vaultId, folderId), name);
    const id = crypto.randomUUID();
    const storage = await this.bytes.write(id, file);
    const time = now();
    const attachment = attachmentSchema.parse({ id, vaultId, folderId, path, name, mime: file.type || 'application/octet-stream', size: file.size, storage, createdAt: time, updatedAt: time, deletedAt: null, trashGroupId: null, ...(validatedRecording ? { recording: validatedRecording } : {}) });
    try {
      await this.database.transaction('rw', this.database.attachments, this.database.reservations, async () => {
        await this.reserve(vaultId, path, id, 'attachment');
        await this.database.attachments.add(attachment);
      });
    } catch (error) { await this.bytes.remove(attachment).catch(() => undefined); throw error; }
    return attachment;
  }

  async getAttachmentBlob(id: string): Promise<Blob | undefined> {
    const attachment = await this.database.attachments.get(id);
    return attachment ? this.bytes.read(attachment) : undefined;
  }

  async renameAttachment(id: string, name: string): Promise<Attachment> {
    return this.relocateAttachment(id, undefined, name);
  }
  async renameAttachmentWithLinks(id: string, name: string, expectedPath: string, expectedUpdatedAt: string, changes: AttachmentLinkChange[], expectedRevisions: { id: string; revision: number }[]): Promise<Attachment> {
    const current = await this.database.attachments.get(id);
    if (!current || current.deletedAt || current.path !== expectedPath || current.updatedAt !== expectedUpdatedAt) throw new Error('The recording changed after the preview. Preview again.');
    const path = joinVaultPath(await this.folderPath(current.vaultId, current.folderId), name);
    if (new Set(changes.map((item) => item.noteId)).size !== changes.length) throw new Error('Duplicate note edits in rename preview');
    const originals = await Promise.all(changes.map((item) => this.getNote(item.noteId)));
    const updated: VaultNote[] = [];
    for (let index = 0; index < changes.length; index += 1) {
      const change = changes[index]!, note = originals[index];
      if (!note || note.deletedAt || note.vaultId !== current.vaultId || note.revision !== change.revision || note.path !== change.path || note.markdown !== change.before) throw new Error('A note changed after the preview. Preview again.');
      const time = new Date(Math.max(Date.now(), Date.parse(note.updatedAt) + 1)).toISOString();
      updated.push(vaultNoteSchema.parse({ ...note, markdown: change.after, revision: note.revision + 1, updatedAt: time, checksum: await checksumMarkdown(change.after) }));
    }
    const renamed = attachmentSchema.parse({ ...current, name, path, updatedAt: new Date(Math.max(Date.now(), Date.parse(current.updatedAt) + 1)).toISOString() });
    await this.database.transaction('rw', [this.database.attachments, this.database.noteEntries, this.database.noteBodies, this.database.revisions, this.database.reservations], async () => {
      const latest = await this.database.attachments.get(id);
      if (!latest || latest.path !== current.path || latest.updatedAt !== current.updatedAt || latest.deletedAt) throw new Error('The recording changed after the preview. Preview again.');
      const entries = (await this.database.noteEntries.where('vaultId').equals(current.vaultId).toArray()).filter((item) => !item.deletedAt);
      const expected = new Map(expectedRevisions.map((item) => [item.id, item.revision]));
      if (expected.size !== expectedRevisions.length || entries.length !== expected.size || entries.some((item) => expected.get(item.id) !== item.revision)) throw new Error('The vault changed after the preview. Preview again.');
      for (let index = 0; index < updated.length; index += 1) {
        const note = originals[index]!, latestEntry = await this.database.noteEntries.get(note.id), body = await this.database.noteBodies.get(note.id);
        if (!latestEntry || !body || latestEntry.revision !== note.revision || body.markdown !== note.markdown) throw new Error('A note changed after the preview. Preview again.');
      }
      if (pathKey(path) !== pathKey(current.path)) { await this.reserve(current.vaultId, path, id, 'attachment'); await this.release(current.vaultId, current.path); }
      await this.database.attachments.put(renamed);
      for (const note of updated) {
        await this.database.noteEntries.put(toNoteEntry(note));
        await this.database.noteBodies.put({ id: note.id, markdown: note.markdown });
        await this.database.revisions.add(makeCheckpoint(note, 'manual'));
      }
    });
    return renamed;
  }
  async moveAttachment(id: string, folderId: string | null): Promise<Attachment> {
    return this.relocateAttachment(id, folderId);
  }

  private async relocateAttachment(id: string, targetFolderId?: string | null, targetName?: string): Promise<Attachment> {
    return this.database.transaction('rw', this.database.attachments, this.database.folders, this.database.reservations, async () => {
      const attachment = await this.database.attachments.get(id);
      if (!attachment || attachment.deletedAt) throw new Error('Attachment not found');
      const folderId = targetFolderId === undefined ? attachment.folderId : targetFolderId;
      const name = targetName ?? attachment.name;
      const path = joinVaultPath(await this.folderPath(attachment.vaultId, folderId), name);
      if (path === attachment.path) return attachment;
      if (pathKey(path) !== pathKey(attachment.path)) { await this.reserve(attachment.vaultId, path, id, 'attachment'); await this.release(attachment.vaultId, attachment.path); }
      const updated = attachmentSchema.parse({ ...attachment, folderId, name, path, updatedAt: now() });
      await this.database.attachments.put(updated);
      return updated;
    });
  }

  async deleteAttachment(id: string): Promise<void> {
    await this.database.transaction('rw', this.database.attachments, this.database.reservations, async () => {
      const attachment = await this.database.attachments.get(id);
      if (!attachment || attachment.deletedAt) throw new Error('Attachment not found');
      await this.release(attachment.vaultId, attachment.path);
      await this.database.attachments.put({ ...attachment, deletedAt: now(), trashGroupId: id });
    });
  }

  async restoreAttachment(id: string): Promise<Attachment> {
    return this.database.transaction('rw', this.database.attachments, this.database.folders, this.database.reservations, async () => {
      const attachment = await this.database.attachments.get(id);
      if (!attachment || !attachment.deletedAt) throw new Error('Attachment is not in trash');
      await this.folderPath(attachment.vaultId, attachment.folderId);
      await this.reserve(attachment.vaultId, attachment.path, id, 'attachment');
      const restored = attachmentSchema.parse({ ...attachment, deletedAt: null, trashGroupId: null, updatedAt: now() });
      await this.database.attachments.put(restored);
      return restored;
    });
  }

  async permanentlyDeleteAttachment(id: string): Promise<void> {
    const attachment = await this.database.attachments.get(id);
    if (!attachment || !attachment.deletedAt) throw new Error('Move attachment to trash before permanently deleting it');
    await this.database.transaction('rw', [this.database.attachments, this.database.objects, this.database.syncTombstones], async () => {
      await this.retainSyncTombstone({ kind: 'attachment', item: attachment });
      await this.database.attachments.delete(id);
      await this.removeAttachmentSidecars(attachment.vaultId, new Set([id]));
    });
    await this.bytes.remove(attachment);
  }

  async emptyTrash(vaultId: string): Promise<void> {
    const trash = await this.listTrash(vaultId);
    await this.database.transaction('rw', [this.database.folders, this.database.noteEntries, this.database.noteBodies, this.database.revisions, this.database.attachments, this.database.objects, this.database.syncTombstones], async () => {
      for (const folder of trash.folders) { await this.retainSyncTombstone({ kind: 'folder', item: folder }); await this.database.folders.delete(folder.id); }
      for (const note of trash.notes) {
        const snapshot = await this.getNote(note.id);
        if (snapshot) await this.retainSyncTombstone({ kind: 'note', item: snapshot });
        await this.database.noteEntries.delete(note.id);
        await this.database.noteBodies.delete(note.id);
        await this.database.revisions.where('noteId').equals(note.id).delete();
      }
      for (const attachment of trash.attachments) { await this.retainSyncTombstone({ kind: 'attachment', item: attachment }); await this.database.attachments.delete(attachment.id); }
      await this.removeAttachmentSidecars(vaultId, new Set(trash.attachments.map((item) => item.id)));
    });
    for (const attachment of trash.attachments) await this.bytes.remove(attachment);
  }

  async putObject(kind: VaultObjectKind, value: unknown): Promise<VaultObject> {
    const parsed = vaultObjectSchemas[kind].parse(value) as VaultObject;
    const vaultId = 'vaultId' in parsed ? parsed.vaultId : null;
    if (vaultId) await this.requireVault(vaultId);
    await this.database.objects.put({ id: parsed.id, vaultId, kind, value: parsed });
    return parsed;
  }

  async listObjects(kind: VaultObjectKind, vaultId?: string): Promise<VaultObject[]> {
    const rows = vaultId ? await this.database.objects.where('[vaultId+kind]').equals([vaultId, kind]).toArray() : await this.database.objects.where('kind').equals(kind).toArray();
    return rows.map((row) => vaultObjectSchemas[kind].parse(row.value) as VaultObject);
  }

  async deleteObject(id: string): Promise<void> { await this.database.objects.delete(id); }
  close(): void { this.database.close(); }
}
