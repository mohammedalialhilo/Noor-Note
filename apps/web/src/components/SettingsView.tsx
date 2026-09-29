'use client';

import { Button, Dialog, Select } from '@noor-note/ui';
import { ArrowLeft, Download, FolderOpen, HardDrive, Info, Menu, Plus, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { useEffect, useState, type MouseEvent } from 'react';
import Link from 'next/link';
import type { VaultStatistics } from '@noor-note/storage';
import type { useVaultWorkspace } from '../hooks/useVaultWorkspace';
import type { useCloudSync } from '../hooks/useCloudSync';
import { canConnectDirectory, pickDirectory, writeVaultToDirectory } from '../lib/connected-directory';
import { useTheme } from '../theme/ThemeProvider';
import { parseThemePreference } from '../theme/theme';
import { MetadataSchemaManager } from './MetadataSchemaManager';
import { KeyboardShortcuts } from './KeyboardShortcuts';
import { TemplateSettings } from './TemplateSettings';
import { PeriodNotesSettings } from './PeriodNotesSettings';
import { AiSettings } from './AiSettings';
import { useAccount } from '../auth/AuthProvider';
import type { CommandDefinition } from '../lib/commands';
import type { ShortcutOverrides } from '../lib/shortcuts';
import styles from './SettingsView.module.css';

interface SettingsViewProps {
  workspace: ReturnType<typeof useVaultWorkspace>;
  sync: ReturnType<typeof useCloudSync>;
  onImport: () => void;
  onExport: () => void;
  onBack: () => void;
  onOpenNote: (id: string) => void;
  onPreviewTemplate: (id: string) => void;
  onOpenNavigation: (event: MouseEvent<HTMLButtonElement>) => void;
  commands: CommandDefinition[];
  shortcutOverrides: ShortcutOverrides;
  onShortcutChange: (id: string, shortcut: string | null | undefined) => string | null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  const size = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / (1024 ** size)).toFixed(1)} ${units[size - 1] ?? 'TB'}`;
}

export function SettingsView({ workspace, sync, onImport, onExport, onBack, onOpenNote, onPreviewTemplate, onOpenNavigation, commands, shortcutOverrides, onShortcutChange }: SettingsViewProps) {
  const account = useAccount();
  const { preference, setPreference } = useTheme();
  const [usage, setUsage] = useState<string | null>(null);
  const [statistics, setStatistics] = useState<VaultStatistics | null>(null);
  const [directory, setDirectory] = useState<FileSystemDirectoryHandle | null>(null);
  const [directorySupported, setDirectorySupported] = useState(false);
  const [dialog, setDialog] = useState<'create' | 'rename' | 'delete' | null>(null);
  const [name, setName] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [cloudVaults, setCloudVaults] = useState<{ id: string; name: string; encrypted: boolean }[]>([]);
  const [encryptPassphrase, setEncryptPassphrase] = useState('');
  const [encryptConfirm, setEncryptConfirm] = useState('');
  const [unlockPassphrase, setUnlockPassphrase] = useState('');
  const [recoverySaved, setRecoverySaved] = useState(false);
  const [restoreId, setRestoreId] = useState<string | null>(null);
  const [restoreCode, setRestoreCode] = useState('');
  const [restorePassphrase, setRestorePassphrase] = useState('');
  const vault = workspace.activeVault;
  const vaultId = vault?.id;
  const repository = workspace.repository;

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => setDirectorySupported(canConnectDirectory()), 0);
    if (navigator.storage?.estimate) void navigator.storage.estimate().then((estimate) => { if (active && typeof estimate.usage === 'number') setUsage(formatBytes(estimate.usage)); }).catch(() => undefined);
    return () => { active = false; window.clearTimeout(timer); };
  }, []);

  useEffect(() => {
    if (!vaultId || !repository) return;
    let active = true;
    void Promise.all([repository.getStatistics(vaultId), repository.getConnectedDirectory(vaultId)]).then(([stats, handle]) => {
      if (active) { setStatistics(stats); setDirectory(handle ?? null); }
    }).catch(() => { if (active) setMessage('Could not load vault details.'); });
    return () => { active = false; };
  }, [vaultId, repository]);

  const submitVault = async () => {
    if (!vault || !name.trim() && dialog !== 'delete') return;
    if (dialog === 'create') await workspace.createVault(name.trim());
    if (dialog === 'rename') await workspace.renameVault(vault.id, name.trim());
    if (dialog === 'delete') await workspace.deleteVault(vault.id);
    setDialog(null);
    setName('');
  };

  const connect = async () => {
    if (!vault || !repository) return;
    try {
      const handle = await pickDirectory();
      await repository.connectDirectory(vault.id, handle);
      setDirectory(handle);
      setMessage(`Connected ${handle.name}. Files are written only when you choose Write files.`);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setMessage('Could not connect the folder. Use ZIP export if your browser blocks folder access.');
    }
  };

  const writeFiles = async () => {
    if (!vault || !repository || !directory) return;
    try {
      await workspace.flushPending();
      const count = await writeVaultToDirectory(repository, vault.id, directory);
      setMessage(`Wrote ${count} ${count === 1 ? 'file' : 'files'} to the connected folder.`);
    } catch { setMessage('Could not write files. Check this browser’s folder permission, then try again.'); }
  };

  return <main className={styles.page}>
    <div className={styles.topbar}>
      <button type="button" className={styles.mobileMenu} aria-label="Open navigation" onClick={onOpenNavigation}><Menu size={20} /></button>
      <button type="button" className={styles.back} onClick={onBack}><ArrowLeft size={17} /> Workspace</button>
      <span>Noor Note settings</span>
    </div>
    <div className={styles.content}>
      <span className={styles.eyebrow}>PREFERENCES</span><h1>Settings</h1><p className={styles.intro}>Manage your local vault and how Noor Note looks.</p>
      {message && <p className={styles.message} role="status">{message}</p>}
      <section className={styles.card} aria-labelledby="vault-heading">
        <div className={styles.sectionHeading}><h2 id="vault-heading">Vault</h2><p>Each vault keeps its own folders, notes, and attachments.</p></div>
        <Select label="Active vault" value={vault?.id ?? ''} onChange={(event) => { void workspace.switchVault(event.target.value); }}>{workspace.vaults.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>
        <div className={styles.actions}>
          <Button variant="secondary" onClick={() => { setName(''); setDialog('create'); }}><Plus size={16} /> Create vault</Button>
          <Button variant="secondary" disabled={!vault} onClick={() => { setName(vault?.name ?? ''); setDialog('rename'); }}>Rename</Button>
          <Button variant="danger" disabled={!vault} onClick={() => setDialog('delete')}><Trash2 size={16} /> Delete vault</Button>
        </div>
        {statistics && <div className={styles.stats}><span><strong>{statistics.notes}</strong> notes</span><span><strong>{statistics.folders}</strong> folders</span><span><strong>{statistics.attachments}</strong> attachments</span><span><strong>{formatBytes(statistics.attachmentBytes)}</strong> files</span><span><strong>{statistics.trashed}</strong> in Trash</span></div>}
        {workspace.deletedVaults.length > 0 && <div className={styles.deletedVaults}><h3>Deleted vaults</h3>{workspace.deletedVaults.map((item) => <div key={item.id} className={styles.dataLine}><span>{item.name}</span><Button variant="secondary" onClick={() => { void workspace.restoreVault(item.id); }}>Restore vault</Button></div>)}</div>}
      </section>
      <section className={styles.card} aria-labelledby="appearance-heading">
        <div className={styles.sectionHeading}><h2 id="appearance-heading">Appearance</h2><p>Choose how your workspace looks.</p></div>
        <Select label="Theme" value={preference} onChange={(event) => setPreference(parseThemePreference(event.target.value))} hint="System follows your device appearance setting."><option value="light">Light</option><option value="dark">Dark</option><option value="system">System</option></Select>
      </section>
      <section className={styles.card} aria-labelledby="account-heading">
        <div className={styles.sectionHeading}><h2 id="account-heading">Account</h2><p>Sign-in is optional. Your vault remains available locally.</p></div>
        <div className={styles.dataLine}><ShieldCheck size={18} /><span>{account.user?.email ?? (account.configuration.kind === 'supabase' ? 'Not signed in' : 'Local-only workspace')}</span><span>{account.user ? 'Account connected' : 'No account required'}</span></div>
        <div className={styles.actions}><Link className="nn-button nn-button--secondary" href="/account/">{account.user ? 'Manage account' : 'Sign in or create account'}</Link></div>
      </section>
      <section className={styles.card} aria-labelledby="sync-heading">
        <div className={styles.sectionHeading}><h2 id="sync-heading">Cloud sync</h2><p>Sync is optional. Protect a new, unsynced vault before enabling it to encrypt notes, folders, settings, and attachments before upload. Local editing works offline.</p></div>
        <div className={styles.dataLine}><ShieldCheck size={18} /><span>{sync.snapshot.status === 'pending' ? 'Changes pending' : sync.snapshot.status === 'error' ? 'Sync error' : sync.snapshot.status[0]?.toUpperCase() + sync.snapshot.status.slice(1)}</span><span>{sync.snapshot.pending} pending</span></div>
        {sync.snapshot.error && <p className={styles.helper} role="alert">{sync.snapshot.error}</p>}
        {syncMessage && <p className={styles.helper} role="status">{syncMessage}</p>}
        {sync.available && sync.encryption === 'none' && !sync.enabled && <div className={styles.encryptionPanel}>
          <h3>End-to-end encryption</h3><p>Choose a separate encryption passphrase. Noor Note will show a one-time recovery code. If both are lost, encrypted cloud data cannot be recovered.</p>
          <label>Encryption passphrase<input type="password" autoComplete="new-password" value={encryptPassphrase} onChange={(event) => setEncryptPassphrase(event.target.value)} minLength={12} maxLength={1024} /></label>
          <label>Confirm passphrase<input type="password" autoComplete="new-password" value={encryptConfirm} onChange={(event) => setEncryptConfirm(event.target.value)} /></label>
          <div className={styles.actions}><Button variant="secondary" disabled={!vault || encryptPassphrase.length < 12 || encryptPassphrase !== encryptConfirm} onClick={() => {
            setSyncMessage(null);
            void sync.protectVault(encryptPassphrase).then(() => { setEncryptPassphrase(''); setEncryptConfirm(''); }).catch((error: unknown) => setSyncMessage(error instanceof Error ? error.message : 'Could not create an encryption key.'));
          }}>Protect this vault</Button></div>
        </div>}
        {sync.encryption === 'pending' && sync.pendingRecoveryCode && <div className={styles.encryptionPanel}>
          <h3>Save your recovery code</h3><p>Store this code outside Noor Note. It is shown only now and can restore this vault on another device.</p>
          <code className={styles.recoveryCode}>{sync.pendingRecoveryCode}</code>
          <label className={styles.confirmLine}><input type="checkbox" checked={recoverySaved} onChange={(event) => setRecoverySaved(event.target.checked)} /> I saved the recovery code somewhere safe.</label>
          <div className={styles.actions}><Button variant="primary" disabled={!recoverySaved} onClick={() => { void sync.confirmEncryption().then(() => { setRecoverySaved(false); setSyncMessage('This vault is protected. You can now enable sync.'); }).catch((error: unknown) => setSyncMessage(error instanceof Error ? error.message : 'Could not save the encryption key.')); }}>Confirm recovery code</Button><Button variant="secondary" onClick={() => { sync.cancelPendingEncryption(); setRecoverySaved(false); }}>Cancel</Button></div>
        </div>}
        {sync.encryption === 'locked' && <div className={styles.encryptionPanel}><h3>Encrypted vault locked</h3><p>Local notes remain available. Unlock the vault key to sync changes.</p><label>Encryption passphrase<input type="password" autoComplete="current-password" value={unlockPassphrase} onChange={(event) => setUnlockPassphrase(event.target.value)} /></label><div className={styles.actions}><Button variant="primary" disabled={!unlockPassphrase} onClick={() => { void sync.unlockVaultSync(unlockPassphrase).then(() => { setUnlockPassphrase(''); setSyncMessage(null); }).catch((error: unknown) => setSyncMessage(error instanceof Error ? error.message : 'Could not unlock the vault.')); }}>Unlock for sync</Button></div></div>}
        {sync.encryption === 'recovery' && <div className={styles.encryptionPanel}><h3>Recover this vault key</h3><p>This vault is marked as encrypted, but its wrapped key is missing from this browser. Enter your recovery code to reconnect it to its encrypted cloud data.</p><label>Recovery code<input type="password" autoComplete="off" value={restoreCode} onChange={(event) => setRestoreCode(event.target.value)} /></label><label>New encryption passphrase<input type="password" autoComplete="new-password" value={restorePassphrase} onChange={(event) => setRestorePassphrase(event.target.value)} /></label><div className={styles.actions}><Button variant="primary" disabled={!restoreCode || restorePassphrase.length < 12} onClick={() => { void sync.recoverLocalEncryption(restoreCode, restorePassphrase).then(() => { setRestoreCode(''); setRestorePassphrase(''); setSyncMessage('Vault key recovered.'); }).catch((error: unknown) => setSyncMessage(error instanceof Error ? error.message : 'Could not recover the vault key.')); }}>Recover key</Button></div></div>}
        {sync.encryption === 'unlocked' && <div className={styles.encryptionPanel}><p>Encrypted sync is unlocked in this tab. The vault key is kept in memory until you close or lock it.</p><Button variant="secondary" onClick={sync.lockVaultSync}>Lock vault key</Button></div>}
        {sync.available ? <div className={styles.actions}>
          <Button variant={sync.enabled ? 'secondary' : 'primary'} disabled={!sync.enabled && (sync.encryption === 'pending' || sync.encryption === 'locked' || sync.encryption === 'recovery')} onClick={() => {
            setSyncMessage(null);
            void (sync.enabled ? sync.disable() : sync.enable()).catch((error: unknown) => setSyncMessage(error instanceof Error ? error.message : 'Cloud sync could not be changed.'));
          }}>{sync.enabled ? 'Pause sync' : sync.encryption === 'unlocked' ? 'Enable encrypted sync' : 'Enable sync without encryption'}</Button>
          {sync.enabled && <Button variant="secondary" onClick={() => { void sync.syncNow(); }}>Sync now</Button>}
        </div> : <p className={styles.helper}>Sign in to enable cloud sync. Your local vault is available without an account.</p>}
        {sync.enabled && <label className={styles.helper}><input type="checkbox" checked={sync.attachments} onChange={(event) => { void sync.changeAttachments(event.target.checked).catch((error: unknown) => setSyncMessage(error instanceof Error ? error.message : 'Attachment sync could not be changed.')); }} /> Sync attachments</label>}
        {sync.available && <div className={styles.actions}><Button variant="secondary" onClick={() => { void sync.listRemoteVaults().then(setCloudVaults).catch((error: unknown) => setSyncMessage(error instanceof Error ? error.message : 'Could not list cloud vaults.')); }}>Browse cloud vaults</Button></div>}
        {cloudVaults.filter((item) => !workspace.vaults.some((local) => local.id === item.id)).map((item) => <div key={item.id}><div className={styles.dataLine}><span>{item.name}{item.encrypted ? ' · encrypted' : ''}</span><Button variant="secondary" onClick={() => {
          setSyncMessage(null);
          if (item.encrypted) { setRestoreId(item.id); return; }
          void sync.restoreRemoteVault(item.id).then(() => workspace.switchVault(item.id)).catch((error: unknown) => setSyncMessage(error instanceof Error ? error.message : 'Could not restore cloud vault.'));
        }}>{item.encrypted ? 'Recover vault' : 'Download vault'}</Button></div>{restoreId === item.id && <div className={styles.encryptionPanel}><p>Enter the recovery code and choose a new passphrase for this device.</p><label>Recovery code<input type="password" autoComplete="off" value={restoreCode} onChange={(event) => setRestoreCode(event.target.value)} /></label><label>New encryption passphrase<input type="password" autoComplete="new-password" value={restorePassphrase} onChange={(event) => setRestorePassphrase(event.target.value)} /></label><div className={styles.actions}><Button variant="primary" disabled={!restoreCode || restorePassphrase.length < 12} onClick={() => { void sync.restoreRemoteVault(item.id, restoreCode, restorePassphrase).then(async () => { setRestoreCode(''); setRestorePassphrase(''); setRestoreId(null); await workspace.switchVault(item.id); }).catch((error: unknown) => setSyncMessage(error instanceof Error ? error.message : 'Could not recover cloud vault.')); }}>Recover and download</Button><Button variant="secondary" onClick={() => { setRestoreId(null); setRestoreCode(''); setRestorePassphrase(''); }}>Cancel</Button></div></div>}</div>)}
      </section>
      <AiSettings />
      <KeyboardShortcuts commands={commands} overrides={shortcutOverrides} onChange={onShortcutChange} />
      <TemplateSettings workspace={workspace} onOpenNote={onOpenNote} onPreview={onPreviewTemplate} />
      <PeriodNotesSettings workspace={workspace} />
      <section className={styles.card} aria-labelledby="data-heading">
        <div className={styles.sectionHeading}><h2 id="data-heading">Your data</h2><p>Notes and metadata are stored in this browser. Larger attachments use private browser file storage when available.</p></div>
        <div className={styles.dataLine}><HardDrive size={18} /><span>{workspace.notes.length} {workspace.notes.length === 1 ? 'note' : 'notes'} in this vault</span><span>{usage ?? 'Browser storage'}</span></div>
        <div className={styles.actions}><Button variant="secondary" onClick={onImport}><Upload size={16} /> Import Markdown or ZIP</Button><Button variant="secondary" onClick={onExport}><Download size={16} /> Export vault ZIP</Button></div>
        <p className={styles.helper}><ShieldCheck size={15} /> Export a ZIP before clearing browser data or moving to another device.</p>
      </section>
      <section className={styles.card} aria-labelledby="directory-heading">
        <div className={styles.sectionHeading}><h2 id="directory-heading">Connected folder</h2><p>Write portable Markdown and attachments to a folder you choose. This is a manual export.</p></div>
        {directorySupported ? <><div className={styles.dataLine}><FolderOpen size={18} /><span>{directory?.name ?? 'No folder connected'}</span></div><div className={styles.actions}>
          <Button variant="secondary" onClick={() => { void connect(); }}>{directory ? 'Change folder' : 'Connect folder'}</Button>
          {directory && <><Button variant="primary" onClick={() => { void writeFiles(); }}>Write files</Button><Button variant="ghost" onClick={() => { if (vault && repository) void repository.disconnectDirectory(vault.id).then(() => { setDirectory(null); setMessage('Folder disconnected.'); }); }}>Disconnect</Button></>}
        </div></> : <p className={styles.helper}>Folder access is unavailable in this browser. ZIP export remains available.</p>}
      </section>
      {vaultId && <MetadataSchemaManager vaultId={vaultId} folders={workspace.folders} repository={repository} onPut={workspace.putMetadataSchema} onDelete={workspace.deleteMetadataSchema} />}
      <section className={styles.card} aria-labelledby="about-heading">
        <div className={styles.sectionHeading}><h2 id="about-heading">About Noor Note</h2><p>A calmer place to collect and connect your ideas.</p></div>
        <div className={styles.about}><Info size={19} /><div><strong>Local-first workspace</strong><span>Markdown-first and private by default. Cloud sync is optional and must be enabled for each vault.</span></div></div>
      </section>
    </div>
    <Dialog open={dialog !== null} onOpenChange={(open) => { if (!open) setDialog(null); }} title={dialog === 'create' ? 'Create vault' : dialog === 'rename' ? 'Rename vault' : 'Delete vault'} description={dialog === 'delete' ? 'This vault will be hidden from the active list. Its local data remains in browser storage.' : undefined}>
      <form className={styles.dialogForm} onSubmit={(event) => { event.preventDefault(); void submitVault(); }}>
        {dialog !== 'delete' && <><label htmlFor="settings-vault-name">Vault name</label><input id="settings-vault-name" autoFocus required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} /></>}
        <div className={styles.actions}><Button type="button" variant="secondary" onClick={() => setDialog(null)}>Cancel</Button><Button type="submit" variant={dialog === 'delete' ? 'danger' : 'primary'}>{dialog === 'delete' ? 'Delete vault' : dialog === 'rename' ? 'Rename' : 'Create'}</Button></div>
      </form>
    </Dialog>
  </main>;
}
