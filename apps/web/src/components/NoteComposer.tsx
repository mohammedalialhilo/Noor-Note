'use client';

import { useEffect, useState } from 'react';
import { Dialog } from '@noor-note/ui';
import { appendCanvasNode, createCanvasNode, newCanvasDocument, parseOutline, planNoteRefactor, type NoteRefactorPlan, type NoteRefactorRequest, type VaultNote } from '@noor-note/core';
import type { useVaultWorkspace } from '../hooks/useVaultWorkspace';
import { CanvasesStore } from '../lib/canvases';
import styles from './NoteComposer.module.css';

type Kind = NoteRefactorRequest['kind'];
const actions: { kind: Kind; name: string }[] = [
  { kind: 'merge', name: 'Merge into another note' },
  { kind: 'split', name: 'Split by heading' },
  { kind: 'extract-selection', name: 'Extract selection to note' },
  { kind: 'extract-heading', name: 'Extract heading to note' },
  { kind: 'move-heading', name: 'Move heading to note' },
  { kind: 'duplicate-heading', name: 'Duplicate heading' },
  { kind: 'canvas-selection', name: 'Selection to Canvas cards' },
  { kind: 'moc', name: 'Create index note' },
];
type Selection = { from: number; to: number; text: string } | null;
interface Props {
  action: Kind | null; source: VaultNote | null; selection: Selection; workspace: ReturnType<typeof useVaultWorkspace>;
  onClose: () => void; onOpenNote: (id: string) => void; onOpenCanvas: (id: string) => void;
}

export function NoteComposer({ action, source, selection, workspace, onClose, onOpenNote, onOpenCanvas }: Props) {
  const [kind, setKind] = useState<Kind>('merge');
  const [targetId, setTargetId] = useState('');
  const [headingId, setHeadingId] = useState('');
  const [level, setLevel] = useState(2);
  const [title, setTitle] = useState('');
  const [noteIds, setNoteIds] = useState<string[]>([]);
  const [plan, setPlan] = useState<NoteRefactorPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const headings = source ? parseOutline(source.markdown) : [];
  const otherNotes = workspace.notes.filter((note) => note.id !== source?.id);

  useEffect(() => {
    if (!action) return;
    const timer = window.setTimeout(() => {
      setKind(action); setTargetId(''); setHeadingId(''); setTitle(''); setNoteIds([]); setPlan(null); setError(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [action, source?.id]);
  const change = (update: () => void) => { update(); setPlan(null); setError(null); };
  const request = (): NoteRefactorRequest => {
    if (!source) throw new Error('Open a note first.');
    if (kind === 'merge') return { kind, sourceId: source.id, targetId };
    if (kind === 'split') return { kind, sourceId: source.id, level };
    if (kind === 'extract-heading' || kind === 'duplicate-heading') return { kind, sourceId: source.id, headingId };
    if (kind === 'move-heading') return { kind, sourceId: source.id, headingId, targetId };
    if (kind === 'moc') return { kind, sourceId: source.id, title, noteIds };
    if (!selection || !selection.text) throw new Error('Select Markdown in Source mode before opening this command.');
    if (kind === 'extract-selection') return { kind, sourceId: source.id, from: selection.from, to: selection.to, title };
    return { kind: 'canvas-selection', sourceId: source.id, from: selection.from, to: selection.to, title };
  };
  const preview = async () => {
    if (!workspace.repository || !workspace.activeVault || !source) return;
    setBusy(true); setError(null); setPlan(null);
    try {
      await workspace.flushPending();
      const tree = await workspace.repository.listTree(workspace.activeVault.id);
      const notes = (await Promise.all(tree.notes.map((entry) => workspace.repository!.getNote(entry.id)))).filter((note): note is VaultNote => Boolean(note));
      const current = notes.find((note) => note.id === source.id);
      if (!current) throw new Error('Source note is unavailable.');
      if ((kind === 'extract-selection' || kind === 'canvas-selection') && (!selection || current.markdown.slice(selection.from, selection.to) !== selection.text)) throw new Error('The selection changed. Select the text again and reopen the composer.');
      setPlan(planNoteRefactor(notes, request(), [...tree.attachments.map((item) => item.path), ...tree.folders.map((item) => item.path)]));
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not prepare the preview.'); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    if (!plan || !workspace.repository || !workspace.activeVault || !source) return;
    setBusy(true); setError(null);
    try {
      await workspace.flushPending();
      if (plan.canvas) {
        const latest = await workspace.repository.getNote(source.id);
        const expected = plan.expectedRevisions.find((item) => item.id === source.id);
        if (!latest || latest.revision !== expected?.revision) throw new Error('The source note changed after the preview. Preview again.');
        let document = newCanvasDocument();
        for (const [index, markdown] of plan.canvas.cards.entries()) {
          document = appendCanvasNode(document, createCanvasNode('text', (index % 3) * 360, Math.floor(index / 3) * 270, { text: markdown }));
        }
        const canvas = await new CanvasesStore(workspace.repository, workspace.activeVault.id).create(plan.canvas.title, document);
        onClose(); onOpenCanvas(canvas.id);
      } else {
        const result = await workspace.repository.applyNoteRefactor(workspace.activeVault.id, plan);
        await workspace.refreshActive();
        const openId = result.created[0]?.id ?? source.id;
        onClose(); onOpenNote(openId);
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not apply the refactor.'); setPlan(null); }
    finally { setBusy(false); }
  };
  return <Dialog open={action !== null} onOpenChange={(open) => { if (!open) onClose(); }} title="Note composer" description="Preview every change before applying it to your local vault." contentClassName={styles.dialog}>
    <div className={styles.form}>
      <label>Action<select value={kind} onChange={(event) => change(() => setKind(event.target.value as Kind))}>{actions.map((item) => <option key={item.kind} value={item.kind}>{item.name}</option>)}</select></label>
      <p className={styles.source}>Source: {source?.path ?? 'No note selected'}</p>
      {(kind === 'merge' || kind === 'move-heading') && <label>Destination note<select value={targetId} onChange={(event) => change(() => setTargetId(event.target.value))}><option value="">Choose a note</option>{otherNotes.map((note) => <option key={note.id} value={note.id}>{note.path}</option>)}</select></label>}
      {(kind === 'extract-heading' || kind === 'move-heading' || kind === 'duplicate-heading') && <label>Heading<select value={headingId} onChange={(event) => change(() => setHeadingId(event.target.value))}><option value="">Choose a heading</option>{headings.map((heading) => <option key={`${heading.id}:${heading.offset}`} value={heading.id}>{' '.repeat(heading.level - 1)}{heading.text}</option>)}</select></label>}
      {kind === 'split' && <label>Heading level<select value={level} onChange={(event) => change(() => setLevel(Number(event.target.value)))}>{[1, 2, 3, 4, 5, 6].map((value) => <option key={value} value={value}>H{value}</option>)}</select></label>}
      {(kind === 'extract-selection' || kind === 'moc' || kind === 'canvas-selection') && <label>{kind === 'canvas-selection' ? 'Canvas name' : 'New note title'}<input value={title} maxLength={200} onChange={(event) => change(() => setTitle(event.target.value))} placeholder={kind === 'moc' ? 'Index' : kind === 'canvas-selection' ? 'Ideas Canvas' : 'Extracted note'} /></label>}
      {(kind === 'extract-selection' || kind === 'canvas-selection') && <p className={styles.source}>{selection?.text ? `${selection.text.length} selected characters` : 'Select Markdown in Source mode, then reopen this command.'}</p>}
      {kind === 'moc' && <fieldset className={styles.choices}><legend>Notes to include</legend>{workspace.notes.map((note) => <label key={note.id}><input type="checkbox" checked={noteIds.includes(note.id)} onChange={(event) => change(() => setNoteIds((current) => event.target.checked ? [...current, note.id] : current.filter((id) => id !== note.id)))} />{note.path}</label>)}</fieldset>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {plan && <div className={styles.preview} aria-label="Refactor preview"><h3>{plan.summary}</h3>{plan.warnings.length > 0 && <section className={styles.warnings}><strong>Review before applying</strong><ul>{plan.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></section>}{plan.creates.map((item) => <details key={item.id} open><summary>Create {item.path}</summary><pre>{item.markdown}</pre></details>)}{plan.edits.map((item) => <details key={item.noteId}><summary>Modify {item.path}</summary><div className={styles.diff}><div><strong>Before</strong><pre>{item.before}</pre></div><div><strong>After</strong><pre>{item.after}</pre></div></div></details>)}{plan.canvas && <details open><summary>Create Canvas with {plan.canvas.cards.length} cards</summary>{plan.canvas.cards.map((card, index) => <pre key={index}>{card}</pre>)}</details>}</div>}
      <div className={styles.actions}><button type="button" onClick={onClose}>Cancel</button><button type="button" disabled={busy} onClick={() => { void preview(); }}>{busy ? 'Working…' : plan ? 'Refresh preview' : 'Preview changes'}</button>{plan && <button type="button" disabled={busy} onClick={() => { void apply(); }}>Apply changes</button>}</div>
    </div>
  </Dialog>;
}
