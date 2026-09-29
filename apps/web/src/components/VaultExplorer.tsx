'use client';

import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger, Dialog, Button } from '@noor-note/ui';
import { AudioLines, ChevronDown, ChevronRight, Download, File, FilePlus2, FileText, Folder, FolderOpen, FolderPlus, Plus, ScanText, Trash2, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type DragEvent } from 'react';
import { isPdfAttachment, type Attachment, type Folder as VaultFolder, type RenameChange } from '@noor-note/core';
import type { NoteEntry } from '@noor-note/storage';
import type { useVaultWorkspace } from '../hooks/useVaultWorkspace';
import { collectDroppedFiles } from '../lib/drop-files';
import { isOcrImage } from '../lib/ocr-source';
import { isTranscribable } from '../lib/transcript-store';
import styles from './VaultExplorer.module.css';

type WorkspaceState = ReturnType<typeof useVaultWorkspace>;
type Item = { key: string; id: string; kind: 'folder' | 'note' | 'attachment'; label: string; path: string; depth: number; parentId: string | null };
type Action = { kind: 'new-vault' | 'new-folder' | 'rename' | 'move' | 'delete'; items: Item[] } | null;

function ordered<T extends { name?: string; title?: string; updatedAt: string }>(items: T[], sortBy: 'name' | 'updatedAt', direction: 'asc' | 'desc'): T[] {
  const factor = direction === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => factor * (sortBy === 'name' ? (a.name ?? a.title ?? '').localeCompare(b.name ?? b.title ?? '') : a.updatedAt.localeCompare(b.updatedAt)));
}

function firstRenameDifference(change: RenameChange): { before: string; after: string } {
  const previous = change.before.split('\n');
  const next = change.after.split('\n');
  const index = previous.findIndex((line, position) => line !== next[position]);
  return { before: (previous[index] ?? '').slice(0, 180), after: (next[index] ?? '').slice(0, 180) };
}

export function flattenVaultTree(folders: VaultFolder[], notes: NoteEntry[], attachments: Attachment[], expanded: ReadonlySet<string>, sortBy: 'name' | 'updatedAt' = 'name', direction: 'asc' | 'desc' = 'asc'): Item[] {
  const rows: Item[] = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const folder of ordered(folders.filter((item) => item.parentId === parentId), sortBy, direction)) {
      rows.push({ key: `folder:${folder.id}`, id: folder.id, kind: 'folder', label: folder.name, path: folder.path, depth, parentId });
      if (expanded.has(folder.id)) visit(folder.id, depth + 1);
    }
    for (const note of ordered(notes.filter((item) => item.folderId === parentId), sortBy, direction)) rows.push({ key: `note:${note.id}`, id: note.id, kind: 'note', label: note.title || 'Untitled note', path: note.path, depth, parentId });
    for (const attachment of ordered(attachments.filter((item) => item.folderId === parentId), sortBy, direction)) rows.push({ key: `attachment:${attachment.id}`, id: attachment.id, kind: 'attachment', label: attachment.name, path: attachment.path, depth, parentId });
  };
  visit(null, 0);
  return rows;
}

interface VaultExplorerProps {
  workspace: WorkspaceState;
  focusFolder?: { id: string; token: string } | null;
  onSelectNote: (id: string) => void;
  onCreateNote: (folderId?: string | null) => void;
  onOpenTrash: () => void;
  onOpenPdf: (id: string) => void;
  onOpenOcr: (id?: string) => void;
  onOpenTranscript: (id?: string) => void;
  onImported: (count: number) => void;
}

export function VaultExplorer({ workspace, focusFolder, onSelectNote, onCreateNote, onOpenTrash, onOpenPdf, onOpenOcr, onOpenTranscript, onImported }: VaultExplorerProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [action, setAction] = useState<Action>(null);
  const [name, setName] = useState('');
  const [renameMode, setRenameMode] = useState<'keep' | 'update'>('keep');
  const [renamePreview, setRenamePreview] = useState<{ name: string; expectedRevision: number; expectedRevisions: { id: string; revision: number }[]; changes: RenameChange[] } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);
  const [targetFolderId, setTargetFolderId] = useState('root');
  const folderPickerRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const knownFolders = useRef(new Set<string>());
  const sortBy = workspace.activeVault?.settings.sortBy ?? 'name';
  const sortDirection = workspace.activeVault?.settings.sortDirection ?? 'asc';
  const rows = useMemo(() => flattenVaultTree(workspace.folders, workspace.notes, workspace.attachments, expanded, sortBy, sortDirection), [workspace.folders, workspace.notes, workspace.attachments, expanded, sortBy, sortDirection]);

  useEffect(() => {
    const current = new Set(workspace.folders.map((folder) => folder.id));
    const added = [...current].filter((id) => !knownFolders.current.has(id));
    knownFolders.current = current;
    if (added.length) setExpanded((previous) => new Set([...previous, ...added]));
  }, [workspace.folders]);

  useEffect(() => {
    if (!focusFolder) return;
    const target = workspace.folders.find((folder) => folder.id === focusFolder.id);
    if (!target) return;
    const timer = window.setTimeout(() => {
      const ancestors = workspace.folders.filter((folder) => target.path.startsWith(`${folder.path}/`) || folder.id === target.id);
      setExpanded((current) => new Set([...current, ...ancestors.map((folder) => folder.id)]));
      setSelected(new Set([`folder:${target.id}`]));
      setFocusedKey(`folder:${target.id}`);
      window.requestAnimationFrame(() => rowRefs.current.get(`folder:${target.id}`)?.focus());
    }, 0);
    return () => window.clearTimeout(timer);
  }, [focusFolder, workspace.folders]);

  const itemsFor = (item: Item) => selected.has(item.key) ? rows.filter((row) => selected.has(row.key)) : [item];
  const topLevel = (items: Item[]) => items.filter((item) => !items.some((other) => other.kind === 'folder' && other.id !== item.id && item.path.startsWith(`${other.path}/`)));
  const focusRow = (key: string) => { setFocusedKey(key); window.requestAnimationFrame(() => rowRefs.current.get(key)?.focus()); };
  const toggle = (id: string) => setExpanded((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  const openAttachment = async (id: string) => {
    if (workspace.attachments.some((item) => item.id === id && isPdfAttachment(item))) { onOpenPdf(id); return; }
    if (workspace.attachments.some((item) => item.id === id && isOcrImage(item))) { onOpenOcr(id); return; }
    if (workspace.attachments.some((item) => item.id === id && isTranscribable(item))) { onOpenTranscript(id); return; }
    const blob = await workspace.repository?.getAttachmentBlob(id);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener,noreferrer');
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const activate = (item: Item, event: MouseEvent<HTMLButtonElement>) => {
    setFocusedKey(item.key);
    if (event.shiftKey) {
      const from = rows.findIndex((row) => row.key === focusedKey);
      const to = rows.findIndex((row) => row.key === item.key);
      if (from >= 0 && to >= 0) setSelected(new Set(rows.slice(Math.min(from, to), Math.max(from, to) + 1).map((row) => row.key)));
      return;
    }
    if (event.metaKey || event.ctrlKey) { setSelected((current) => { const next = new Set(current); if (next.has(item.key)) next.delete(item.key); else next.add(item.key); return next; }); return; }
    setSelected(new Set([item.key]));
    if (item.kind === 'folder') { workspace.setSelectedFolderId(item.id); toggle(item.id); }
    if (item.kind === 'note') onSelectNote(item.id);
    if (item.kind === 'attachment') void openAttachment(item.id);
  };

  const onTreeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = rows.findIndex((row) => row.key === focusedKey);
    const current = rows[index];
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); setSelected(new Set(rows.map((row) => row.key))); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const next = rows[Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]; if (next) { if (event.shiftKey) setSelected((currentSelection) => new Set([...currentSelection, next.key])); focusRow(next.key); } }
    if (event.key === 'Home' && rows[0]) { event.preventDefault(); focusRow(rows[0].key); }
    if (event.key === 'End' && rows.at(-1)) { event.preventDefault(); focusRow(rows.at(-1)!.key); }
    if (event.key === 'ArrowRight' && current?.kind === 'folder') { event.preventDefault(); if (!expanded.has(current.id)) toggle(current.id); else if (rows[index + 1]?.depth === current.depth + 1) focusRow(rows[index + 1]!.key); }
    if (event.key === 'ArrowLeft' && current) { event.preventDefault(); if (current.kind === 'folder' && expanded.has(current.id)) toggle(current.id); else if (current.parentId) focusRow(`folder:${current.parentId}`); }
    if ((event.key === 'Enter' || event.key === ' ') && current) { event.preventDefault(); setSelected(new Set([current.key])); if (current.kind === 'folder') toggle(current.id); else if (current.kind === 'note') onSelectNote(current.id); else void openAttachment(current.id); }
    if (event.key === 'F2' && current) { event.preventDefault(); startAction('rename', [current]); }
    if (event.key === 'Delete' && current) { event.preventDefault(); startAction('delete', itemsFor(current)); }
  };

  const startAction = (kind: NonNullable<Action>['kind'], items: Item[] = []) => {
    setAction({ kind, items: topLevel(items) });
    setName(kind === 'rename' ? items[0]?.label ?? '' : '');
    setRenameMode('keep');
    setRenamePreview(null);
    setRenameError(null);
    setTargetFolderId('root');
  };

  const moveItems = async (items: Item[], folderId: string | null) => {
    for (const item of topLevel(items)) {
      if (item.kind === 'folder') await workspace.moveFolder(item.id, folderId);
      if (item.kind === 'note') await workspace.moveNote(item.id, folderId);
      if (item.kind === 'attachment') await workspace.moveAttachment(item.id, folderId);
    }
    setSelected(new Set());
  };

  const performAction = async () => {
    if (!action) return;
    if (action.kind === 'new-vault') await workspace.createVault(name);
    if (action.kind === 'new-folder') await workspace.createFolder(workspace.selectedFolderId, name);
    if (action.kind === 'rename') {
      const item = action.items[0];
      if (item?.kind === 'folder') await workspace.renameFolder(item.id, name);
      if (item?.kind === 'note') {
        if (renameMode === 'update') {
          if (!renamePreview || renamePreview.name !== name.trim()) {
            if (['[', ']', '|', '#', '^', '\r', '\n'].some((character) => name.includes(character))) { setRenameError('Use a title without [ ] | # or ^ to update wiki link targets.'); return; }
            setRenameError(null);
            setPreviewLoading(true);
            const preview = await workspace.previewNoteRename(item.id, name);
            setPreviewLoading(false);
            if (preview) setRenamePreview({ ...preview, name: name.trim() });
            return;
          }
          const result = await workspace.renameNoteWithLinks(item.id, name, renamePreview.expectedRevision, renamePreview.changes, renamePreview.expectedRevisions);
          if (!result) { setRenamePreview(null); return; }
        } else if (!await workspace.renameNote(item.id, name)) return;
      }
      if (item?.kind === 'attachment') await workspace.renameAttachment(item.id, name);
    }
    if (action.kind === 'move') await moveItems(action.items, targetFolderId === 'root' ? null : targetFolderId);
    if (action.kind === 'delete') {
      for (const item of action.items) {
        if (item.kind === 'folder') await workspace.deleteFolder(item.id);
        if (item.kind === 'note') await workspace.removeNote(item.id);
        if (item.kind === 'attachment') await workspace.deleteAttachment(item.id);
      }
      setSelected(new Set());
    }
    setAction(null);
  };

  const handleDrop = async (event: DragEvent, folderId: string | null) => {
    event.preventDefault();
    setDropError(null);
    try {
      const own = event.dataTransfer.getData('application/x-noor-note-items');
      if (own) {
        const keys: unknown = JSON.parse(own);
        if (!Array.isArray(keys) || !keys.every((key) => typeof key === 'string')) throw new Error('Invalid dragged items');
        await moveItems(rows.filter((row) => keys.includes(row.key)), folderId);
        return;
      }
      const files = await collectDroppedFiles(event.dataTransfer);
      if (files.length) onImported(await workspace.importFiles(files, folderId));
    } catch {
      setDropError('Could not read the dropped files. Try the import button instead.');
    }
  };

  return <section className={styles.explorer} aria-label="Vault file explorer">
    <div className={styles.vaultRow}>
      <label className="sr-only" htmlFor="vault-picker">Active vault</label>
      <select id="vault-picker" value={workspace.activeVault?.id ?? ''} onChange={(event) => { void workspace.switchVault(event.target.value); setSelected(new Set()); }}>
        {workspace.vaults.map((vault) => <option key={vault.id} value={vault.id}>{vault.name}</option>)}
      </select>
      <button type="button" aria-label="Create vault" title="Create vault" onClick={() => startAction('new-vault')}><Plus size={16} /></button>
    </div>
    <div className={styles.tools}>
      <button type="button" title="New note" aria-label="New note in selected folder" onClick={() => onCreateNote()}><FilePlus2 size={17} /></button>
      <button type="button" title="New folder" aria-label="New folder" onClick={() => startAction('new-folder')}><FolderPlus size={17} /></button>
      <button type="button" title="Import folder" aria-label="Import folder" onClick={() => folderPickerRef.current?.click()}><Upload size={17} /></button>
      <button type="button" title="Upload image for OCR" aria-label="Open image OCR" onClick={() => onOpenOcr()}><ScanText size={17} /></button>
      <button type="button" title="Upload audio or video for transcription" aria-label="Open transcription" onClick={() => onOpenTranscript()}><AudioLines size={17} /></button>
      <button type="button" title="Trash" aria-label="Open Trash" onClick={onOpenTrash}><Trash2 size={17} /></button>
      <label className="sr-only" htmlFor="vault-sort">Sort files</label>
      <select id="vault-sort" value={`${sortBy}:${sortDirection}`} onChange={(event) => { const [by, direction] = event.target.value.split(':'); void workspace.updateVaultSettings({ sortBy: by === 'updatedAt' ? 'updatedAt' : 'name', sortDirection: direction === 'desc' ? 'desc' : 'asc' }); }}>
        <option value="name:asc">Name A–Z</option><option value="name:desc">Name Z–A</option><option value="updatedAt:desc">Recently edited</option><option value="updatedAt:asc">Oldest edited</option>
      </select>
      <input ref={(node) => { folderPickerRef.current = node; node?.setAttribute('webkitdirectory', ''); }} className="sr-only" tabIndex={-1} type="file" multiple aria-label="Import folder files" onChange={(event) => { if (event.target.files) void workspace.importFiles(event.target.files).then(onImported); event.target.value = ''; }} />
    </div>
    <div className={styles.root} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { void handleDrop(event, null); }}>
      <button type="button" className={workspace.selectedFolderId === null ? styles.rootSelected : ''} onClick={() => workspace.setSelectedFolderId(null)}><FolderOpen size={16} /> Vault root</button>
    </div>
    {dropError && <p role="alert" className={styles.empty}>{dropError}</p>}
    <div className={styles.tree} role="tree" aria-label="Vault files" onKeyDown={onTreeKeyDown}>
      {rows.map((item) => <ContextMenu key={item.key}>
        <ContextMenuTrigger asChild>
          <button ref={(node) => { if (node) rowRefs.current.set(item.key, node); else rowRefs.current.delete(item.key); }} type="button" role="treeitem" aria-level={item.depth + 1} aria-selected={selected.has(item.key)} aria-expanded={item.kind === 'folder' ? expanded.has(item.id) : undefined}
            tabIndex={focusedKey === item.key || (!focusedKey && rows[0]?.key === item.key) ? 0 : -1} className={`${styles.row} ${selected.has(item.key) ? styles.selected : ''}`} style={{ paddingLeft: 10 + item.depth * 14 }}
            onFocus={() => setFocusedKey(item.key)} onClick={(event) => activate(item, event)} onContextMenu={() => { if (!selected.has(item.key)) setSelected(new Set([item.key])); }} draggable
            onDragStart={(event) => { const keys = selected.has(item.key) ? [...selected] : [item.key]; event.dataTransfer.setData('application/x-noor-note-items', JSON.stringify(keys)); event.dataTransfer.effectAllowed = 'move'; }}
            onDragOver={item.kind === 'folder' ? (event) => event.preventDefault() : undefined} onDrop={item.kind === 'folder' ? (event) => { void handleDrop(event, item.id); } : undefined}>
            {item.kind === 'folder' ? expanded.has(item.id) ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : <span className={styles.spacer} />}
            {item.kind === 'folder' ? <Folder size={16} /> : item.kind === 'note' ? <FileText size={16} /> : <File size={16} />}
            <span title={item.path}>{item.label}</span>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {item.kind === 'folder' && <><ContextMenuItem onSelect={() => { workspace.setSelectedFolderId(item.id); onCreateNote(item.id); }}><FilePlus2 size={15} /> New note here</ContextMenuItem><ContextMenuItem onSelect={() => { workspace.setSelectedFolderId(item.id); startAction('new-folder'); }}><FolderPlus size={15} /> New folder here</ContextMenuItem><ContextMenuItem onSelect={() => { void workspace.exportZip(item.path); }}><Download size={15} /> Export folder ZIP</ContextMenuItem></>}
          {item.kind === 'note' && <ContextMenuItem onSelect={() => { void workspace.duplicateNote(item.id); }}><FilePlus2 size={15} /> Duplicate</ContextMenuItem>}
          {item.kind === 'attachment' && workspace.attachments.some((attachment) => attachment.id === item.id && (isOcrImage(attachment) || isPdfAttachment(attachment))) && <ContextMenuItem onSelect={() => onOpenOcr(item.id)}><ScanText size={15} /> Extract text with OCR</ContextMenuItem>}
          {item.kind === 'attachment' && workspace.attachments.some((attachment) => attachment.id === item.id && isTranscribable(attachment)) && <ContextMenuItem onSelect={() => onOpenTranscript(item.id)}><AudioLines size={15} /> Transcribe media</ContextMenuItem>}
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => startAction('rename', [item])}>Rename</ContextMenuItem>
          <ContextMenuItem onSelect={() => startAction('move', itemsFor(item))}>Move…</ContextMenuItem>
          <ContextMenuItem onSelect={() => startAction('delete', itemsFor(item))}><Trash2 size={15} /> Move to Trash</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>)}
      {!rows.length && <p className={styles.empty}>Drop Markdown or files here, or create a note.</p>}
    </div>
    <Dialog open={Boolean(action)} onOpenChange={(open) => { if (!open) setAction(null); }} title={action?.kind === 'new-vault' ? 'Create vault' : action?.kind === 'new-folder' ? 'Create folder' : action?.kind === 'rename' ? 'Rename item' : action?.kind === 'move' ? 'Move items' : 'Move to Trash'} description={action?.kind === 'delete' ? `${action.items.length} selected item${action.items.length === 1 ? '' : 's'} can be restored from Trash.` : undefined}>
      {action && <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void performAction(); }}>
        {(action.kind === 'new-vault' || action.kind === 'new-folder' || action.kind === 'rename') && <><label htmlFor="vault-action-name">Name</label><input id="vault-action-name" autoFocus required maxLength={200} value={name} onChange={(event) => { setName(event.target.value); setRenamePreview(null); setRenameError(null); }} /></>}
        {renameError && <p role="alert" className={styles.renameError}>{renameError}</p>}
        {action.kind === 'rename' && action.items[0]?.kind === 'note' && <fieldset className={styles.renameOptions}><legend>Existing links</legend><label><input type="radio" name="rename-links" checked={renameMode === 'keep'} onChange={() => { setRenameMode('keep'); setRenamePreview(null); }} /> Keep readable links</label><label><input type="radio" name="rename-links" checked={renameMode === 'update'} onChange={() => { setRenameMode('update'); setRenamePreview(null); }} /> Update readable links throughout vault</label><small>Old note titles remain aliases so existing links can still resolve.</small></fieldset>}
        {renamePreview && renameMode === 'update' && <div className={styles.renamePreview}><strong>{renamePreview.changes.reduce((total, change) => total + change.count, 0)} links in {renamePreview.changes.length} files will change</strong><ul>{renamePreview.changes.map((change) => { const diff = firstRenameDifference(change); return <li key={change.noteId}><strong>{change.path}</strong> · {change.count} {change.count === 1 ? 'link' : 'links'}<del>{diff.before}</del><ins>{diff.after}</ins></li>; })}</ul><p>Confirm to rename the note and apply these edits together.</p></div>}
        {action.kind === 'move' && <><label htmlFor="vault-action-destination">Destination</label><select id="vault-action-destination" value={targetFolderId} onChange={(event) => setTargetFolderId(event.target.value)}><option value="root">Vault root</option>{workspace.folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.path}</option>)}</select></>}
        <div className={styles.formActions}><Button type="button" variant="secondary" onClick={() => setAction(null)}>Cancel</Button><Button type="submit" disabled={previewLoading} variant={action.kind === 'delete' ? 'danger' : 'primary'}>{previewLoading ? 'Checking links…' : action.kind === 'delete' ? 'Move to Trash' : action.kind === 'move' ? 'Move' : action.kind === 'rename' && renameMode === 'update' ? renamePreview ? 'Confirm rename and update' : 'Preview affected files' : action.kind === 'rename' ? 'Rename' : 'Create'}</Button></div>
      </form>}
    </Dialog>
  </section>;
}
