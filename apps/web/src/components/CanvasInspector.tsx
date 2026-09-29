'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { canvasNodeSchema, type Attachment, type CanvasEdge, type CanvasNode, type VaultNote } from '@noor-note/core';
import type { NoteEntry, VaultRepository } from '@noor-note/storage';
import { MarkdownReadingView } from './MarkdownReadingView';
import styles from './CanvasView.module.css';

interface Props {
  node: CanvasNode | null; edge: CanvasEdge | null; notes: NoteEntry[]; attachments: Attachment[]; repository: VaultRepository | null;
  onPatchNode: (id: string, patch: Partial<CanvasNode>) => void; onPatchEdge: (id: string, patch: Partial<CanvasEdge>) => void; onOpenNote: (id: string) => void;
}
const sides = ['auto', 'top', 'right', 'bottom', 'left'] as const;

export function CanvasInspector({ node, edge, notes, attachments, repository, onPatchNode, onPatchEdge, onOpenNote }: Props) {
  const [fullNote, setFullNote] = useState<VaultNote | null>(null);
  const [text, setText] = useState(node?.text ?? '');
  const [label, setLabel] = useState(node?.label ?? edge?.label ?? '');
  const [url, setUrl] = useState(node?.url ?? '');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (node?.kind !== 'note' || !node.noteId || !repository) return;
    let alive = true;
    void repository.getNote(node.noteId).then((value) => { if (alive) setFullNote(value ?? null); }).catch(() => { if (alive) setError('Could not load the linked note.'); });
    return () => { alive = false; };
  }, [node?.kind, node?.noteId, repository]);
  if (!node && !edge) return <aside className={styles.inspector}><h2>Canvas inspector</h2><p>Select a card or connector to edit it. Shift-click or drag a lasso to select several cards.</p></aside>;
  const save = (event: FormEvent) => {
    event.preventDefault(); setError(null);
    try {
      if (node) {
        const patch: Partial<CanvasNode> = { label: label.trim() };
        if (node.kind === 'text') patch.text = text;
        if (node.kind === 'url') patch.url = url.trim() || null;
        canvasNodeSchema.parse({ ...node, ...patch });
        onPatchNode(node.id, patch);
      }
      if (edge) onPatchEdge(edge.id, { label: label.trim() });
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save this card.'); }
  };
  const numberField = (name: string, value: number, key: 'x' | 'y' | 'width' | 'height') => <label>{name}<input type="number" value={Math.round(value)} onChange={(event) => { const next = Number(event.target.value); if (Number.isFinite(next) && (key === 'x' || key === 'y' || next >= 40)) onPatchNode(node!.id, { [key]: next }); }} /></label>;
  return <aside className={styles.inspector} aria-label="Canvas inspector">
    <h2>{node ? `${node.kind[0]!.toUpperCase()}${node.kind.slice(1)} card` : 'Connector'}</h2>
    <form onSubmit={save} className={styles.inspectorForm}>
      {(node?.kind === 'group' || node?.kind === 'frame' || node?.kind === 'url' || edge) && <label>Label<input maxLength={500} value={label} onChange={(event) => setLabel(event.target.value)} /></label>}
      {node?.kind === 'text' && <label>Markdown<textarea value={text} maxLength={100_000} onChange={(event) => setText(event.target.value)} rows={10} /></label>}
      {node?.kind === 'url' && <label>Website URL<input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.org" /></label>}
      {node && <div className={styles.geometry}>{numberField('X', node.x, 'x')}{numberField('Y', node.y, 'y')}{numberField('Width', node.width, 'width')}{numberField('Height', node.height, 'height')}</div>}
      {node && <label>Color<select value={node.color ?? ''} onChange={(event) => onPatchNode(node.id, { color: event.target.value || null })}><option value="">Default</option>{[1, 2, 3, 4, 5, 6].map((value) => <option key={value} value={String(value)}>Color {value}</option>)}</select></label>}
      {edge && <div className={styles.geometry}><label>From side<select value={edge.fromSide} onChange={(event) => onPatchEdge(edge.id, { fromSide: event.target.value as CanvasEdge['fromSide'] })}>{sides.map((side) => <option key={side}>{side}</option>)}</select></label><label>To side<select value={edge.toSide} onChange={(event) => onPatchEdge(edge.id, { toSide: event.target.value as CanvasEdge['toSide'] })}>{sides.map((side) => <option key={side}>{side}</option>)}</select></label><label>Start end<select value={edge.fromEnd} onChange={(event) => onPatchEdge(edge.id, { fromEnd: event.target.value as CanvasEdge['fromEnd'] })}><option value="none">Line</option><option value="arrow">Arrow</option></select></label><label>Finish end<select value={edge.toEnd} onChange={(event) => onPatchEdge(edge.id, { toEnd: event.target.value as CanvasEdge['toEnd'] })}><option value="none">Line</option><option value="arrow">Arrow</option></select></label></div>}
      {(node?.kind === 'text' || node?.kind === 'group' || node?.kind === 'frame' || node?.kind === 'url' || edge) && <button type="submit">Save changes</button>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </form>
    {node?.kind === 'note' && <div className={styles.noteInspector}>{fullNote ? <><button type="button" onClick={() => onOpenNote(fullNote.id)}>Edit note</button><div className={styles.notePreview}><MarkdownReadingView note={fullNote} notes={notes} attachments={attachments} repository={repository} onOpenNote={(id) => onOpenNote(id)} /></div></> : <p>Linked note is unavailable.</p>}</div>}
    {node && ['image', 'pdf', 'audio', 'video', 'attachment'].includes(node.kind) && <div className={styles.fileInspector}><p>{attachments.find((item) => item.id === node.attachmentId)?.path ?? node.filePath ?? 'Attachment unavailable'}</p></div>}
  </aside>;
}
