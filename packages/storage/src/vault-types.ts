import type { Attachment, AttachmentLinkChange, Folder, NoteRefactorPlan, RenameChange, Revision, TagChange, TaskRecord, Vault, VaultNote, VaultObject, VaultObjectKind } from '@noor-note/core';

export interface NoteEntry extends Omit<VaultNote, 'markdown'> {
  excerpt: string;
  tags: string[];
  links: string[];
  tasks: TaskRecord[];
  taskCount: number;
}

export interface VaultTree {
  vault: Vault;
  folders: Folder[];
  notes: NoteEntry[];
  attachments: Attachment[];
}

export interface VaultStatistics {
  folders: number;
  notes: number;
  attachments: number;
  attachmentBytes: number;
  trashed: number;
}

export interface StoredVaultObject {
  id: string;
  vaultId: string | null;
  kind: VaultObjectKind;
  value: VaultObject;
}

export type VaultItemKind = 'folder' | 'note' | 'attachment';
export type SyncTombstone =
  | { kind: 'folder'; item: Folder; purged: true }
  | { kind: 'note'; item: VaultNote; purged: true }
  | { kind: 'attachment'; item: Attachment; purged: true };

export interface VaultRepository {
  initialize(): Promise<Vault>;
  listVaults(): Promise<Vault[]>;
  listDeletedVaults(): Promise<Vault[]>;
  getVault(id: string): Promise<Vault | undefined>;
  importSyncedVault(vault: Vault): Promise<Vault>;
  applySyncedFolder(folder: Folder): Promise<void>;
  applySyncedNote(note: VaultNote): Promise<void>;
  applySyncedAttachment(attachment: Attachment, blob: Blob | null): Promise<void>;
  createVault(name: string): Promise<Vault>;
  renameVault(id: string, name: string): Promise<Vault>;
  deleteVault(id: string): Promise<void>;
  purgeVault(id: string): Promise<void>;
  restoreVault(id: string): Promise<Vault>;
  setActiveVault(id: string): Promise<void>;
  connectDirectory(vaultId: string, handle: FileSystemDirectoryHandle): Promise<void>;
  getConnectedDirectory(vaultId: string): Promise<FileSystemDirectoryHandle | undefined>;
  disconnectDirectory(vaultId: string): Promise<void>;
  getActiveVault(): Promise<Vault>;
  updateVaultSettings(id: string, settings: Partial<Vault['settings']>): Promise<Vault>;
  getStatistics(vaultId: string): Promise<VaultStatistics>;
  listTree(vaultId: string): Promise<VaultTree>;
  searchNoteIds(vaultId: string, query: string): Promise<string[]>;
  listTrash(vaultId: string): Promise<{ folders: Folder[]; notes: NoteEntry[]; attachments: Attachment[] }>;
  listSyncTombstones(vaultId: string): Promise<SyncTombstone[]>;
  createFolder(vaultId: string, parentId: string | null, name: string): Promise<Folder>;
  renameFolder(id: string, name: string): Promise<Folder>;
  moveFolder(id: string, parentId: string | null): Promise<Folder>;
  deleteFolder(id: string): Promise<void>;
  restoreFolder(id: string): Promise<void>;
  permanentlyDeleteFolder(id: string): Promise<void>;
  createNote(vaultId: string, folderId?: string | null, title?: string, markdown?: string | ((path: string) => string)): Promise<VaultNote>;
  importNote(vaultId: string, folderId: string | null, input: Pick<VaultNote, 'path' | 'title' | 'markdown' | 'createdAt' | 'updatedAt' | 'aliases' | 'properties'>): Promise<VaultNote>;
  getNote(id: string): Promise<VaultNote | undefined>;
  saveNote(id: string, patch: Partial<Pick<VaultNote, 'title' | 'markdown' | 'aliases' | 'properties'>>, forceCheckpoint?: boolean): Promise<VaultNote>;
  renameNote(id: string, title: string): Promise<VaultNote>;
  renameNoteWithLinks(id: string, title: string, expectedRevision: number, changes: RenameChange[], expectedRevisions: { id: string; revision: number }[]): Promise<VaultNote>;
  applyVaultNoteEdits(vaultId: string, changes: TagChange[], expectedRevisions: { id: string; revision: number }[]): Promise<VaultNote[]>;
  applyNoteRefactor(vaultId: string, plan: NoteRefactorPlan): Promise<{ created: VaultNote[]; updated: VaultNote[] }>;
  moveNote(id: string, folderId: string | null): Promise<VaultNote>;
  duplicateNote(id: string): Promise<VaultNote>;
  deleteNote(id: string): Promise<void>;
  restoreNote(id: string): Promise<VaultNote>;
  permanentlyDeleteNote(id: string): Promise<void>;
  listRevisions(noteId: string): Promise<Revision[]>;
  restoreRevision(noteId: string, revisionId: string, expectedRevision: number): Promise<VaultNote>;
  duplicateRevision(noteId: string, revisionId: string): Promise<VaultNote>;
  importRevisionHistory(noteId: string, revisions: Revision[]): Promise<void>;
  addAttachment(vaultId: string, folderId: string | null, file: Blob, name: string, recording?: Attachment['recording']): Promise<Attachment>;
  getAttachmentBlob(id: string): Promise<Blob | undefined>;
  renameAttachment(id: string, name: string): Promise<Attachment>;
  renameAttachmentWithLinks(id: string, name: string, expectedPath: string, expectedUpdatedAt: string, changes: AttachmentLinkChange[], expectedRevisions: { id: string; revision: number }[]): Promise<Attachment>;
  moveAttachment(id: string, folderId: string | null): Promise<Attachment>;
  deleteAttachment(id: string): Promise<void>;
  restoreAttachment(id: string): Promise<Attachment>;
  permanentlyDeleteAttachment(id: string): Promise<void>;
  emptyTrash(vaultId: string): Promise<void>;
  putObject(kind: VaultObjectKind, value: unknown): Promise<VaultObject>;
  listObjects(kind: VaultObjectKind, vaultId?: string): Promise<VaultObject[]>;
  deleteObject(id: string): Promise<void>;
  close(): void;
}
