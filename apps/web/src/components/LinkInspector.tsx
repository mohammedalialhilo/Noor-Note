'use client';

import { findUnlinkedMentions, replaceMention, scanLinks, type LinkOccurrence, type UnlinkedMention, type VaultNote } from '@noor-note/core';
import type { NoteEntry, VaultRepository } from '@noor-note/storage';
import { ArrowRight, Link2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import styles from './LinkInspector.module.css';

interface Props {
  note: VaultNote;
  notes: NoteEntry[];
  repository: VaultRepository | null;
  onSelect: (id: string, fragment?: string) => void;
  onCreateMissing: (target: string) => void;
  onRefresh: () => Promise<void>;
  readOnly?: boolean;
}
const ignoreKey = (note: VaultNote) => `noor-note-ignored-mentions:${note.vaultId}:${note.id}`;
const oneKey = (mention: UnlinkedMention) => `${mention.sourceNoteId}:${mention.start}:${mention.text}`;
const sourceKey = (mention: UnlinkedMention) => `source:${mention.sourceNoteId}`;
function readIgnored(note: VaultNote): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(ignoreKey(note)) ?? '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && item.length < 400) : []);
  } catch { return new Set(); }
}

export function LinkInspector({ note, notes, repository, onSelect, onCreateMissing, onRefresh, readOnly = false }: Props) {
  const [allNotes, setAllNotes] = useState<VaultNote[] | null>(null);
  const [loadedCount, setLoadedCount] = useState(0);
  const [ignored, setIgnored] = useState(() => readIgnored(note));
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!repository) return;
    let live = true;
    const timer = window.setTimeout(() => {
      setAllNotes(null);
      setLoadedCount(0);
      void (async () => {
        const loaded: VaultNote[] = [];
        for (let offset = 0; offset < notes.length && live; offset += 500) {
          const ids = notes.slice(offset, offset + 500).map((entry) => entry.id);
          const batch = repository.getNotes ? await repository.getNotes(ids) : (await Promise.all(ids.map((id) => repository.getNote(id)))).filter((item): item is VaultNote => Boolean(item));
          const byId = new Map(batch.map((item) => [item.id, item]));
          for (const id of ids) {
            const item = id === note.id ? note : byId.get(id);
            if (item) loaded.push(item);
          }
          if (live) setLoadedCount(loaded.length);
        }
        if (live) { setAllNotes(loaded); setError(null); }
      })().catch(() => { if (live) setError('Could not load link details. Try reopening the inspector.'); });
    }, 250);
    return () => { live = false; window.clearTimeout(timer); };
  }, [note, notes, repository, version]);

  const graph = useMemo(() => allNotes ? scanLinks(allNotes) : [], [allNotes]);
  const outgoing = graph.filter((item) => item.sourceNoteId === note.id);
  const backlinks = graph.filter((item) => item.sourceNoteId !== note.id && item.link.noteId === note.id);
  const mentions = allNotes ? findUnlinkedMentions(allNotes, note).filter((item) => !ignored.has(oneKey(item)) && !ignored.has(sourceKey(item))) : [];

  const remember = (key: string) => {
    const next = new Set([...ignored, key]);
    setIgnored(next);
    try { localStorage.setItem(ignoreKey(note), JSON.stringify([...next])); } catch { setError('Could not save the ignored mention on this device.'); }
  };
  const convert = async (mention: UnlinkedMention) => {
    if (!repository || readOnly) return;
    try {
      const source = await repository.getNote(mention.sourceNoteId);
      if (!source) throw new Error('Source note is missing');
      const previewed = allNotes?.find((item) => item.id === source.id);
      if (!previewed || previewed.revision !== source.revision || previewed.markdown !== source.markdown) throw new Error('Source note changed');
      await repository.saveNote(source.id, { markdown: replaceMention(source.markdown, mention, note) }, true);
      setError(null);
      setVersion((current) => current + 1);
      await onRefresh();
    } catch { setError('The mention changed or could not be saved. Reopen the inspector and try again.'); }
  };
  const linkRow = (item: LinkOccurrence, direction: 'in' | 'out') => {
    const label = direction === 'in' ? item.sourceTitle || 'Untitled note' : item.link.alias || item.link.target || note.title;
    const canOpen = direction === 'in' || Boolean(item.link.noteId);
    const targetId = direction === 'in' ? item.sourceNoteId : item.link.noteId;
    return <li key={`${item.sourceNoteId}:${item.link.start}`} className={styles.row}>
      <div className={styles.rowTop}>{canOpen && targetId ? <button type="button" onClick={() => onSelect(targetId, direction === 'out' ? item.link.heading ?? item.link.blockId ?? undefined : undefined)}><Link2 size={13} /> {label} <ArrowRight size={12} /></button> : <span>{label}</span>}<small>{direction === 'out' ? item.link.status.replace('-', ' ') : `Line ${item.link.line}`}</small></div>
      {item.link.headingContext && <span className={styles.context}>Under {item.link.headingContext}</span>}
      <p>{item.link.preview}</p>
      {!readOnly && direction === 'out' && item.link.status === 'missing' && item.link.target && <button type="button" className={styles.smallAction} onClick={() => onCreateMissing(item.link.target)}>Create missing note</button>}
    </li>;
  };
  return <div className={styles.inspector}>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {!allNotes && !error && <p className={styles.empty}>Loading link details{loadedCount ? ` (${loadedCount} of ${notes.length} notes)` : ''}…</p>}
    {allNotes && <>
      <section><h3>Outgoing links <span>{outgoing.length}</span></h3>{outgoing.length ? <ul>{outgoing.map((item) => linkRow(item, 'out'))}</ul> : <p className={styles.empty}>Add a wiki or local Markdown link to connect notes.</p>}</section>
      <section><h3>Backlinks <span>{backlinks.length}</span></h3>{backlinks.length ? <ul>{backlinks.map((item) => linkRow(item, 'in'))}</ul> : <p className={styles.empty}>No notes link here yet. Add a wiki link to this note from another note to see it here.</p>}</section>
      <section><h3>Unlinked mentions <span>{mentions.length}</span></h3>{mentions.length ? <ul>{mentions.map((mention) => <li key={oneKey(mention)} className={styles.row}><strong>{mention.sourceTitle || 'Untitled note'}</strong><small>Line {mention.line}{mention.headingContext ? ` · ${mention.headingContext}` : ''}</small><p>{mention.preview}</p><div className={styles.actions}>{!readOnly && <button type="button" onClick={() => { void convert(mention); }}>Convert to link</button>}<button type="button" onClick={() => remember(oneKey(mention))}>Ignore</button><button type="button" onClick={() => remember(sourceKey(mention))}>Ignore all from note</button></div></li>)}</ul> : <p className={styles.empty}>No unlinked mentions found.</p>}</section>
    </>}
  </div>;
}
