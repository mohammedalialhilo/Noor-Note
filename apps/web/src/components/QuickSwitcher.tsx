'use client';

import type { Folder } from '@noor-note/core';
import type { NoteEntry } from '@noor-note/storage';
import { Dialog } from '@noor-note/ui';
import { FilePlus2, FileText, FolderOpen, Columns2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { canCreateMissingNote, quickSwitcherEntries, type SwitcherEntry } from '../lib/quick-switcher';
import styles from './QuickSwitcher.module.css';

type OpenMode = 'current' | 'tab' | 'split';
interface Props {
  open: boolean; onOpenChange: (open: boolean) => void; notes: NoteEntry[]; folders: Folder[]; recentIds: string[];
  onOpenNote: (id: string, mode: OpenMode) => Promise<boolean>;
  onOpenFolder: (id: string) => void;
  onCreate: (target: string) => Promise<boolean>;
}
export function QuickSwitcher({ open, onOpenChange, notes, folders, recentIds, onOpenNote, onOpenFolder, onCreate }: Props) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const entries = useMemo(() => quickSwitcherEntries(notes, folders, query, recentIds), [notes, folders, query, recentIds]);
  const create = canCreateMissingNote(query, notes);
  const count = entries.length + (create ? 1 : 0);
  const close = () => { setQuery(''); setActive(0); setError(null); onOpenChange(false); };
  const openEntry = async (entry: SwitcherEntry | null, mode: OpenMode = 'current') => {
    if (busy) return;
    setBusy(true);
    try {
      if (!entry) { if (await onCreate(query.trim().replace(/\.md$/iu, ''))) close(); }
      else if (entry.kind === 'folder') { onOpenFolder(entry.id); close(); }
      else if (await onOpenNote(entry.id, mode)) close();
      else setError('Could not open the note. Check the workspace message.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not open the item.'); }
    finally { setBusy(false); }
  };
  return <Dialog open={open} onOpenChange={(next) => { if (!next) close(); else onOpenChange(true); }} title="Quick switcher" description="Find a note or folder. Enter opens it, Ctrl or Command plus Enter opens a new tab, and Alt plus Enter opens a split." contentClassName={styles.dialog}>
    <input autoFocus className={styles.input} type="search" aria-label="Find a note or folder" placeholder="Search notes and folders…" value={query} onChange={(event) => { setQuery(event.target.value); setActive(0); setError(null); }} onKeyDown={(event) => {
      if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => count ? (index + 1) % count : 0); }
      if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => count ? (index - 1 + count) % count : 0); }
      if (event.key === 'Enter' && count) { event.preventDefault(); void openEntry(entries[active] ?? null, event.altKey ? 'split' : event.metaKey || event.ctrlKey ? 'tab' : 'current'); }
    }} />
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.results} aria-label="Switcher results">
      {!query.trim() && entries.length > 0 && <p className={styles.caption}>RECENT NOTES</p>}
      {entries.map((entry, index) => <div key={`${entry.kind}:${entry.id}`} className={`${styles.row} ${active === index ? styles.active : ''}`}>
        <button type="button" className={styles.main} onMouseEnter={() => setActive(index)} onClick={() => { void openEntry(entry); }}>{entry.kind === 'folder' ? <FolderOpen size={17} /> : <FileText size={17} />}<span><strong>{entry.title}</strong><small>{entry.path}</small></span></button>
        {entry.kind === 'note' && <div className={styles.actions}><button type="button" title="Open in new tab" aria-label={`Open ${entry.title} in new tab`} onClick={() => { void openEntry(entry, 'tab'); }}><FilePlus2 size={16} /></button><button type="button" title="Open in split" aria-label={`Open ${entry.title} in split`} onClick={() => { void openEntry(entry, 'split'); }}><Columns2 size={16} /></button></div>}
      </div>)}
      {create && <button type="button" className={`${styles.create} ${active === entries.length ? styles.active : ''}`} onMouseEnter={() => setActive(entries.length)} onClick={() => { void openEntry(null); }}><FilePlus2 size={17} /> Create “{query.trim().replace(/\.md$/iu, '')}”</button>}
      {!count && <p className={styles.empty}>No notes or folders match.</p>}
    </div>
    <p className={styles.hint}>↑↓ Navigate · Enter Open · Ctrl/⌘ Enter New tab · Alt Enter Split</p>
  </Dialog>;
}
