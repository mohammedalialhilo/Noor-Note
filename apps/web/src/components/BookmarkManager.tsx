'use client';

import { useState, type FormEvent } from 'react';
import { Bookmark as BookmarkIcon, FolderPlus, Pin, RotateCcw, Star, Trash2, X } from 'lucide-react';
import { Dialog } from '@noor-note/ui';
import type { Bookmark } from '@noor-note/core';
import type { NoteEntry } from '@noor-note/storage';
import type { BookmarkDraft } from '../lib/bookmarks';
import type { EditorTab } from '../lib/editor-layout';
import styles from './BookmarkManager.module.css';

interface Props {
  open: boolean; onOpenChange: (open: boolean) => void; bookmarks: Bookmark[]; notes: NoteEntry[];
  bases: { id: string; title: string }[]; canvases: { id: string; title: string }[];
  recentNoteIds: string[]; recentSearches: string[]; closedTabs: { paneId: string; tab: EditorTab }[];
  onCreate: (draft: BookmarkDraft) => Promise<boolean>; onUpdate: (item: Bookmark, patch: Partial<BookmarkDraft>) => Promise<boolean>;
  onRemove: (item: Bookmark) => Promise<boolean>; onOpen: (item: Bookmark) => void;
  onToggleNoteFlag: (noteId: string, flag: 'favorite' | 'pinned') => Promise<boolean>;
  onOpenNote: (noteId: string) => void; onOpenSearch: (query: string) => void; onRestoreClosed: (index: number) => void;
  error: string | null;
}

export function BookmarkManager({ open, onOpenChange, bookmarks, notes, bases, canvases, recentNoteIds, recentSearches, closedTabs, onCreate, onUpdate, onRemove, onOpen, onToggleNoteFlag, onOpenNote, onOpenSearch, onRestoreClosed, error }: Props) {
  const [kind, setKind] = useState<Bookmark['kind']>('note');
  const [title, setTitle] = useState('');
  const [targetId, setTargetId] = useState('');
  const [fragment, setFragment] = useState('');
  const [query, setQuery] = useState('');
  const [url, setUrl] = useState('');
  const [parentId, setParentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const groups = bookmarks.filter((item) => item.kind === 'group');
  const noteById = new Map(notes.map((note) => [note.id, note]));
  const noteBookmarks = (id: string) => bookmarks.filter((item) => item.kind === 'note' && item.noteId === id);
  const run = async (action: () => Promise<boolean>, success: string) => {
    setBusy(true); setMessage(null);
    try { setMessage(await action() ? success : 'The bookmark could not be changed.'); }
    catch (caught) { setMessage(caught instanceof Error ? caught.message : 'The bookmark could not be changed.'); }
    finally { setBusy(false); }
  };
  const create = (event: FormEvent) => {
    event.preventDefault();
    const target = kind === 'base' ? bases.find((item) => item.id === targetId) : kind === 'canvas' ? canvases.find((item) => item.id === targetId) : noteById.get(targetId);
    const defaultTitle = kind === 'search' ? query.trim().replaceAll(/[\\/]/gu, '-') : kind === 'url' ? url.trim().replace(/^https?:\/\//iu, '').split('/')[0] : target?.title || 'Untitled note';
    const draft: BookmarkDraft = { kind, title: title.trim() || defaultTitle.slice(0, 200), parentId: parentId || null,
      noteId: ['note', 'heading', 'block'].includes(kind) ? targetId || undefined : undefined,
      resourceId: kind === 'base' || kind === 'canvas' ? targetId || undefined : undefined,
      fragment: kind === 'heading' || kind === 'block' ? fragment.trim() : undefined,
      query: kind === 'search' ? query.trim() : undefined, url: kind === 'url' ? url.trim() : undefined };
    void run(async () => { const created = await onCreate(draft); if (created) { setTitle(''); setFragment(''); setQuery(''); setUrl(''); } return created; }, 'Bookmark added.');
  };
  const noteRow = (noteId: string, label?: string) => {
    const note = noteById.get(noteId); if (!note) return null;
    const matches = noteBookmarks(noteId), favorite = matches.some((item) => item.favorite), pinned = matches.some((item) => item.pinned);
    return <div key={`${label ?? 'note'}:${noteId}`} className={styles.noteRow}>
      <button type="button" onClick={() => onOpenNote(noteId)}>{note.title || 'Untitled note'}</button>
      <button type="button" aria-label={`${favorite ? 'Remove favorite' : 'Add favorite'} ${note.title}`} aria-pressed={favorite} disabled={busy} onClick={() => { void run(() => onToggleNoteFlag(noteId, 'favorite'), 'Favorite updated.'); }}><Star size={15} fill={favorite ? 'currentColor' : 'none'} /></button>
      <button type="button" aria-label={`${pinned ? 'Unpin' : 'Pin'} ${note.title}`} aria-pressed={pinned} disabled={busy} onClick={() => { void run(() => onToggleNoteFlag(noteId, 'pinned'), 'Pinned notes updated.'); }}><Pin size={15} fill={pinned ? 'currentColor' : 'none'} /></button>
    </div>;
  };
  const renderGroup = (parent: string | null, depth: number, seen: Set<string>): React.ReactNode => bookmarks.filter((item) => item.parentId === parent && !seen.has(item.id)).map((item) => {
    const nextSeen = new Set(seen).add(item.id);
    return <div key={item.id}>
      <div className={styles.bookmarkRow} style={{ paddingLeft: depth * 16 }}>
        {item.kind === 'group' ? <button type="button" aria-expanded={!collapsed.has(item.id)} onClick={() => setCollapsed((current) => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })}><FolderPlus size={15} /> {item.title}</button> : <button type="button" onClick={() => onOpen(item)}><BookmarkIcon size={15} /> {item.title}<small>{item.kind}</small></button>}
        {item.kind !== 'group' && <button type="button" aria-label={`${item.favorite ? 'Remove favorite' : 'Add favorite'} ${item.title}`} aria-pressed={item.favorite} disabled={busy} onClick={() => { void run(() => onUpdate(item, { favorite: !item.favorite }), 'Favorite updated.'); }}><Star size={14} fill={item.favorite ? 'currentColor' : 'none'} /></button>}
        <button type="button" aria-label={`Rename ${item.title}`} onClick={() => { setRenamingId(item.id); setRenameValue(item.title); }}>Rename</button>
        <select aria-label={`Move ${item.title} to group`} value={item.parentId ?? ''} disabled={busy} onChange={(event) => { void run(() => onUpdate(item, { parentId: event.target.value || null }), 'Bookmark moved.'); }}><option value="">Root</option>{groups.filter((group) => group.id !== item.id).map((group) => <option key={group.id} value={group.id}>{group.title}</option>)}</select>
        <button type="button" aria-label={`Delete ${item.title}`} disabled={busy} onClick={() => { if (window.confirm(`Delete ${item.title}? Items in a deleted group move to the root.`)) void run(() => onRemove(item), 'Bookmark deleted.'); }}><Trash2 size={14} /></button>
      </div>
      {renamingId === item.id && <form className={styles.rename} onSubmit={(event) => { event.preventDefault(); void run(async () => { const saved = await onUpdate(item, { title: renameValue }); if (saved) setRenamingId(null); return saved; }, 'Bookmark renamed.'); }}><input aria-label={`New name for ${item.title}`} value={renameValue} onChange={(event) => setRenameValue(event.target.value)} required maxLength={200} /><button type="submit">Save</button><button type="button" onClick={() => setRenamingId(null)}><X size={14} /> Cancel</button></form>}
      {item.kind === 'group' && !collapsed.has(item.id) && renderGroup(item.id, depth + 1, nextSeen)}
    </div>;
  });
  return <Dialog title="Bookmarks and recents" description="Keep important places close and return to recent work." open={open} onOpenChange={onOpenChange} contentClassName={styles.dialog}>
    <div className={styles.columns}>
      <div className={styles.column}>
        <section><h3>Favorites</h3>{bookmarks.filter((item) => item.favorite).map((item) => item.kind === 'note' && item.noteId ? noteRow(item.noteId, 'favorite') : <button key={item.id} type="button" className={styles.listButton} onClick={() => onOpen(item)}><Star size={14} /> {item.title}</button>)}{!bookmarks.some((item) => item.favorite) && <p>Mark a bookmark as a favorite to keep it here.</p>}</section>
        <section><h3>Pinned notes</h3>{[...new Set(bookmarks.filter((item) => item.pinned && item.noteId).map((item) => item.noteId!))].map((id) => noteRow(id, 'pinned'))}{!bookmarks.some((item) => item.pinned) && <p>No pinned notes yet.</p>}</section>
        <section><h3>Recent notes</h3>{recentNoteIds.slice(0, 10).map((id) => noteRow(id, 'recent'))}{!recentNoteIds.length && <p>No recent notes yet.</p>}</section>
        <section><h3>Recent searches</h3>{recentSearches.slice(0, 10).map((item) => <button key={item} type="button" className={styles.listButton} onClick={() => onOpenSearch(item)}>{item}</button>)}{!recentSearches.length && <p>No recent searches yet.</p>}</section>
        <section><h3>Recently closed tabs</h3>{closedTabs.map((entry, index) => <button key={`${entry.tab.id}:${index}`} type="button" className={styles.listButton} disabled={!noteById.has(entry.tab.noteId)} onClick={() => onRestoreClosed(index)}><RotateCcw size={14} /> {noteById.get(entry.tab.noteId)?.title ?? 'Missing note'}</button>)}{!closedTabs.length && <p>No recently closed tabs.</p>}</section>
      </div>
      <div className={styles.column}>
        <section><h3>Bookmarks</h3>{bookmarks.length ? <div className={styles.tree}>{renderGroup(null, 0, new Set())}</div> : <p>Add a note, search, or URL with the form below.</p>}</section>
        <form className={styles.form} onSubmit={create}><h3>Add bookmark</h3>
          <label>Type<select value={kind} onChange={(event) => { setKind(event.target.value as Bookmark['kind']); setTargetId(''); }}><option value="note">Note</option><option value="heading">Heading</option><option value="block">Block</option><option value="search">Search</option><option value="base">Base</option><option value="canvas">Canvas</option><option value="url">URL</option><option value="group">Group</option></select></label>
          {['note', 'heading', 'block', 'base', 'canvas'].includes(kind) && <label>Target<select required value={targetId} onChange={(event) => setTargetId(event.target.value)}><option value="">Choose {kind}</option>{(kind === 'base' ? bases : kind === 'canvas' ? canvases : notes).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
          {(kind === 'heading' || kind === 'block') && <label>{kind === 'heading' ? 'Heading name or slug' : 'Block ID'}<input required value={fragment} onChange={(event) => setFragment(event.target.value)} /></label>}
          {kind === 'search' && <label>Search query<input required value={query} onChange={(event) => setQuery(event.target.value)} /></label>}
          {kind === 'url' && <label>Web URL<input required type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.org" /></label>}
          <label>Title<input required={kind === 'group'} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} placeholder={kind === 'group' ? 'Group name' : 'Uses target title if empty'} /></label>
          <label>Group<select value={parentId} onChange={(event) => setParentId(event.target.value)}><option value="">Root</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.title}</option>)}</select></label>
          <button type="submit" disabled={busy}><BookmarkIcon size={15} /> Add bookmark</button>
        </form>
      </div>
    </div>
    {error && <p role="alert" className={styles.error}>{error}</p>}{message && <p role="status" className={styles.message}>{message}</p>}
  </Dialog>;
}
