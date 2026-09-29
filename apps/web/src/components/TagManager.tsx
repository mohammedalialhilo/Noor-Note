'use client';

import { normalizeTagName, type TagChange, type TagNode, type VaultNote } from '@noor-note/core';
import { Button, Dialog } from '@noor-note/ui';
import { ChevronRight, Tags } from 'lucide-react';
import { useState } from 'react';
import styles from './TagManager.module.css';

interface Props {
  tree: TagNode[];
  noteCount: number;
  onFilter: (tag: string) => void;
  onPreview: (from: string, to: string | null, includeChildren: boolean) => Promise<{ changes: TagChange[]; expectedRevisions: { id: string; revision: number }[] } | undefined>;
  onApply: (changes: TagChange[], expectedRevisions: { id: string; revision: number }[]) => Promise<VaultNote[] | undefined>;
}
type Action = 'rename' | 'merge' | 'delete';

export function TagManager({ tree, noteCount, onFilter, onPreview, onApply }: Props) {
  const [action, setAction] = useState<{ kind: Action; tag: string } | null>(null);
  const [target, setTarget] = useState('');
  const [includeChildren, setIncludeChildren] = useState(true);
  const [preview, setPreview] = useState<{ target: string | null; changes: TagChange[]; expectedRevisions: { id: string; revision: number }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const open = (kind: Action, tag: string) => { setAction({ kind, tag }); setTarget(kind === 'rename' ? tag : ''); setIncludeChildren(true); setPreview(null); setError(null); };
  const submit = async () => {
    if (!action) return;
    try {
      const destination = action.kind === 'delete' ? null : normalizeTagName(target);
      if (destination?.toLocaleLowerCase() === action.tag.toLocaleLowerCase()) throw new Error('Choose a different tag name');
      setBusy(true);
      if (!preview || preview.target !== destination) {
        const result = await onPreview(action.tag, destination, includeChildren);
        if (!result) throw new Error('Could not preview tag changes');
        setPreview({ ...result, target: destination });
      } else {
        const saved = await onApply(preview.changes, preview.expectedRevisions);
        if (!saved) throw new Error('The vault changed or could not be updated. Preview again.');
        setAction(null); setPreview(null);
      }
      setError(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not update tags'); setPreview(null); }
    finally { setBusy(false); }
  };
  const renderNodes = (nodes: TagNode[], depth: number): React.ReactNode => <ul>{nodes.map((node) => <li key={node.fullName}><div className={styles.tagRow} style={{ paddingLeft: depth * 14 }}><button type="button" className={styles.tagName} onClick={() => onFilter(node.fullName)}><span># {node.name}</span><small>{node.count}</small><ChevronRight size={14} /></button><button type="button" className={styles.manage} aria-label={`Manage ${node.fullName}`} onClick={() => open('rename', node.fullName)}>Manage</button></div>{node.children.length > 0 && renderNodes(node.children, depth + 1)}</li>)}</ul>;
  const selectedNode = (nodes: TagNode[], key: string): TagNode | undefined => {
    for (const node of nodes) { if (node.fullName === key) return node; const child = selectedNode(node.children, key); if (child) return child; }
    return undefined;
  };
  return <div className={styles.layout}>
    <aside className={styles.sidebar} aria-label="Tag sidebar"><h2><Tags size={18} /> Tags</h2>{tree.length ? renderNodes(tree, 0) : <p>No tags yet. Add a hashtag in a note or add tags in its YAML properties.</p>}</aside>
    <div className={styles.content}><span className={styles.eyebrow}>FIND YOUR THREADS</span><h1>Tags</h1><p>Select a tag to find every note using it, including nested tags.</p><p>{noteCount} {noteCount === 1 ? 'note' : 'notes'} in this vault.</p>{tree.length > 0 && <p>Use Manage beside a tag to rename, merge, or remove its references.</p>}</div>
    <Dialog open={Boolean(action)} onOpenChange={(opened) => { if (!opened) { setAction(null); setPreview(null); } }} title={action ? `Manage #${action.tag}` : 'Manage tag'}>
      {action && <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <div className={styles.mode} role="group" aria-label="Tag operation">{(['rename', 'merge', 'delete'] as const).map((kind) => <button key={kind} type="button" aria-pressed={action.kind === kind} onClick={() => { setAction({ ...action, kind }); setTarget(kind === 'rename' ? action.tag : ''); setPreview(null); setError(null); }}>{kind === 'delete' ? 'Delete references' : kind === 'merge' ? 'Merge into' : 'Rename'}</button>)}</div>
        {action.kind !== 'delete' && <label>New tag name<input required autoFocus value={target} onChange={(event) => { setTarget(event.target.value); setPreview(null); }} placeholder="research/notes" /></label>}
        {Boolean(selectedNode(tree, action.tag)?.children.length) && <label className={styles.check}><input type="checkbox" checked={includeChildren} onChange={(event) => { setIncludeChildren(event.target.checked); setPreview(null); }} /> Include nested tags</label>}
        {error && <p role="alert" className={styles.error}>{error}</p>}
        {preview && <div className={styles.preview}><strong>{preview.changes.reduce((sum, item) => sum + item.count, 0)} {preview.changes.reduce((sum, item) => sum + item.count, 0) === 1 ? 'reference' : 'references'} in {preview.changes.length} {preview.changes.length === 1 ? 'note' : 'notes'}</strong><ul>{preview.changes.map((item) => <li key={item.noteId}>{item.path} · {item.count}</li>)}</ul><p>Confirm to update these Markdown files together.</p></div>}
        <div className={styles.actions}><Button type="button" variant="secondary" onClick={() => setAction(null)}>Cancel</Button><Button type="submit" disabled={busy} variant={action.kind === 'delete' ? 'danger' : 'primary'}>{busy ? 'Working…' : preview ? 'Confirm changes' : 'Preview affected notes'}</Button></div>
      </form>}
    </Dialog>
  </div>;
}
