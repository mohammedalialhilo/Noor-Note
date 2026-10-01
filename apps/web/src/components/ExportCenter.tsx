'use client';

import type { VaultRepository } from '@noor-note/storage';
import { DialogContent, DialogRoot, DialogTitle } from '@noor-note/ui';
import { useEffect, useState } from 'react';
import { createExport, loadExportInventory, portabilityReport, type ExportFormat, type ExportInventory, type PortabilityReport } from '../lib/export-center';
import styles from './ExportCenter.module.css';

interface Props { repository: VaultRepository; vaultId: string; initialNoteId?: string | null; initialFolderId?: string | null; beforeExport: () => Promise<void>; onClose: () => void }

const formats: { value: ExportFormat; label: string }[] = [
  { value: 'noor-zip', label: 'Noor Note vault ZIP' },
  { value: 'markdown-zip', label: 'Portable Markdown vault ZIP' },
  { value: 'folder-zip', label: 'Folder Markdown ZIP' },
  { value: 'note-md', label: 'Individual Markdown note' },
  { value: 'note-html', label: 'Individual HTML note' },
  { value: 'note-pdf', label: 'PDF via browser print' },
  { value: 'json-archive', label: 'Self-contained JSON archive' },
  { value: 'base-csv', label: 'Base CSV' },
  { value: 'canvas-json', label: 'Canvas JSON' },
];

function download(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function ExportCenter({ repository, vaultId, initialNoteId, initialFolderId, beforeExport, onClose }: Props) {
  const [inventory, setInventory] = useState<ExportInventory | null>(null);
  const [format, setFormat] = useState<ExportFormat>('noor-zip');
  const [noteId, setNoteId] = useState(initialNoteId ?? '');
  const [folderId, setFolderId] = useState(initialFolderId ?? '');
  const [baseId, setBaseId] = useState('');
  const [canvasId, setCanvasId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState<PortabilityReport | null>(null);

  useEffect(() => {
    let live = true;
    void beforeExport().then(() => loadExportInventory(repository, vaultId)).then((data) => {
      if (!live) return;
      setInventory(data);
      setNoteId((current) => data.tree.notes.some((note) => note.id === current) ? current : data.tree.notes[0]?.id ?? '');
      setFolderId((current) => data.tree.folders.some((folder) => folder.id === current) ? current : data.tree.folders[0]?.id ?? '');
      setBaseId(data.bases[0]?.id ?? ''); setCanvasId(data.canvases[0]?.id ?? '');
    }).catch((cause: unknown) => { if (live) setError(cause instanceof Error ? cause.message : 'Could not prepare export.'); });
    return () => { live = false; };
  }, [beforeExport, repository, vaultId]);

  const selection = { format, vaultId, noteId, folderId, baseId, canvasId };
  const preview = (() => {
    if (!inventory) return null;
    try { return portabilityReport(selection, inventory); } catch { return null; }
  })();
  const report = completed ?? preview;

  const perform = async () => {
    if (!preview || busy || completed) return;
    const popup = format === 'note-pdf' ? window.open('', '_blank') : null;
    if (format === 'note-pdf' && !popup) { setError('The browser blocked the print view. Allow pop-ups for Noor Note and try again.'); return; }
    if (popup) { popup.document.title = 'Preparing Noor Note print view'; popup.document.body.textContent = 'Preparing note for browser print...'; }
    setBusy(true); setError(null);
    try {
      await beforeExport();
      const fresh = await loadExportInventory(repository, vaultId);
      const artifact = await createExport(repository, selection, fresh);
      if (artifact.delivery === 'print') {
        const url = URL.createObjectURL(artifact.blob);
        popup!.location.href = url;
        window.setTimeout(() => URL.revokeObjectURL(url), 300_000);
      } else download(artifact.filename, artifact.blob);
      setCompleted(artifact.report);
    } catch (cause) {
      popup?.close();
      setError(cause instanceof Error ? cause.message : 'Export failed.');
    } finally { setBusy(false); }
  };

  const changeFormat = (value: ExportFormat) => { setFormat(value); setCompleted(null); setError(null); };
  return <DialogRoot open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className={styles.dialog} aria-describedby={undefined}>
      <DialogTitle>Export Center</DialogTitle>
      <p className={styles.intro}>Choose a format and review what travels with it before exporting.</p>
      <div className={styles.fields}>
        <label>Format<select value={format} disabled={busy} onChange={(event) => changeFormat(event.target.value as ExportFormat)}>{formats.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        {['note-md', 'note-html', 'note-pdf'].includes(format) && <label>Note<select value={noteId} disabled={busy} onChange={(event) => { setNoteId(event.target.value); setCompleted(null); }}>{inventory?.tree.notes.map((item) => <option key={item.id} value={item.id}>{item.path}</option>)}</select></label>}
        {format === 'folder-zip' && <label>Folder<select value={folderId} disabled={busy} onChange={(event) => { setFolderId(event.target.value); setCompleted(null); }}>{inventory?.tree.folders.map((item) => <option key={item.id} value={item.id}>{item.path}</option>)}</select></label>}
        {format === 'base-csv' && <label>Base<select value={baseId} disabled={busy} onChange={(event) => { setBaseId(event.target.value); setCompleted(null); }}>{inventory?.bases.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
        {format === 'canvas-json' && <label>Canvas<select value={canvasId} disabled={busy} onChange={(event) => { setCanvasId(event.target.value); setCompleted(null); }}>{inventory?.canvases.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
      </div>
      {!inventory && !error && <p role="status">Preparing export choices...</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {report && <section className={styles.report} aria-label="Portability report"><h3>Portability report</h3><strong>Included</strong><ul>{report.included.map((item) => <li key={item}>{item}</li>)}</ul><strong>Limits and exclusions</strong><ul>{report.limitations.map((item) => <li key={item}>{item}</li>)}</ul>{completed && <p role="status">Export prepared. {format === 'note-pdf' ? 'Use Print in the new tab and choose Save as PDF.' : 'Your download has started.'}</p>}</section>}
      <div className={styles.actions}><button type="button" onClick={onClose} disabled={busy}>{completed ? 'Done' : 'Cancel'}</button><button type="button" disabled={!preview || busy || Boolean(completed)} onClick={() => { void perform(); }}>{busy ? 'Preparing...' : format === 'note-pdf' ? 'Open print view' : 'Export'}</button></div>
    </DialogContent>
  </DialogRoot>;
}
