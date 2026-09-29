'use client';

import { useState, type FormEvent } from 'react';
import { Copy, Download, Pencil, Save, Star, Trash2 } from 'lucide-react';
import { Dialog } from '@noor-note/ui';
import type { Workspace } from '@noor-note/core';
import styles from './WorkspaceManager.module.css';

interface Props {
  open: boolean; onOpenChange: (open: boolean) => void; workspaces: Workspace[]; activeId: string | null; startupId: string | null;
  onCreate: (name: string) => Promise<boolean>; onUpdate: (id: string) => Promise<boolean>; onLoad: (id: string) => Promise<boolean>;
  onDuplicate: (id: string) => Promise<boolean>; onRename: (id: string, name: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>; onStartup: (id: string | null) => void;
  widths: { navigationWidth: number; noteListWidth: number; inspectorWidth: number }; onWidthsChange: (widths: Props['widths']) => void; error: string | null;
}

export function WorkspaceManager({ open, onOpenChange, workspaces, activeId, startupId, onCreate, onUpdate, onLoad, onDuplicate, onRename, onDelete, onStartup, widths, onWidthsChange, error }: Props) {
  const [name, setName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const run = async (action: () => Promise<boolean>, success: string) => {
    setBusy(true); setMessage(null);
    try { setMessage(await action() ? success : 'The workspace could not be changed. Check the workspace error and try again.'); }
    catch (caught) { setMessage(caught instanceof Error ? caught.message : 'The workspace could not be changed.'); }
    finally { setBusy(false); }
  };
  const create = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => { const saved = await onCreate(name); if (saved) setName(''); return saved; }, 'Workspace saved.');
  };
  return <Dialog title="Workspaces" description="Save and restore this vault's tabs, panes, sidebars, and views." open={open} onOpenChange={onOpenChange} contentClassName={styles.dialog}>
    <fieldset className={styles.widths}><legend>Desktop panel widths</legend>{([['navigationWidth', 'Navigation', 180, 420], ['noteListWidth', 'Note list', 220, 600], ['inspectorWidth', 'Inspector', 180, 520]] as const).map(([key, label, min, max]) => <label key={key}>{label}<input type="range" min={min} max={max} value={widths[key]} onChange={(event) => onWidthsChange({ ...widths, [key]: Number(event.target.value) })} /><output>{widths[key]} px</output></label>)}</fieldset>
    <form className={styles.create} onSubmit={create}><label>New workspace name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={200} required placeholder="Research layout" /></label><button type="submit" disabled={busy}><Save size={15} /> Save current layout</button></form>
    {workspaces.length ? <div className={styles.list}>{workspaces.map((workspace) => <section key={workspace.id} className={styles.row}>
      <div className={styles.title}><strong>{workspace.name}</strong>{workspace.id === activeId && <span>Loaded</span>}{workspace.id === startupId && <span>Startup</span>}</div>
      {renamingId === workspace.id && <form className={styles.rename} onSubmit={(event) => { event.preventDefault(); void run(async () => { const saved = await onRename(workspace.id, renameValue); if (saved) setRenamingId(null); return saved; }, 'Workspace renamed.'); }}><input aria-label={`New name for ${workspace.name}`} value={renameValue} onChange={(event) => setRenameValue(event.target.value)} required maxLength={200} /><button type="submit" disabled={busy}>Save name</button><button type="button" onClick={() => setRenamingId(null)}>Cancel</button></form>}
      <div className={styles.actions}><button type="button" disabled={busy} onClick={() => { void run(async () => { const loaded = await onLoad(workspace.id); if (loaded) onOpenChange(false); return loaded; }, 'Workspace loaded.'); }}><Download size={14} /> Load</button><button type="button" disabled={busy} onClick={() => { void run(() => onUpdate(workspace.id), 'Current layout saved.'); }}><Save size={14} /> Update</button><button type="button" disabled={busy} onClick={() => { void run(() => onDuplicate(workspace.id), 'Workspace duplicated.'); }}><Copy size={14} /> Duplicate</button><button type="button" disabled={busy} onClick={() => { setRenameValue(workspace.name); setRenamingId(workspace.id); }}><Pencil size={14} /> Rename</button><button type="button" disabled={busy} onClick={() => { onStartup(startupId === workspace.id ? null : workspace.id); setMessage(startupId === workspace.id ? 'Startup workspace cleared.' : 'Startup workspace set.'); }}><Star size={14} /> {startupId === workspace.id ? 'Clear startup' : 'Set startup'}</button><button type="button" disabled={busy} className={styles.danger} onClick={() => { if (window.confirm(`Delete workspace “${workspace.name}”? Notes and resources remain in the vault.`)) void run(() => onDelete(workspace.id), 'Workspace deleted.'); }}><Trash2 size={14} /> Delete</button></div>
    </section>)}</div> : <p className={styles.empty}>No saved workspaces yet. Save the current layout to return to it later.</p>}
    {error && <p role="alert" className={styles.message}>{error}</p>}
    {message && <p role="status" className={styles.message}>{message}</p>}
  </Dialog>;
}
