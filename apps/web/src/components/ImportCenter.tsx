'use client';

import type { VaultRepository } from '@noor-note/storage';
import { DialogContent, DialogRoot, DialogTitle } from '@noor-note/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { commitImport, createImportReport, inspectImportFiles, planImport, type ConflictStrategy, type ImportBatch, type ImportPlan } from '../lib/import-center';
import type { VaultImportReport } from '../lib/obsidian-vault';
import styles from './ImportCenter.module.css';

interface Props {
  files?: File[];
  repository: VaultRepository;
  vaults: { id: string; name: string }[];
  initialVaultId: string;
  initialFolderId: string | null;
  beforeImport: () => Promise<void>;
  onClose: () => void;
  onImported: (count: number, vaultId: string) => Promise<void>;
}

export function ImportCenter({ files, repository, vaults, initialVaultId, initialFolderId, beforeImport, onClose, onImported }: Props) {
  const [batch, setBatch] = useState<ImportBatch | null>(null);
  const [vaultId, setVaultId] = useState(initialVaultId);
  const [folderId, setFolderId] = useState(initialFolderId ?? 'root');
  const [folders, setFolders] = useState<{ id: string; path: string }[]>([]);
  const [strategy, setStrategy] = useState<ConflictStrategy>('rename');
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [confirmedOverwrite, setConfirmedOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [completed, setCompleted] = useState<{ count: number; report: VaultImportReport } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  const inspect = async (selected: File[]) => {
    setBusy(true); setBatch(null); setPlan(null); setError(null); setConfirmedOverwrite(false); setCompleted(null);
    try { setBatch(await inspectImportFiles(selected)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not inspect these files.'); }
    finally { setBusy(false); }
  };

  useEffect(() => { if (files?.length) void Promise.resolve().then(() => inspect(files)); }, [files]);

  useEffect(() => {
    if (!batch || batch.nativeArchive) return;
    let active = true;
    void repository.listTree(vaultId).then(async (tree) => {
      if (!active) return;
      setFolders(tree.folders.map((folder) => ({ id: folder.id, path: folder.path })));
      const destination = folderId === 'root' ? null : folderId;
      const next = await planImport(batch, repository, tree, destination, strategy);
      if (active) { setPlan(next); setError(null); }
    }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Could not plan import.'); });
    return () => { active = false; };
  }, [batch, folderId, repository, strategy, vaultId, refreshToken]);

  const report = useMemo(() => batch ? createImportReport(batch, plan) : null, [batch, plan]);

  const downloadReport = () => {
    if (!completed) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(completed.report, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'noor-note-import-report.json'; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const apply = async () => {
    if (!batch || completed || !plan && !batch.nativeArchive || plan?.blocked.length || strategy === 'overwrite' && !confirmedOverwrite) return;
    setBusy(true); setError(null);
    try {
      await beforeImport();
      const result = await commitImport(batch, repository, vaultId, folderId === 'root' ? null : folderId, strategy, plan ?? { items: [], conflicts: 0, blocked: [], signature: 'native' });
      setCompleted({ count: result.imported, report: report ?? createImportReport(batch, plan) });
      await onImported(result.imported, result.vaultId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Import failed. Review the destination and retry.');
      if (!completed) { setPlan(null); setRefreshToken((token) => token + 1); }
    } finally { setBusy(false); }
  };

  const native = Boolean(batch?.nativeArchive);
  return <DialogRoot open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className={styles.dialog} aria-describedby={undefined}>
      <DialogTitle>Import Center</DialogTitle>
      <p className={styles.intro}>Review imported content and its destination before writing to a vault.</p>
      {!completed && <div className={styles.pickers}>
        <button type="button" disabled={busy} onClick={() => fileRef.current?.click()}>Choose files or ZIP</button>
        <button type="button" disabled={busy} onClick={() => folderRef.current?.click()}>Choose folder</button>
        <input ref={fileRef} type="file" multiple hidden accept=".md,.markdown,.html,.htm,.csv,.json,.enex,.zip,image/*,application/pdf,audio/*,video/*" onChange={(event) => { const selected = Array.from(event.target.files ?? []); if (selected.length) void inspect(selected); event.target.value = ''; }} />
        <input ref={(node) => { folderRef.current = node; node?.setAttribute('webkitdirectory', ''); }} type="file" multiple hidden onChange={(event) => { const selected = Array.from(event.target.files ?? []); if (selected.length) void inspect(selected); event.target.value = ''; }} />
      </div>}
      {busy && <p role="status">Checking import…</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {batch && <>
        <div className={styles.summary}><strong>{batch.format}</strong><span>{batch.folders.length} folders</span><span>{batch.notes.length} notes</span><span>{batch.attachments.length} attachments</span><span>{batch.canvases.length} Canvases</span><span>{native ? 'New vault' : `${plan?.conflicts ?? '…'} potential conflicts`}</span></div>
        {completed ? <p role="status">Imported {completed.count} {completed.count === 1 ? 'item' : 'items'}. Review or download the import report.</p> : native ? <p>This Noor Note backup creates a new vault. Its own folder structure and metadata will be restored.</p> : <>
          <div className={styles.destinations}>
            <label>Target vault<select value={vaultId} disabled={busy} onChange={(event) => { setVaultId(event.target.value); setFolderId('root'); setPlan(null); setConfirmedOverwrite(false); }}>{vaults.map((vault) => <option key={vault.id} value={vault.id}>{vault.name}</option>)}</select></label>
            <label>Target folder<select value={folderId} disabled={busy} onChange={(event) => { setFolderId(event.target.value); setPlan(null); }}><option value="root">Vault root</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.path}</option>)}</select></label>
          </div>
          <fieldset className={styles.strategies}><legend>Path conflicts</legend>
            {([['rename', 'Rename imported files'], ['skip', 'Skip conflicts'], ['merge', 'Merge notes only when one version contains the other'], ['overwrite', 'Overwrite existing notes']] as const).map(([value, label]) => <label key={value}><input type="radio" name="import-conflict" checked={strategy === value} onChange={() => { setStrategy(value); setPlan(null); setConfirmedOverwrite(false); }} /> {label}</label>)}
          </fieldset>
          {strategy === 'overwrite' && <label className={styles.confirm}><input type="checkbox" checked={confirmedOverwrite} onChange={(event) => setConfirmedOverwrite(event.target.checked)} /> I confirm existing note content may be replaced. A revision checkpoint will retain the previous version. Colliding attachments are skipped.</label>}
          {strategy === 'merge' && <p className={styles.help}>Merge applies only when one Markdown body is an exact line-prefix of the other. Other conflicts must be renamed, skipped, or explicitly overwritten.</p>}
          {plan?.blocked.map((message) => <p role="alert" className={styles.error} key={message}>{message}</p>)}
          {plan && <div className={styles.preview} aria-label="Import preview"><strong>Planned changes</strong><ul>{plan.items.slice(0, 100).map((item, index) => <li key={`${item.sourcePath}:${index}`}><span>{item.kind}</span><span>{item.sourcePath}</span><span>→ {item.destinationPath}</span><em>{item.action}</em></li>)}</ul>{plan.items.length > 100 && <p>Showing first 100 of {plan.items.length} items.</p>}</div>}
        </>}
        {report && <div className={styles.report} aria-label="Import report">
          <strong>Import report {completed ? 'results' : 'preview'}</strong>
          <p>{report.successes.length} planned or completed changes · {report.warnings.length} warnings · {report.unsupportedSyntax.length} unsupported syntax items · {report.brokenReferences.length} unresolved references within selected files</p>
          {report.warnings.length > 0 && <details><summary>Warnings ({report.warnings.length})</summary><ul>{report.warnings.slice(0, 100).map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
          {report.unsupportedSyntax.length > 0 && <details><summary>Unsupported syntax ({report.unsupportedSyntax.length})</summary><ul>{report.unsupportedSyntax.slice(0, 100).map((item, index) => <li key={index}>{item.path}{item.line ? `:${item.line}` : ''}: {item.reason}</li>)}</ul></details>}
          {report.brokenReferences.length > 0 && <details><summary>Unresolved references ({report.brokenReferences.length})</summary><ul>{report.brokenReferences.slice(0, 100).map((item, index) => <li key={index}>{item.path}{item.line ? `:${item.line}` : ''} → {item.target}: {item.reason}</li>)}</ul></details>}
          {completed && <details><summary>Imported items ({report.successes.length})</summary><ul>{report.successes.slice(0, 100).map((item, index) => <li key={index}>{item.kind}: {item.path} ({item.action})</li>)}</ul></details>}
        </div>}
      </>}
      <div className={styles.actions}>{completed ? <><button type="button" onClick={downloadReport}>Download report</button><button type="button" onClick={onClose}>Done</button></> : <><button type="button" onClick={onClose} disabled={busy}>Cancel</button><button type="button" onClick={() => { void apply(); }} disabled={!batch || busy || !native && (!plan || plan.blocked.length > 0 || strategy === 'overwrite' && !confirmedOverwrite)}>Import {batch ? batch.folders.length + batch.notes.length + batch.attachments.length + batch.canvases.length : ''} {batch && batch.folders.length + batch.notes.length + batch.attachments.length + batch.canvases.length === 1 ? 'item' : 'items'}</button></>}</div>
    </DialogContent>
  </DialogRoot>;
}
