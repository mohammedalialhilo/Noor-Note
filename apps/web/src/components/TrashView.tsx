'use client';

import { Button, Dialog } from '@noor-note/ui';
import { File, FileText, Folder, Menu, RotateCcw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState, type MouseEvent } from 'react';
import type { Attachment, Folder as VaultFolder } from '@noor-note/core';
import type { NoteEntry, VaultRepository } from '@noor-note/storage';
import styles from './TrashView.module.css';

interface TrashViewProps {
  vaultId: string;
  repository: VaultRepository | null;
  onOpenNavigation: (event: MouseEvent<HTMLButtonElement>) => void;
  onChanged: () => Promise<void>;
}

type TrashItem = (VaultFolder & { kind: 'folder' }) | (NoteEntry & { kind: 'note' }) | (Attachment & { kind: 'attachment' });

export function TrashView({ vaultId, repository, onOpenNavigation, onChanged }: TrashViewProps) {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!repository) return;
    const trash = await repository.listTrash(vaultId);
    setItems([
      ...trash.folders.map((item) => ({ ...item, kind: 'folder' as const })),
      ...trash.notes.map((item) => ({ ...item, kind: 'note' as const })),
      ...trash.attachments.map((item) => ({ ...item, kind: 'attachment' as const })),
    ].sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? '')));
  }, [repository, vaultId]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load().catch(() => setError('Could not open Trash.')); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const restore = async (item: TrashItem) => {
    if (!repository) return;
    try {
      if (item.kind === 'folder') await repository.restoreFolder(item.id);
      else if (item.kind === 'note') await repository.restoreNote(item.id);
      else await repository.restoreAttachment(item.id);
      await onChanged(); await load(); setError(null);
    } catch { setError('Could not restore this item. Its original path may now be in use.'); }
  };
  const purge = async (item: TrashItem) => {
    if (!repository || !window.confirm(`Permanently delete ${item.path}? This cannot be undone.`)) return;
    try {
      if (item.kind === 'folder') await repository.permanentlyDeleteFolder(item.id);
      else if (item.kind === 'note') await repository.permanentlyDeleteNote(item.id);
      else await repository.permanentlyDeleteAttachment(item.id);
      await onChanged(); await load(); setError(null);
    } catch { setError('Could not permanently delete this item.'); }
  };
  const empty = async () => {
    if (!repository) return;
    try { await repository.emptyTrash(vaultId); await onChanged(); await load(); setConfirmEmpty(false); setError(null); }
    catch { setError('Could not empty Trash. Please try again.'); }
  };

  return <main className={styles.page}>
    <div className={styles.topbar}><button type="button" className={styles.mobileMenu} aria-label="Open navigation" onClick={onOpenNavigation}><Menu size={20} /></button><span>Trash</span></div>
    <div className={styles.content}>
      <div className={styles.heading}><div><span>YOUR VAULT</span><h1>Trash</h1><p>Restore items or permanently remove them from this browser.</p></div><Button variant="danger" disabled={!items.length} onClick={() => setConfirmEmpty(true)}><Trash2 size={16} /> Empty Trash</Button></div>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {items.length ? <div className={styles.list}>{items.map((item) => <div className={styles.row} key={`${item.kind}:${item.id}`}>
        {item.kind === 'folder' ? <Folder size={18} /> : item.kind === 'note' ? <FileText size={18} /> : <File size={18} />}
        <div><strong>{item.path.split('/').at(-1)}</strong><span>{item.path} · Deleted {item.deletedAt ? new Date(item.deletedAt).toLocaleDateString() : ''}</span></div>
        <button type="button" onClick={() => { void restore(item); }}><RotateCcw size={15} /> Restore</button>
        <button type="button" onClick={() => { void purge(item); }}><Trash2 size={15} /> Delete forever</button>
      </div>)}</div> : <div className={styles.empty}><Trash2 size={30} /><strong>Trash is empty</strong><p>Deleted notes, folders, and attachments appear here.</p></div>}
    </div>
    <Dialog open={confirmEmpty} onOpenChange={setConfirmEmpty} title="Empty Trash" description="All items in this vault's Trash will be permanently deleted. This cannot be undone.">
      <div className={styles.dialogActions}><Button variant="secondary" onClick={() => setConfirmEmpty(false)}>Cancel</Button><Button variant="danger" onClick={() => { void empty(); }}>Delete permanently</Button></div>
    </Dialog>
  </main>;
}
