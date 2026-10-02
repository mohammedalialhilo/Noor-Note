import type { Attachment, Folder, Revision, VaultNote } from '@noor-note/core';
import type { NoteEntry, VaultRepository } from '@noor-note/storage';
import { listRecoveryDrafts, type RecoveryDraft } from './recovery-drafts';

export type RecoveryItem =
  | { kind: 'deleted-note'; note: NoteEntry }
  | { kind: 'deleted-attachment'; attachment: Attachment }
  | { kind: 'revision'; revision: Revision; sourceAvailable: boolean; isCurrent: boolean }
  | { kind: 'draft'; draft: RecoveryDraft; savedRevision: number | null }
  | { kind: 'conflict-note'; note: NoteEntry }
  | { kind: 'conflict-attachment'; attachment: Attachment };

export interface RecoveryInventory { deleted: RecoveryItem[]; revisions: RecoveryItem[]; drafts: RecoveryItem[]; conflicts: RecoveryItem[]; deletedFolders: number }
export function recoveryItemVaultId(item: RecoveryItem): string {
  switch (item.kind) {
    case 'deleted-note': case 'conflict-note': return item.note.vaultId;
    case 'deleted-attachment': case 'conflict-attachment': return item.attachment.vaultId;
    case 'revision': return item.revision.vaultId;
    case 'draft': return item.draft.vaultId;
  }
}
const noteConflict = / \(conflict \d{4}-\d{2}-\d{2}\)$/u;
const attachmentConflict = / \(conflict [0-9a-f]{8}\)$/u;
const deletionTime = (item: RecoveryItem): string => item.kind === 'deleted-note' ? item.note.deletedAt ?? '' : item.kind === 'deleted-attachment' ? item.attachment.deletedAt ?? '' : '';

export async function loadRecoveryInventory(repository: VaultRepository, vaultId: string): Promise<RecoveryInventory> {
  const [trash, revisions, tree] = await Promise.all([repository.listTrash(vaultId), repository.listRecentRevisions(vaultId, 50), repository.listTree(vaultId)]);
  const drafts = listRecoveryDrafts(vaultId);
  const saved = repository.getNotes ? await repository.getNotes(drafts.map((draft) => draft.noteId)) : await Promise.all(drafts.map((draft) => repository.getNote(draft.noteId))).then((notes) => notes.filter((note): note is VaultNote => Boolean(note)));
  const byId = new Map(saved.filter((note) => note.vaultId === vaultId).map((note) => [note.id, note]));
  const activeNotes = new Map(tree.notes.map((note) => [note.id, note]));
  return {
    deleted: [...trash.notes.map((note) => ({ kind: 'deleted-note' as const, note })), ...trash.attachments.map((attachment) => ({ kind: 'deleted-attachment' as const, attachment }))]
      .sort((a, b) => deletionTime(b).localeCompare(deletionTime(a))),
    revisions: revisions.map((revision) => ({ kind: 'revision' as const, revision, sourceAvailable: activeNotes.has(revision.noteId), isCurrent: activeNotes.get(revision.noteId)?.revision === revision.number })),
    drafts: drafts.filter((draft) => { const note = byId.get(draft.noteId); return !note || note.markdown !== draft.markdown || note.title !== draft.title; })
      .map((draft) => ({ kind: 'draft' as const, draft, savedRevision: byId.get(draft.noteId)?.deletedAt ? null : byId.get(draft.noteId)?.revision ?? null })),
    conflicts: [...tree.notes.filter((note) => noteConflict.test(note.title)).map((note) => ({ kind: 'conflict-note' as const, note })),
      ...tree.attachments.filter((attachment) => attachmentConflict.test(attachment.name)).map((attachment) => ({ kind: 'conflict-attachment' as const, attachment }))]
      .sort((a, b) => (b.kind === 'conflict-note' ? b.note.updatedAt : b.attachment.updatedAt).localeCompare(a.kind === 'conflict-note' ? a.note.updatedAt : a.attachment.updatedAt)),
    deletedFolders: trash.folders.length,
  };
}

function existingFolder(folders: Folder[], folderId: string | null): string | null {
  return folderId && folders.some((item) => item.id === folderId) ? folderId : null;
}

async function copyNote(repository: VaultRepository, vaultId: string, source: Pick<VaultNote, 'title' | 'markdown' | 'aliases' | 'properties' | 'folderId'>, title: string): Promise<VaultNote> {
  const tree = await repository.listTree(vaultId);
  const created = await repository.createNote(vaultId, existingFolder(tree.folders, source.folderId), title.slice(0, 200), source.markdown);
  return source.aliases.length || Object.keys(source.properties).length
    ? repository.saveNote(created.id, { aliases: source.aliases, properties: source.properties }, true) : created;
}

export async function restoreAsRecoveryCopy(repository: VaultRepository, vaultId: string, item: RecoveryItem): Promise<VaultNote | Attachment> {
  if (recoveryItemVaultId(item) !== vaultId) throw new Error('Recovery item belongs to another vault');
  if (item.kind === 'draft') {
    const candidate = await repository.getNote(item.draft.noteId);
    const source = candidate?.vaultId === vaultId ? candidate : null;
    return copyNote(repository, vaultId, { ...item.draft, aliases: source?.aliases ?? [], properties: source?.properties ?? {}, folderId: source?.folderId ?? null }, `${item.draft.title || 'Untitled'} (recovered)`);
  }
  if (item.kind === 'revision') {
    const source = await repository.getNote(item.revision.noteId);
    if (source && !source.deletedAt) return repository.duplicateRevision(source.id, item.revision.id);
    return copyNote(repository, vaultId, { title: item.revision.title, markdown: item.revision.markdown, aliases: item.revision.metadata?.aliases ?? [], properties: item.revision.metadata?.properties ?? {}, folderId: item.revision.metadata?.folderId ?? null }, `${item.revision.title || 'Untitled'} (revision ${item.revision.number})`);
  }
  if (item.kind === 'deleted-note' || item.kind === 'conflict-note') {
    const source = await repository.getNote(item.note.id);
    if (!source || source.vaultId !== vaultId) throw new Error('Recovery note is unavailable');
    return copyNote(repository, vaultId, source, `${source.title || 'Untitled'} (recovered)`);
  }
  const source = item.attachment;
  const bytes = await repository.getAttachmentBlob(source.id);
  if (!bytes || source.vaultId !== vaultId) throw new Error('Recovery attachment is unavailable');
  const tree = await repository.listTree(vaultId);
  const dot = source.name.lastIndexOf('.');
  const extension = dot > 0 && source.name.length - dot <= 21 ? source.name.slice(dot) : '';
  const stem = extension ? source.name.slice(0, dot) : source.name;
  const suffix = ' (recovered)';
  const name = `${stem.slice(0, 200 - suffix.length - extension.length)}${suffix}${extension}`;
  return repository.addAttachment(vaultId, existingFolder(tree.folders, source.folderId), bytes, name, source.recording);
}
