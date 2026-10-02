'use client';

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { AlignStartHorizontal, Copy, Download, Grid3X3, Group, Link2, Menu, MousePointer2, Move, Plus, Presentation, Redo2, RotateCcw, Trash2, Undo2, Ungroup, Upload, X, ZoomIn, ZoomOut } from 'lucide-react';
import {
  alignCanvasNodes, appendCanvasNode, canvasDocumentSchema, connectCanvasNodes, copyCanvasSelection, createCanvasNode, deleteCanvasSelection, exportJsonCanvas, groupCanvasNodes, importJsonCanvas, layoutCanvasNodes, moveCanvasNodes, pasteCanvasSelection, readCanvasDocument, ungroupCanvasNode, updateCanvasEdge, updateCanvasNode, withCanvasDocument,
  type Canvas, type CanvasDocument, type CanvasLayout, type CanvasNodeKind,
} from '@noor-note/core';
import type { useVaultWorkspace } from '../hooks/useVaultWorkspace';
import { downloadText } from '../lib/workspace';
import { CanvasesStore } from '../lib/canvases';
import type { WorkspaceLayout } from '../lib/workspace-layout';
import { CanvasBoard } from './CanvasBoard';
import { CanvasInspector } from './CanvasInspector';
import { CanvasPresentation } from './CanvasPresentation';
import { SharedComments } from './SharedComments';
import type { VaultRole } from '../lib/sharing';
import styles from './CanvasView.module.css';

interface Props { workspace: ReturnType<typeof useVaultWorkspace>; onOpenNote: (id: string) => void; onOpenNavigation: (event: ReactMouseEvent<HTMLButtonElement>) => void; initialTabs?: WorkspaceLayout['canvasTabs']; onTabsChange?: (tabs: WorkspaceLayout['canvasTabs']) => void; sharedRole?: VaultRole | null; pluginTools?: { id: string; title: string; cardText: string }[] }
const kinds: { value: CanvasNodeKind; label: string }[] = [
  { value: 'text', label: 'Markdown text' }, { value: 'note', label: 'Note' }, { value: 'image', label: 'Image' }, { value: 'pdf', label: 'PDF' }, { value: 'audio', label: 'Audio' }, { value: 'video', label: 'Video' }, { value: 'url', label: 'Website' }, { value: 'attachment', label: 'Attachment' }, { value: 'group', label: 'Group' }, { value: 'frame', label: 'Frame' },
];
const mediaKinds = new Set<CanvasNodeKind>(['image', 'pdf', 'audio', 'video', 'attachment']);
const isEditableTarget = (target: EventTarget | null) => target instanceof HTMLElement && Boolean(target.closest('input,textarea,select,[contenteditable="true"]'));

export function CanvasView({ workspace, onOpenNote, onOpenNavigation, initialTabs, onTabsChange, sharedRole, pluginTools = [] }: Props) {
  const vaultId = workspace.activeVault?.id;
  const store = useMemo(() => workspace.repository && vaultId ? new CanvasesStore(workspace.repository, vaultId) : null, [workspace.repository, vaultId]);
  const [canvases, setCanvases] = useState<Canvas[]>([]);
  const canvasesRef = useRef<Canvas[]>([]);
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const history = useRef<{ past: CanvasDocument[]; future: CanvasDocument[] }>({ past: [], future: [] });
  const clipboard = useRef<CanvasDocument | null>(null);
  const pasteCount = useRef(0);
  const viewportTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingViewport = useRef<{ id: string; viewport: CanvasDocument['viewport'] } | null>(null);
  const viewportRef = useRef<CanvasDocument['viewport']>({ x: 0, y: 0, zoom: 1 });
  const stageRef = useRef<HTMLDivElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const [activeId, setActiveId] = useState<string | null>(initialTabs?.activeId ?? null);
  const [openIds, setOpenIds] = useState<string[]>(initialTabs?.ids ?? []);
  const initialActiveIdRef = useRef(initialTabs?.activeId);
  const onTabsChangeRef = useRef(onTabsChange);
  useEffect(() => { onTabsChangeRef.current = onTabsChange; }, [onTabsChange]);
  useEffect(() => { onTabsChangeRef.current?.({ ids: openIds, activeId }); }, [openIds, activeId]);
  const [viewport, setViewport] = useState<CanvasDocument['viewport']>({ x: 0, y: 0, zoom: 1 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [tool, setTool] = useState<'select' | 'pan'>('select');
  const [addKind, setAddKind] = useState<CanvasNodeKind>('text');
  const [sourceId, setSourceId] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [newName, setNewName] = useState('');
  const [layout, setLayout] = useState<CanvasLayout>('horizontal');
  const [alignment, setAlignment] = useState<'left' | 'right' | 'top' | 'bottom' | 'center-x' | 'center-y'>('left');
  const [showInspector, setShowInspector] = useState(true);
  const [showComments, setShowComments] = useState(false);
  const [present, setPresent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [canPaste, setCanPaste] = useState(false);

  useEffect(() => {
    if (!store) return;
    let live = true;
    void store.list().then((items) => { if (live) { canvasesRef.current = items; setCanvases(items); const available = items.filter((item) => !item.deletedAt); const selected = available.find((item) => item.id === initialActiveIdRef.current)?.id ?? available[0]?.id ?? null; setOpenIds((current) => { const valid = current.filter((id) => available.some((item) => item.id === id)); return selected && !valid.includes(selected) ? [...valid, selected] : valid; }); setActiveId(selected); } }).catch((caught: unknown) => { if (live) setError(caught instanceof Error ? caught.message : 'Could not load Canvases.'); });
    return () => { live = false; };
  }, [store]);
  const canvas = canvases.find((item) => item.id === activeId && !item.deletedAt) ?? null;
  const document = canvas ? readCanvasDocument(canvas) : null;
  const selectedNode = document && selected.size === 1 ? document.nodes.find((node) => selected.has(node.id)) ?? null : null;
  const edge = document?.edges.find((item) => item.id === selectedEdge) ?? null;
  useEffect(() => {
    const current = canvasesRef.current.find((item) => item.id === activeId);
    const next = current ? readCanvasDocument(current).viewport : { x: 0, y: 0, zoom: 1 };
    viewportRef.current = next; setViewport(next); setSelected(new Set()); setSelectedEdge(null);
    history.current = { past: [], future: [] };
    setCanUndo(false); setCanRedo(false);
  }, [activeId]);
  useEffect(() => () => { if (viewportTimer.current) clearTimeout(viewportTimer.current); const pending = pendingViewport.current; if (pending && store) { const current = canvasesRef.current.find((item) => item.id === pending.id); if (current) { const next = withCanvasDocument(current, { ...readCanvasDocument(current), viewport: pending.viewport }); void saveQueue.current.then(() => store.save(next, readCanvasDocument(next))); } } }, [store]);

  const replace = (updated: Canvas) => { const next = canvasesRef.current.map((item) => item.id === updated.id ? updated : item); canvasesRef.current = next; setCanvases(next); };
  const enqueue = (updated: Canvas) => {
    if (!store) return;
    setSaveStatus('saving');
    const operation = saveQueue.current.then(() => store.save(updated, readCanvasDocument(updated)));
    saveQueue.current = operation.then(() => { setSaveStatus('saved'); setError(null); }, (caught: unknown) => { setSaveStatus('error'); setError(caught instanceof Error ? caught.message : 'Could not save Canvas.'); });
  };
  const commit = (next: CanvasDocument, record = true) => {
    const current = canvasesRef.current.find((item) => item.id === activeId && !item.deletedAt);
    if (!current) return;
    const before = readCanvasDocument(current);
    const prepared = canvasDocumentSchema.parse({ ...next, viewport: viewportRef.current });
    if (JSON.stringify(before) === JSON.stringify(prepared)) return;
    if (record) { history.current.past = [...history.current.past.slice(-49), before]; history.current.future = []; setCanUndo(true); setCanRedo(false); }
    if (viewportTimer.current) clearTimeout(viewportTimer.current);
    viewportTimer.current = null; pendingViewport.current = null;
    const updated = withCanvasDocument(current, prepared);
    replace(updated); enqueue(updated);
  };
  const changeViewport = (next: CanvasDocument['viewport']) => {
    if (!activeId) return;
    const bounded = { x: Math.max(-10_000_000, Math.min(10_000_000, next.x)), y: Math.max(-10_000_000, Math.min(10_000_000, next.y)), zoom: Math.max(0.1, Math.min(4, next.zoom)) };
    viewportRef.current = bounded; setViewport(bounded);
    pendingViewport.current = { id: activeId, viewport: bounded };
    if (viewportTimer.current) clearTimeout(viewportTimer.current);
    viewportTimer.current = setTimeout(() => {
      const pending = pendingViewport.current;
      viewportTimer.current = null; pendingViewport.current = null;
      if (!pending || !store) return;
      const current = canvasesRef.current.find((item) => item.id === pending.id);
      if (!current) return;
      const updated = withCanvasDocument(current, { ...readCanvasDocument(current), viewport: pending.viewport });
      replace(updated); enqueue(updated);
    }, 400);
  };
  const flushViewport = () => {
    const pending = pendingViewport.current;
    if (viewportTimer.current) clearTimeout(viewportTimer.current);
    viewportTimer.current = null; pendingViewport.current = null;
    if (!pending) return;
    const current = canvasesRef.current.find((item) => item.id === pending.id);
    if (current) { const updated = withCanvasDocument(current, { ...readCanvasDocument(current), viewport: pending.viewport }); replace(updated); enqueue(updated); }
  };
  const activate = (id: string) => { flushViewport(); setOpenIds((current) => current.includes(id) ? current : [...current, id]); setActiveId(id); };
  const closeResourceTab = (id: string) => { const next = openIds.filter((item) => item !== id); setOpenIds(next); if (activeId === id) setActiveId(next.at(-1) ?? null); };
  const create = async () => { if (!store) return; setBusy(true); try { flushViewport(); await saveQueue.current; const created = await store.create(newName); const next = [...canvasesRef.current, created].sort((a, b) => a.title.localeCompare(b.title)); canvasesRef.current = next; setCanvases(next); setOpenIds((current) => [...current, created.id]); setActiveId(created.id); setNewName(''); setError(null); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not create Canvas.'); } finally { setBusy(false); } };
  const rename = async () => { if (!store || !canvas) return; const name = window.prompt('Rename Canvas', canvas.title); if (name === null) return; setBusy(true); try { flushViewport(); await saveQueue.current; replace(await store.rename(canvas, name)); setError(null); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not rename Canvas.'); } finally { setBusy(false); } };
  const remove = async () => { if (!store || !canvas || !window.confirm(`Delete Canvas “${canvas.title}”? Its linked notes and attachments will remain.`)) return; setBusy(true); try { flushViewport(); await saveQueue.current; replace(await store.remove(canvas)); const nextId = canvasesRef.current.find((item) => !item.deletedAt && item.id !== canvas.id)?.id ?? null; setOpenIds((current) => { const remaining = current.filter((id) => id !== canvas.id); return nextId && !remaining.includes(nextId) ? [...remaining, nextId] : remaining; }); setActiveId(nextId); setError(null); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not delete Canvas.'); } finally { setBusy(false); } };
  const restore = async (item: Canvas) => { if (!store) return; try { replace(await store.restore(item)); activate(item.id); setError(null); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not restore Canvas.'); } };
  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || !store) return;
    if (file.size > 5_000_000) { setError('Canvas file exceeds 5 MB.'); return; }
    setBusy(true);
    try {
      const source: unknown = JSON.parse(await file.text());
      const imported = importJsonCanvas(source, workspace.notes, workspace.attachments, `/Canvases/${file.name.replace(/\.canvas(?:\.json)?$|\.json$/iu, '')}.canvas`);
      flushViewport(); await saveQueue.current;
      const created = await store.create(file.name.replace(/\.canvas(?:\.json)?$|\.json$/iu, '') || 'Imported Canvas', imported);
      const next = [...canvasesRef.current, created].sort((a, b) => a.title.localeCompare(b.title)); canvasesRef.current = next; setCanvases(next); setOpenIds((current) => [...current, created.id]); setActiveId(created.id); setError(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not import JSON Canvas.'); }
    finally { setBusy(false); }
  };
  const exportFile = () => { if (!canvas || !document) return; downloadText(canvas.path.slice(canvas.path.lastIndexOf('/') + 1), JSON.stringify(exportJsonCanvas(document, workspace.notes, workspace.attachments, canvas.path), null, 2), 'application/json'); };
  const add = () => {
    if (!document) return;
    try {
      const stage = stageRef.current;
      const centerX = ((stage?.clientWidth ?? 800) / 2 - viewport.x) / viewport.zoom;
      const centerY = ((stage?.clientHeight ?? 600) / 2 - viewport.y) / viewport.zoom;
      const note = addKind === 'note' ? workspace.notes.find((item) => item.id === sourceId) : null;
      const attachment = mediaKinds.has(addKind) ? workspace.attachments.find((item) => item.id === sourceId) : null;
      if (addKind === 'note' && !note) throw new Error('Choose a note to add.');
      if (mediaKinds.has(addKind) && !attachment) throw new Error('Choose an attachment to add.');
      if (addKind === 'url' && !urlInput.trim()) throw new Error('Enter a website URL to add.');
      const created = createCanvasNode(addKind, centerX - 150, centerY - 110, { noteId: note?.id ?? null, attachmentId: attachment?.id ?? null, filePath: attachment?.path ?? note?.path ?? null, url: addKind === 'url' ? urlInput.trim() || null : null, label: addKind === 'frame' ? `Frame ${document.frameOrder.length + 1}` : addKind === 'group' ? 'Group' : '' });
      const next = appendCanvasNode(document, created);
      commit(next); setSelected(new Set([created.id])); setSelectedEdge(null); setError(null);
      if (addKind === 'url') setUrlInput('');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not add Canvas card.'); }
  };
  const addPluginTool = (tool: { title: string; cardText: string }) => {
    if (!document) return;
    try {
      const stage = stageRef.current;
      const centerX = ((stage?.clientWidth ?? 800) / 2 - viewport.x) / viewport.zoom;
      const centerY = ((stage?.clientHeight ?? 600) / 2 - viewport.y) / viewport.zoom;
      const created = createCanvasNode('text', centerX - 140, centerY - 95, { label: tool.title, text: tool.cardText });
      commit(appendCanvasNode(document, created)); setSelected(new Set([created.id])); setSelectedEdge(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not add plugin card.'); }
  };
  const deleteSelected = () => {
    if (!document || !selected.size && !selectedEdge) return;
    const next = deleteCanvasSelection(document, selected);
    commit(selectedEdge ? canvasDocumentSchema.parse({ ...next, edges: next.edges.filter((item) => item.id !== selectedEdge) }) : next);
    setSelected(new Set()); setSelectedEdge(null);
  };
  const undo = () => { if (!document) return; const previous = history.current.past.pop(); if (!previous) return; history.current.future.push(document); commit(previous, false); setCanUndo(history.current.past.length > 0); setCanRedo(true); setSelected(new Set()); setSelectedEdge(null); };
  const redo = () => { if (!document) return; const next = history.current.future.pop(); if (!next) return; history.current.past.push(document); commit(next, false); setCanUndo(true); setCanRedo(history.current.future.length > 0); setSelected(new Set()); setSelectedEdge(null); };
  const copy = () => { if (!document || !selected.size) return; const copied = copyCanvasSelection(document, selected); clipboard.current = copied; setCanPaste(true); pasteCount.current = 0; if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(JSON.stringify(exportJsonCanvas(copied, workspace.notes, workspace.attachments))).catch(() => undefined); };
  const paste = () => { if (!document || !clipboard.current) return; pasteCount.current++; const result = pasteCanvasSelection(document, clipboard.current, 40 + pasteCount.current * 20); commit(result.document); setSelected(result.selected); setSelectedEdge(null); };
  const boardShortcut = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (isEditableTarget(event.target) || !document) return;
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
    else if (modifier && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
    else if (modifier && event.key.toLowerCase() === 'c') { event.preventDefault(); copy(); }
    else if (modifier && event.key.toLowerCase() === 'v') { event.preventDefault(); paste(); }
    else if (modifier && event.key.toLowerCase() === 'a') { event.preventDefault(); setSelected(new Set(document.nodes.map((node) => node.id))); setSelectedEdge(null); }
    else if (selected.size && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); const step = event.shiftKey ? 20 : 5; const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0; const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0; commit(moveCanvasNodes(document, selected, dx, dy)); }
    else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelected(); }
    else if (event.key === 'Escape') { setSelected(new Set()); setSelectedEdge(null); }
  };
  const zoomBy = (factor: number) => { const stage = stageRef.current; const cx = (stage?.clientWidth ?? 800) / 2, cy = (stage?.clientHeight ?? 600) / 2; const zoom = Math.min(4, Math.max(0.1, viewport.zoom * factor)); changeViewport({ x: cx - (cx - viewport.x) * zoom / viewport.zoom, y: cy - (cy - viewport.y) * zoom / viewport.zoom, zoom }); };
  const fit = () => { if (!document?.nodes.length) { changeViewport({ x: 0, y: 0, zoom: 1 }); return; } const stage = stageRef.current; const width = stage?.clientWidth ?? 800, height = stage?.clientHeight ?? 600; const left = Math.min(...document.nodes.map((node) => node.x)), top = Math.min(...document.nodes.map((node) => node.y)), right = Math.max(...document.nodes.map((node) => node.x + node.width)), bottom = Math.max(...document.nodes.map((node) => node.y + node.height)); const zoom = Math.min(2, Math.max(0.1, Math.min((width - 100) / (right - left), (height - 100) / (bottom - top)))); changeViewport({ x: width / 2 - (left + right) / 2 * zoom, y: height / 2 - (top + bottom) / 2 * zoom, zoom }); };
  const addFrameAround = () => { if (!document || !selected.size) return; const nodes = document.nodes.filter((node) => selected.has(node.id)); if (!nodes.length) return; const x = Math.min(...nodes.map((node) => node.x)) - 40, y = Math.min(...nodes.map((node) => node.y)) - 65, right = Math.max(...nodes.map((node) => node.x + node.width)) + 40, bottom = Math.max(...nodes.map((node) => node.y + node.height)) + 40; try { const frame = createCanvasNode('frame', x, y, { width: right - x, height: bottom - y, label: `Frame ${document.frameOrder.length + 1}` }); commit(appendCanvasNode(document, frame)); setSelected(new Set([frame.id])); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not frame selection.'); } };
  const filteredAttachments = workspace.attachments.filter((item) => addKind === 'image' ? item.mime.startsWith('image/') : addKind === 'pdf' ? item.mime === 'application/pdf' : addKind === 'audio' ? item.mime.startsWith('audio/') : addKind === 'video' ? item.mime.startsWith('video/') : true);
  return <main className={styles.layout}>
    <div className={styles.topbar}><button type="button" className="icon-button mobile-menu" aria-label="Open navigation" onClick={onOpenNavigation}><Menu size={20} /></button><strong>Noor Canvas</strong><span>Visual workspaces linked to your vault</span><button type="button" onClick={() => importRef.current?.click()}><Upload size={15} /> Import JSON Canvas</button><input ref={importRef} hidden type="file" accept=".canvas,.json,application/json" onChange={(event) => { void importFile(event); }} /></div>
    {openIds.length > 0 && <div className="resource-tabbar" role="group" aria-label="Open Canvas tabs">{openIds.map((id) => { const item = canvases.find((entry) => entry.id === id && !entry.deletedAt); return item ? <div key={id} className="resource-tab"><button type="button" aria-pressed={activeId === id} onClick={() => activate(id)}>{item.title}</button><button type="button" aria-label={`Close ${item.title} Canvas tab`} onClick={() => closeResourceTab(id)}><X size={13} /></button></div> : null; })}</div>}
    <div className={styles.body}><aside className={styles.sidebar} aria-label="Canvases"><h2>Your Canvases</h2><div className={styles.canvasList}>{canvases.filter((item) => !item.deletedAt).map((item) => <button key={item.id} type="button" className={item.id === activeId ? styles.active : ''} aria-current={item.id === activeId ? 'page' : undefined} onClick={() => activate(item.id)}>{item.title}</button>)}</div><form onSubmit={(event) => { event.preventDefault(); void create(); }}><label className="sr-only" htmlFor="new-canvas-name">Canvas name</label><input id="new-canvas-name" required maxLength={200} value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="New Canvas name" /><button type="submit" disabled={busy}><Plus size={14} /> Create Canvas</button></form>{canvases.some((item) => item.deletedAt) && <details className={styles.deleted}><summary>Deleted Canvases</summary>{canvases.filter((item) => item.deletedAt).map((item) => <div key={item.id}><span>{item.title}</span><button type="button" onClick={() => { void restore(item); }}>Restore</button></div>)}</details>}</aside>
      <div className={styles.workspace}>{error && <div role="alert" className={styles.errorBar}>{error}<button type="button" aria-label="Dismiss error" onClick={() => setError(null)}><X size={15} /></button></div>}
        {!canvas || !document ? <div className={styles.empty}><h1>Ideas need room to move.</h1><p>Create a Canvas to arrange notes, Markdown cards, attachments, and connections on an open workspace.</p><button type="button" onClick={() => window.document.getElementById('new-canvas-name')?.focus()}>Name a Canvas</button></div> : <>
          <div className={styles.heading}><div><small>CANVAS · {document.nodes.length} CARDS · {saveStatus.toUpperCase()}</small><h1>{canvas.title}</h1></div><div><button type="button" onClick={() => { void rename(); }} disabled={busy}>Rename</button><button type="button" onClick={exportFile}><Download size={15} /> Export</button><button type="button" disabled={!document.frameOrder.length} onClick={() => setPresent(true)}><Presentation size={15} /> Present</button><button type="button" className={styles.danger} onClick={() => { void remove(); }} disabled={busy}><Trash2 size={15} /> Delete</button></div></div>
          <div className={styles.toolbar} aria-label="Canvas tools"><label>Add<select aria-label="Card type" value={addKind} onChange={(event) => { setAddKind(event.target.value as CanvasNodeKind); setSourceId(''); }}>{kinds.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>{addKind === 'note' && <select aria-label="Note to add" value={sourceId} onChange={(event) => setSourceId(event.target.value)}><option value="">Choose note</option>{workspace.notes.map((note) => <option key={note.id} value={note.id}>{note.path}</option>)}</select>}{mediaKinds.has(addKind) && <select aria-label="Attachment to add" value={sourceId} onChange={(event) => setSourceId(event.target.value)}><option value="">Choose attachment</option>{filteredAttachments.map((item) => <option key={item.id} value={item.id}>{item.path}</option>)}</select>}{addKind === 'url' && <input type="url" aria-label="Website URL" value={urlInput} onChange={(event) => setUrlInput(event.target.value)} placeholder="https://…" />}<button type="button" onClick={add} disabled={(addKind === 'note' || mediaKinds.has(addKind)) && !sourceId}><Plus size={14} /> Add</button><span className={styles.divider} /><button type="button" aria-pressed={tool === 'select'} onClick={() => setTool('select')} title="Select and lasso"><MousePointer2 size={15} /> Select</button><button type="button" aria-pressed={tool === 'pan'} onClick={() => setTool('pan')} title="Drag to pan"><Move size={15} /> Pan</button><button type="button" onClick={undo} disabled={!canUndo} aria-label="Undo"><Undo2 size={15} /></button><button type="button" onClick={redo} disabled={!canRedo} aria-label="Redo"><Redo2 size={15} /></button><button type="button" onClick={copy} disabled={!selected.size} aria-label="Copy cards"><Copy size={15} /></button><button type="button" onClick={paste} disabled={!canPaste} aria-label="Paste cards">Paste</button><button type="button" onClick={deleteSelected} disabled={!selected.size && !selectedEdge} aria-label="Delete selection"><Trash2 size={15} /></button><button type="button" onClick={() => commit({ ...document, grid: { ...document.grid, visible: !document.grid.visible } }, false)} aria-pressed={document.grid.visible}><Grid3X3 size={15} /> Grid</button><button type="button" onClick={() => commit({ ...document, grid: { ...document.grid, snap: !document.grid.snap } }, false)} aria-pressed={document.grid.snap}>Snap</button><button type="button" onClick={() => zoomBy(0.8)} aria-label="Zoom out"><ZoomOut size={15} /></button><span>{Math.round(viewport.zoom * 100)}%</span><button type="button" onClick={() => zoomBy(1.25)} aria-label="Zoom in"><ZoomIn size={15} /></button><button type="button" onClick={fit} aria-label="Fit Canvas"><RotateCcw size={15} /></button></div>
          {pluginTools.length > 0 && <div className={styles.layoutbar} aria-label="Plugin Canvas tools"><strong>Plugin tools</strong>{pluginTools.map((item) => <button key={item.id} type="button" onClick={() => addPluginTool(item)}>{item.title}</button>)}</div>}
          <div className={styles.layoutbar}><label>Align<select aria-label="Alignment" value={alignment} onChange={(event) => setAlignment(event.target.value as typeof alignment)}><option value="left">Left</option><option value="right">Right</option><option value="top">Top</option><option value="bottom">Bottom</option><option value="center-x">Center horizontally</option><option value="center-y">Center vertically</option></select></label><button type="button" disabled={selected.size < 2} onClick={() => commit(alignCanvasNodes(document, selected, alignment))}><AlignStartHorizontal size={14} /> Align</button><label>Layout<select aria-label="Layout" value={layout} onChange={(event) => setLayout(event.target.value as CanvasLayout)}><option value="horizontal">Horizontal</option><option value="vertical">Vertical</option><option value="tree">Tree</option><option value="mind-map">Mind map</option><option value="flowchart">Flowchart</option></select></label><button type="button" disabled={selected.size < 2 && document.nodes.filter((node) => node.kind !== 'group' && node.kind !== 'frame').length < 2} onClick={() => commit(layoutCanvasNodes(document, selected.size >= 2 ? selected : new Set(document.nodes.map((node) => node.id)), layout))}>Apply layout</button><button type="button" disabled={!selected.size} onClick={() => { try { const result = groupCanvasNodes(document, selected); commit(result.document); setSelected(new Set([result.groupId])); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not group cards.'); } }}><Group size={14} /> Group</button><button type="button" disabled={selectedNode?.kind !== 'group'} onClick={() => { if (selectedNode) { commit(ungroupCanvasNode(document, selectedNode.id)); setSelected(new Set()); } }}><Ungroup size={14} /> Ungroup</button><button type="button" disabled={selected.size !== 2} onClick={() => { const ids = [...selected]; try { const next = connectCanvasNodes(document, ids[0]!, ids[1]!); commit(next); setSelected(new Set()); setSelectedEdge(next.edges.at(-1)?.id ?? null); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not connect cards.'); } }}><Link2 size={14} /> Connect</button><button type="button" disabled={!selected.size} onClick={addFrameAround}>Frame selection</button><button type="button" aria-pressed={showInspector} onClick={() => { setShowInspector((value) => !value); setShowComments(false); }}>Inspector</button></div>
          {sharedRole && <div className={styles.layoutbar}><button type="button" aria-pressed={showComments} onClick={() => { setShowComments((value) => !value); setShowInspector(false); }}>Shared comments {selectedNode ? `for ${selectedNode.label || 'card'}` : 'for Canvas'}</button></div>}
          <div className={styles.canvasArea}><div ref={stageRef} className={styles.stage}><CanvasBoard document={document} viewport={viewport} selected={selected} selectedEdge={selectedEdge} tool={tool} notes={workspace.notes} attachments={workspace.attachments} repository={workspace.repository} onViewport={changeViewport} onCommit={(next) => commit(next)} onSelect={setSelected} onSelectEdge={setSelectedEdge} onOpenNote={onOpenNote} onEditText={(id) => { setSelected(new Set([id])); setShowInspector(true); }} onShortcut={boardShortcut} /></div>{showInspector && <CanvasInspector key={selectedNode?.id ?? selectedEdge ?? 'none'} node={selectedNode} edge={edge} notes={workspace.notes} attachments={workspace.attachments} repository={workspace.repository} onPatchNode={(id, patch) => commit(updateCanvasNode(document, id, patch))} onPatchEdge={(id, patch) => commit(updateCanvasEdge(document, id, patch))} onOpenNote={onOpenNote} />}{showComments && sharedRole && vaultId && <aside className={styles.inspector} aria-label="Canvas comments"><SharedComments key={canvas.id} vaultId={vaultId} targetKind="canvas" targetId={canvas.id} role={sharedRole} draftAnchor={selectedNode ? { kind: 'canvas', nodeId: selectedNode.id } : null} onNavigateCanvas={(id) => setSelected(new Set([id]))} /></aside>}</div>
          <details className={styles.accessibleObjects}><summary>Cards and connectors ({document.nodes.length} cards, {document.edges.length} connectors)</summary><div className={styles.objectList}><h2>Cards</h2><ol>{document.nodes.map((node) => { const name = node.label || workspace.notes.find((note) => note.id === node.noteId)?.title || node.text.slice(0, 40) || 'Untitled'; return <li key={node.id}><button type="button" aria-pressed={selected.has(node.id)} onClick={() => { setSelected(new Set([node.id])); setSelectedEdge(null); }}>{node.kind}: {name}</button><span>{Math.round(node.x)}, {Math.round(node.y)}</span>{node.kind === 'note' && node.noteId && <button type="button" onClick={() => onOpenNote(node.noteId!)}>Open note</button>}</li>; })}</ol>{selected.size > 0 && <div className={styles.objectMoves} role="group" aria-label="Move selected cards"><button type="button" onClick={() => commit(moveCanvasNodes(document, selected, -20, 0))}>Move left</button><button type="button" onClick={() => commit(moveCanvasNodes(document, selected, 20, 0))}>Move right</button><button type="button" onClick={() => commit(moveCanvasNodes(document, selected, 0, -20))}>Move up</button><button type="button" onClick={() => commit(moveCanvasNodes(document, selected, 0, 20))}>Move down</button><button type="button" onClick={() => { setShowInspector(true); setShowComments(false); }}>Edit selection</button></div>}{document.edges.length > 0 && <><h2>Connectors</h2><ol>{document.edges.map((item) => <li key={item.id}><button type="button" aria-pressed={selectedEdge === item.id} onClick={() => { setSelectedEdge(item.id); setSelected(new Set()); setShowInspector(true); }}>{document.nodes.find((node) => node.id === item.fromNode)?.label || 'Card'} to {document.nodes.find((node) => node.id === item.toNode)?.label || 'Card'}{item.label ? `: ${item.label}` : ''}</button></li>)}</ol></>}</div></details>
          <div className={styles.hint}>Drag cards to move · Shift-click for multi-select · Drag empty space to lasso · Arrow keys move selected cards · Ctrl/⌘ + wheel to zoom · Space-drag to pan</div>
          {present && <CanvasPresentation document={document} notes={workspace.notes} attachments={workspace.attachments} repository={workspace.repository} onClose={() => setPresent(false)} onOpenNote={onOpenNote} />}
        </>}
      </div>
    </div>
  </main>;
}
