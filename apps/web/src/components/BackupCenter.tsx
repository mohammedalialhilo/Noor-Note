'use client';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { VaultRepository } from '@noor-note/storage';
import { DialogContent, DialogRoot, DialogTitle } from '@noor-note/ui';
import { useEffect, useState } from 'react';
import { CloudBackupStore, type CloudBackupItem } from '../lib/cloud-backup';
import { exportVaultZip, importVaultZip, verifyVaultZip, type VaultBackupPreview } from '../lib/vault-archive';
import styles from './BackupCenter.module.css';

interface Props {
  repository: VaultRepository;
  vaultId: string;
  beforeBackup: () => Promise<void>;
  onRestored: (vaultId: string) => Promise<void>;
  client: SupabaseClient | null;
  userId: string | null;
  onClose: () => void;
  onBackupFailure?: () => void;
}

function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function nameFor(preview: VaultBackupPreview): string {
  const safe = preview.vaultName.replace(/[^a-z0-9_-]+/giu, '-').replace(/^-|-$/gu, '').slice(0, 60) || 'vault';
  return `${safe}-${preview.exportedAt.slice(0, 10)}.noor-note.zip`;
}

function Preview({ data }: { data: VaultBackupPreview }) {
  return <div className={styles.preview} aria-label="Verified backup preview">
    <strong>{data.vaultName}</strong>
    <span>Created {new Date(data.exportedAt).toLocaleString()} · format v{data.version}</span>
    <span>{data.notes} notes · {data.folders} folders · {data.attachments} attachments · {data.revisions} revisions</span>
    <span>{(data.archiveBytes / 1024 / 1024).toFixed(1)} MiB · archive verified</span>
  </div>;
}

export function BackupCenter({ repository, vaultId, beforeBackup, onRestored, client, userId, onClose, onBackupFailure }: Props) {
  const [archive, setArchive] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<VaultBackupPreview | null>(null);
  const [cloud, setCloud] = useState<CloudBackupItem[]>([]);
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const store = client && userId ? new CloudBackupStore(client, userId) : null;

  useEffect(() => {
    if (!client || !userId) return;
    let live = true;
    const current = new CloudBackupStore(client, userId);
    void current.list().then((items) => { if (live) setCloud(items); }).catch((cause: unknown) => {
      if (live) setError(cause instanceof Error ? `Could not list cloud backups: ${cause.message}` : 'Could not list cloud backups.');
    });
    return () => { live = false; };
  }, [client, userId]);

  const run = async (work: () => Promise<void>, backupAttempt = false) => {
    if (busy) return;
    setBusy(true); setError(null); setMessage(null);
    try { await work(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Backup operation failed.'); if (backupAttempt) onBackupFailure?.(); }
    finally { setBusy(false); }
  };

  const makeLocal = () => run(async () => {
    await beforeBackup();
    const file = await exportVaultZip(repository, vaultId);
    const checked = await verifyVaultZip(file);
    setArchive(file); setPreview(checked);
    setMessage('Manual backup verified. Download the ZIP to keep a copy outside this browser.');
  }, true);

  const makeCloud = () => run(async () => {
    if (!store) throw new Error('Sign in to use encrypted cloud backup.');
    if (passphrase !== confirmPassphrase) throw new Error('Backup passphrases do not match.');
    await beforeBackup();
    const file = await exportVaultZip(repository, vaultId);
    const checked = await verifyVaultZip(file);
    const created = await store.create(file, passphrase);
    const verified = await store.open(created.id, passphrase);
    setCloud(await store.list());
    setArchive(verified.archive); setPreview(verified.preview);
    setPassphrase(''); setConfirmPassphrase('');
    setMessage(`Encrypted cloud backup created and verified: ${checked.vaultName}. Keep your passphrase; Noor Note cannot recover it.`);
  }, true);

  const chooseFile = (file: File | undefined) => run(async () => {
    setArchive(null); setPreview(null);
    if (!file) return;
    const checked = await verifyVaultZip(file);
    setArchive(file); setPreview(checked);
    setMessage('Backup verified. Restore will create a separate vault.');
  });

  const openCloud = (id: string) => run(async () => {
    if (!store) throw new Error('Sign in to open a cloud backup.');
    setArchive(null); setPreview(null);
    const result = await store.open(id, passphrase);
    setArchive(result.archive); setPreview(result.preview);
    setPassphrase(''); setConfirmPassphrase('');
    setMessage('Encrypted backup downloaded and verified. Review the contents below before restoring.');
  });

  const restore = () => run(async () => {
    if (!archive || !preview) throw new Error('Choose and verify a backup first.');
    await beforeBackup();
    await verifyVaultZip(archive);
    const newVaultId = await importVaultZip(repository, archive);
    await onRestored(newVaultId);
    setMessage('Backup restored into a new vault. The original vault was not overwritten.');
  });

  return <DialogRoot open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className={styles.dialog} aria-describedby={undefined}>
      <DialogTitle>Backup Center</DialogTitle>
      <p>Keep a separate copy of your vault. Backups include notes, attachments, revisions, and supported Noor Note metadata.</p>
      <section className={styles.section} aria-label="Manual backup">
        <h3>Manual backup</h3>
        <p>Create and verify a vault ZIP, then download it to a location you control.</p>
        <button type="button" disabled={busy} onClick={() => { void makeLocal(); }}>Create manual backup</button>
      </section>
      <section className={styles.section} aria-label="Encrypted cloud backup">
        <h3>Encrypted cloud backup</h3>
        <p>Cloud snapshots are encrypted in this browser with a separate passphrase before upload. The cloud sees backup time, size, and chunk count. A lost passphrase cannot be recovered.</p>
        {store ? <>
          <div className={styles.fields}>
            <label>Backup passphrase<input type="password" autoComplete="new-password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} disabled={busy} minLength={12} /></label>
            <label>Confirm for new backup<input type="password" autoComplete="new-password" value={confirmPassphrase} onChange={(event) => setConfirmPassphrase(event.target.value)} disabled={busy} minLength={12} /></label>
          </div>
          <button type="button" disabled={busy || passphrase.length < 12 || passphrase !== confirmPassphrase} onClick={() => { void makeCloud(); }}>Create encrypted cloud backup</button>
          <h4>Cloud snapshots</h4>
          {cloud.length ? <ul className={styles.list}>{cloud.map(({ manifest }) => <li key={manifest.id}><span>{new Date(manifest.createdAt).toLocaleString()} · {(manifest.plaintextBytes / 1024 / 1024).toFixed(1)} MiB</span><button type="button" disabled={busy || passphrase.length < 12} onClick={() => { void openCloud(manifest.id); }}>Unlock and verify</button></li>)}</ul> : <p>No completed cloud backups found for this account.</p>}
        </> : <p>Sign in and configure Supabase to use cloud backup. Manual backup works without an account.</p>}
      </section>
      <section className={styles.section} aria-label="Restore backup">
        <h3>Restore or download</h3>
        <label>Choose a Noor Note vault ZIP<input type="file" accept=".zip,application/zip" disabled={busy} onChange={(event) => { void chooseFile(event.target.files?.[0]); }} /></label>
        {preview && <Preview data={preview} />}
        <p>Restore always creates a <strong>new vault</strong>. Your current vault remains in place; no files are overwritten. The new vault uses additional browser storage.</p>
        <div className={styles.actions}>
          <button type="button" disabled={busy || !archive || !preview} onClick={() => { if (archive && preview) download(nameFor(preview), archive); }}>Download verified ZIP</button>
          <button type="button" disabled={busy || !archive || !preview} onClick={() => { void restore(); }}>Restore into new vault</button>
        </div>
      </section>
      <p className={styles.limit}>Scheduled local backups are unavailable here: browsers can suspend or close the app, and periodic background sync is not reliably available. Create backups manually while Noor Note is open.</p>
      {busy && <p role="status">Working on backup…</p>}
      {message && <p role="status" className={styles.success}>{message}</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.footer}><button type="button" disabled={busy} onClick={onClose}>Close</button></div>
    </DialogContent>
  </DialogRoot>;
}
