'use client';

import { useEffect, useMemo, useState } from 'react';
import { Dialog } from '@noor-note/ui';
import type { Revision, VaultNote } from '@noor-note/core';
import type { VaultRepository } from '@noor-note/storage';
import { diffMarkdown, diffRevisionMetadata, pairDiffLines } from '../lib/revision-diff';
import styles from './VersionHistory.module.css';

interface Props {
  noteId: string;
  repository: VaultRepository;
  flushPending: () => Promise<void>;
  onClose: () => void;
  onRestored: (note: VaultNote, sourceRevisionId: string) => Promise<void>;
  onDuplicated: (note: VaultNote) => Promise<void>;
}

export function VersionHistory({ noteId, repository, flushPending, onClose, onRestored, onDuplicated }: Props) {
  const [current, setCurrent] = useState<VaultNote | null>(null);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compareId, setCompareId] = useState('current');
  const [view, setView] = useState<'preview' | 'compare'>('compare');
  const [layout, setLayout] = useState<'inline' | 'side-by-side'>('inline');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        await flushPending();
        const [note, history] = await Promise.all([repository.getNote(noteId), repository.listRevisions(noteId)]);
        if (!note) throw new Error('The note is no longer available');
        if (live) { setCurrent(note); setRevisions(history); setSelectedId(history[1]?.id ?? history[0]?.id ?? null); }
      } catch (caught) { if (live) setError(caught instanceof Error ? caught.message : 'Could not load version history'); }
      finally { if (live) setBusy(false); }
    })();
    return () => { live = false; };
  }, [flushPending, noteId, repository]);

  const selected = revisions.find((revision) => revision.id === selectedId) ?? null;
  const comparison = compareId === 'current' ? current : revisions.find((revision) => revision.id === compareId) ?? current;
  const diff = useMemo(() => selected && comparison ? diffMarkdown(selected.markdown, comparison.markdown) : [], [selected, comparison]);
  const sideRows = useMemo(() => pairDiffLines(diff), [diff]);
  const metadata = useMemo(() => selected && comparison ? diffRevisionMetadata(selected, comparison) : [], [selected, comparison]);
  const changed = diff.filter((line) => line.kind !== 'equal').length;

  const run = async (action: 'restore' | 'duplicate') => {
    if (!selected || !current) return;
    if (action === 'restore' && !window.confirm(`Restore revision ${selected.number}? This creates a new revision and keeps the current version in history.`)) return;
    setBusy(true); setError(null);
    try {
      await flushPending();
      if (action === 'restore') await onRestored(await repository.restoreRevision(noteId, selected.id, current.revision), selected.id);
      else await onDuplicated(await repository.duplicateRevision(noteId, selected.id));
      onClose();
    } catch (caught) { setError(caught instanceof Error ? caught.message : `Could not ${action} revision`); setBusy(false); }
  };

  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }} title="Version history" description="Preview and compare saved checkpoints for this note." contentClassName={styles.dialog}>
    <div className={styles.shell}>
      <aside className={styles.timeline} aria-label="Saved revisions">
        {revisions.length ? revisions.map((revision) => <button type="button" key={revision.id} className={`${styles.revision} ${revision.id === selectedId ? styles.selected : ''}`} aria-pressed={revision.id === selectedId} onClick={() => setSelectedId(revision.id)}>
          <strong>Revision {revision.number}</strong><span>{new Date(revision.createdAt).toLocaleString()}</span><small>{revision.kind}{revision.restoredFromId ? ' · restored' : ''}</small>
        </button>) : <p className={styles.empty}>{busy ? 'Loading history…' : 'No saved revisions yet.'}</p>}
      </aside>
      <section className={styles.main} aria-label="Revision details">
        {selected && <>
          <div className={styles.toolbar}>
            <div className={styles.segment} role="group" aria-label="History view"><button type="button" aria-pressed={view === 'preview'} onClick={() => setView('preview')}>Preview</button><button type="button" aria-pressed={view === 'compare'} onClick={() => setView('compare')}>Compare</button></div>
            {view === 'compare' && <><label>With <select aria-label="Compare with" value={compareId} onChange={(event) => setCompareId(event.target.value)}><option value="current">Current note</option>{revisions.filter((item) => item.id !== selectedId).map((item) => <option key={item.id} value={item.id}>Revision {item.number}</option>)}</select></label><div className={styles.segment} role="group" aria-label="Diff layout"><button type="button" aria-pressed={layout === 'inline'} onClick={() => setLayout('inline')}>Inline</button><button type="button" aria-pressed={layout === 'side-by-side'} onClick={() => setLayout('side-by-side')}>Side by side</button></div></>}
          </div>
          <div className={styles.content}>
            {view === 'preview' ? <><h3>{selected.title || 'Untitled note'}</h3><p className={styles.path}>{selected.path}</p><pre className={styles.preview}>{selected.markdown || '(empty note)'}</pre></> : <>
              <p className={styles.summary}>{changed ? `${changed} changed ${changed === 1 ? 'line' : 'lines'}` : 'No Markdown changes'}</p>
              {metadata.length > 0 && <section className={styles.metadata} aria-label="Metadata changes"><h3>Metadata changes</h3><div className={styles.metadataGrid}>{metadata.map((item) => <div key={item.field} className={styles.metadataRow}><strong>{item.field}</strong><span className={styles.removed}>{item.before}</span><span className={styles.added}>{item.after}</span></div>)}</div></section>}
              {!selected.metadata && <p className={styles.legacy}>This older checkpoint did not record aliases, properties, or folder metadata.</p>}
              {layout === 'inline' ? <div className={styles.diff} role="region" aria-label="Inline Markdown diff"><div className={styles.diffHeader}>Revision {selected.number} → {compareId === 'current' ? 'Current' : `Revision ${revisions.find((item) => item.id === compareId)?.number ?? ''}`}</div>{diff.map((line, index) => <div key={index} className={`${styles.diffLine} ${styles[line.kind]}`}><span className={styles.lineNumber}>{line.beforeLine ?? ''}</span><span className={styles.lineNumber}>{line.afterLine ?? ''}</span><span className={styles.marker}>{line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}</span><code>{line.text || ' '}</code></div>)}</div> : <div className={styles.sideBySide} role="region" aria-label="Side by side Markdown diff"><div className={styles.diffHeader}>Revision {selected.number}</div><div className={styles.diffHeader}>{compareId === 'current' ? 'Current' : `Revision ${revisions.find((item) => item.id === compareId)?.number ?? ''}`}</div>{sideRows.map((row, index) => <div key={index} className={styles.sideRow}><div className={`${styles.sideCell} ${row.before?.kind === 'removed' ? styles.removed : ''}`}><span>{row.before?.beforeLine ?? ''}</span><code>{row.before?.text || ' '}</code></div><div className={`${styles.sideCell} ${row.after?.kind === 'added' ? styles.added : ''}`}><span>{row.after?.afterLine ?? ''}</span><code>{row.after?.text || ' '}</code></div></div>)}</div>}
            </>}
          </div>
          <div className={styles.actions}><button type="button" disabled={busy} onClick={() => { void run('duplicate'); }}>Duplicate revision</button><button type="button" className={styles.primary} disabled={busy} onClick={() => { void run('restore'); }}>Restore revision</button></div>
        </>}
        {error && <p className={styles.error} role="alert">{error}</p>}
      </section>
    </div>
  </Dialog>;
}
