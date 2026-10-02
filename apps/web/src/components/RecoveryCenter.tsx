'use client';

import { checksumMarkdown } from '@noor-note/core';
import Image from 'next/image';
import type { VaultRepository } from '@noor-note/storage';
import { Dialog } from '@noor-note/ui';
import { FileArchive, FileText, History, LifeBuoy, Menu } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { loadRecoveryInventory, recoveryItemVaultId, restoreAsRecoveryCopy, type RecoveryInventory, type RecoveryItem } from '../lib/recovery-center';
import { discardRecoveryDraft } from '../lib/recovery-drafts';
import { previewImageTypes, safeAttachmentPreview } from '../lib/safe-attachment-preview';
import styles from './RecoveryCenter.module.css';

interface Props {
  vaultId: string;
  repository: VaultRepository;
  beforeChange: () => Promise<void>;
  onChanged: () => Promise<void>;
  onOpenNote: (id: string) => void;
  onOpenTrash: () => void;
  onOpenNavigation: (event: MouseEvent<HTMLButtonElement>) => void;
  readOnly?: boolean;
}

function label(item: RecoveryItem): string {
  switch (item.kind) {
    case 'deleted-note': case 'conflict-note': return item.note.title || 'Untitled note';
    case 'deleted-attachment': case 'conflict-attachment': return item.attachment.name;
    case 'revision': return `${item.revision.title || 'Untitled note'} · revision ${item.revision.number}`;
    case 'draft': return item.draft.title || 'Untitled draft';
  }
}
function detail(item: RecoveryItem): string {
  switch (item.kind) {
    case 'deleted-note': return `${item.note.path} · Deleted ${new Date(item.note.deletedAt ?? 0).toLocaleString()}`;
    case 'deleted-attachment': return `${item.attachment.path} · Deleted ${new Date(item.attachment.deletedAt ?? 0).toLocaleString()}`;
    case 'conflict-note': return item.note.path;
    case 'conflict-attachment': return item.attachment.path;
    case 'revision': return `${item.revision.path} · ${new Date(item.revision.createdAt).toLocaleString()}`;
    case 'draft': return `Unsaved snapshot · ${new Date(item.draft.updatedAt).toLocaleString()}`;
  }
}
function key(item: RecoveryItem): string {
  switch (item.kind) {
    case 'deleted-note': case 'conflict-note': return `${item.kind}:${item.note.id}`;
    case 'deleted-attachment': case 'conflict-attachment': return `${item.kind}:${item.attachment.id}`;
    case 'revision': return `revision:${item.revision.id}`;
    case 'draft': return `draft:${item.draft.noteId}`;
  }
}
const EMPTY: RecoveryInventory = { deleted: [], revisions: [], drafts: [], conflicts: [], deletedFolders: 0 };

export function RecoveryCenter({ vaultId, repository, beforeChange, onChanged, onOpenNote, onOpenTrash, onOpenNavigation, readOnly = false }: Props) {
  const [inventory, setInventory] = useState<RecoveryInventory>(EMPTY);
  const [preview, setPreview] = useState<RecoveryItem | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const imageUrl = useRef<string | null>(null);
  const previewRequest = useRef(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => { setInventory(await loadRecoveryInventory(repository, vaultId)); }, [repository, vaultId]);
  useEffect(() => {
    let live = true;
    void load().catch((cause: unknown) => { if (live) setError(cause instanceof Error ? cause.message : 'Could not load recovery items.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; previewRequest.current += 1; if (imageUrl.current) URL.revokeObjectURL(imageUrl.current); };
  }, [load]);

  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(null); setMessage(null);
    try { await work(); await onChanged(); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Recovery action failed.'); }
    finally { setBusy(false); }
  };

  const closePreview = () => {
    previewRequest.current += 1;
    setPreview(null); setPreviewText(null); setPreviewImage(null);
    if (imageUrl.current) { URL.revokeObjectURL(imageUrl.current); imageUrl.current = null; }
  };
  const showPreview = (item: RecoveryItem) => {
    void (async () => {
      closePreview(); setError(null);
      const request = previewRequest.current;
      let markdown: string | null = null;
      if (item.kind === 'draft') markdown = item.draft.markdown;
      else if (item.kind === 'revision') {
        if (await checksumMarkdown(item.revision.markdown) !== item.revision.checksum) throw new Error('Revision checksum failed');
        markdown = item.revision.markdown;
      } else if (item.kind === 'deleted-note' || item.kind === 'conflict-note') {
        const note = await repository.getNote(item.note.id);
        if (!note || note.vaultId !== vaultId) throw new Error('Note is no longer available');
        markdown = note.markdown;
      } else {
        const blob = await repository.getAttachmentBlob(item.attachment.id);
        if (!blob) throw new Error('Attachment bytes are missing');
        if (previewImageTypes.has(item.attachment.mime)) {
          const safe = await safeAttachmentPreview(blob, item.attachment.mime);
          if (safe && request === previewRequest.current) { imageUrl.current = URL.createObjectURL(safe); setPreviewImage(imageUrl.current); }
        }
      }
      if (request !== previewRequest.current) return;
      setPreviewText(markdown);
      setPreview(item);
    })().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Could not preview this item.'));
  };

  const restore = (item: RecoveryItem) => run(async () => {
    if (recoveryItemVaultId(item) !== vaultId) throw new Error('Recovery item belongs to another vault');
    if (readOnly && item.kind !== 'conflict-note') throw new Error('This shared vault is read-only for your account.');
    if (item.kind === 'conflict-note') { onOpenNote(item.note.id); setMessage('Opened the conflict copy.'); return; }
    await beforeChange();
    if (item.kind === 'deleted-note') await repository.restoreNote(item.note.id);
    else if (item.kind === 'deleted-attachment') await repository.restoreAttachment(item.attachment.id);
    else if (item.kind === 'revision') {
      const note = await repository.getNote(item.revision.noteId);
      if (!note || note.deletedAt) throw new Error('Restore the deleted note first, or restore this revision as a copy.');
      if (!window.confirm(`Restore revision ${item.revision.number}? The current version remains in history.`)) return;
      const restored = await repository.restoreRevision(note.id, item.revision.id, note.revision);
      onOpenNote(restored.id);
    } else if (item.kind === 'draft') {
      const note = await repository.getNote(item.draft.noteId);
      if (!note || note.vaultId !== vaultId || note.deletedAt || item.savedRevision === null) throw new Error('The original note is unavailable. Restore this snapshot as a copy.');
      if (note.revision !== item.savedRevision) throw new Error('The note changed since the recovery list loaded. Refresh and review it again.');
      if (!window.confirm(`Replace ${note.title || 'Untitled note'} with its unsaved snapshot? The saved version remains in history.`)) return;
      await repository.saveNote(note.id, { title: item.draft.title, markdown: item.draft.markdown }, true);
      discardRecoveryDraft(item.draft.noteId);
      onOpenNote(note.id);
    } else throw new Error('This attachment conflict copy is already in the vault. Use Preview or Restore as copy.');
    closePreview(); setMessage('Item restored.');
  });

  const copy = (item: RecoveryItem) => run(async () => {
    if (readOnly) throw new Error('This shared vault is read-only for your account.');
    await beforeChange();
    const created = await restoreAsRecoveryCopy(repository, vaultId, item);
    if ('markdown' in created) onOpenNote(created.id);
    closePreview(); setMessage('A separate recovery copy was created.');
  });

  const purge = (item: RecoveryItem) => run(async () => {
    if (recoveryItemVaultId(item) !== vaultId) throw new Error('Recovery item belongs to another vault');
    if (readOnly) throw new Error('This shared vault is read-only for your account.');
    if (!window.confirm(`Permanently delete ${label(item)}? This cannot be undone.`)) return;
    await beforeChange();
    switch (item.kind) {
      case 'deleted-note': await repository.permanentlyDeleteNote(item.note.id); break;
      case 'deleted-attachment': await repository.permanentlyDeleteAttachment(item.attachment.id); break;
      case 'revision': await repository.permanentlyDeleteRevision(item.revision.noteId, item.revision.id); break;
      case 'draft': discardRecoveryDraft(item.draft.noteId); break;
      case 'conflict-note': await repository.deleteNote(item.note.id); await repository.permanentlyDeleteNote(item.note.id); break;
      case 'conflict-attachment': await repository.deleteAttachment(item.attachment.id); await repository.permanentlyDeleteAttachment(item.attachment.id); break;
    }
    closePreview(); setMessage('Item permanently deleted.');
  });

  const section = (title: string, description: string, items: RecoveryItem[]) => <section className={styles.section} aria-label={title}>
    <div className={styles.sectionHead}><h2>{title} <span>{items.length}</span></h2><p>{description}</p></div>
    {items.length ? <ul className={styles.list}>{items.map((item) => <li key={key(item)}>
      {item.kind === 'revision' ? <History size={18} /> : item.kind.includes('attachment') ? <FileArchive size={18} /> : <FileText size={18} />}
      <div className={styles.meta}><strong>{label(item)}</strong><span>{detail(item)}</span></div>
      <div className={styles.actions}>
        <button type="button" disabled={busy} onClick={() => showPreview(item)}>Preview</button>
        <button type="button" disabled={busy || readOnly && item.kind !== 'conflict-note' || item.kind === 'conflict-attachment' || item.kind === 'draft' && item.savedRevision === null || item.kind === 'revision' && !item.sourceAvailable} onClick={() => { void restore(item); }}>{item.kind === 'conflict-attachment' ? 'Already in vault' : item.kind === 'conflict-note' ? 'Open' : 'Restore'}</button>
        <button type="button" disabled={busy || readOnly} onClick={() => { void copy(item); }}>Restore as copy</button>
        <button type="button" disabled={busy || readOnly || item.kind === 'revision' && item.isCurrent} className={styles.danger} onClick={() => { void purge(item); }}>Delete forever</button>
      </div>
    </li>)}</ul> : <p className={styles.empty}>No {title.toLowerCase()} in this vault.</p>}
  </section>;

  return <main className={styles.page}>
    <div className={styles.topbar}><button type="button" className={styles.mobileMenu} aria-label="Open navigation" onClick={onOpenNavigation}><Menu size={20} /></button>Recovery Center</div>
    <div className={styles.content}>
      <div className={styles.heading}><div><span>YOUR VAULT</span><h1>Recovery Center</h1><p>Review saved history and recover content without changing the original until you choose an action.</p></div><button type="button" disabled={busy || loading} onClick={() => { void load().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Could not refresh recovery items.')); }}>Refresh</button></div>
      {loading && <p role="status">Loading recovery items…</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {message && <p className={styles.message} role="status">{message}</p>}
      {section('Deleted notes and attachments', 'Restore from Trash, make a separate copy, or permanently remove an item.', inventory.deleted)}
      {inventory.deletedFolders > 0 && <p className={styles.folderHint}>{inventory.deletedFolders} deleted {inventory.deletedFolders === 1 ? 'folder is' : 'folders are'} managed in <button type="button" onClick={onOpenTrash}>Trash</button>.</p>}
      {section('Unsaved recovery snapshots', 'Browser drafts that differ from the saved note. Restoring replaces the note after confirmation.', inventory.drafts)}
      {section('Recent revisions', 'The 50 most recent checkpoints in this vault. Current checkpoints cannot be deleted.', inventory.revisions)}
      {section('Sync conflict copies', 'Copies kept when local and cloud changes diverged. These are already present in your vault.', inventory.conflicts)}
      <p className={styles.footnote}><LifeBuoy size={16} /> Conflict copies are identified by Noor Note’s sync naming pattern. Renaming a reviewed copy removes it from this list. Browser drafts are stored only in this browser.</p>
    </div>
    <Dialog open={Boolean(preview)} onOpenChange={(open) => { if (!open) closePreview(); }} title={preview ? `Preview: ${label(preview)}` : 'Recovery preview'} description={preview ? detail(preview) : undefined} contentClassName={styles.dialog}>
      {preview && <div className={styles.preview}>
        {previewText !== null ? <><pre>{previewText.length > 20_000 ? `${previewText.slice(0, 20_000)}\n… preview truncated` : previewText || '(empty note)'}</pre>{previewText.length > 20_000 && <p>Only the preview is shortened. Recovery uses the complete text.</p>}</> : previewImage ? <Image src={previewImage} alt={`Preview of ${label(preview)}`} width={1000} height={800} unoptimized /> : <p>Content preview is unavailable for this file type. The file is {(preview.kind === 'deleted-attachment' || preview.kind === 'conflict-attachment' ? preview.attachment.size / 1024 : 0).toFixed(1)} KiB; restoring preserves its original bytes.</p>}
        <div className={styles.previewActions}><button type="button" onClick={closePreview}>Close preview</button><button type="button" onClick={() => { void copy(preview); }} disabled={busy || readOnly}>Restore as copy</button></div>
      </div>}
    </Dialog>
  </main>;
}
