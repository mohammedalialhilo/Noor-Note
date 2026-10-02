'use client';

import { Button, Dialog, Select } from '@noor-note/ui';
import { ArrowLeft, Download, FolderOpen, HardDrive, Info, Menu, Plus, ShieldCheck, Trash2, Upload, Archive, LifeBuoy } from 'lucide-react';
import { useEffect, useState, type MouseEvent } from 'react';
import Link from 'next/link';
import type { VaultStatistics } from '@noor-note/storage';
import type { useVaultWorkspace } from '../hooks/useVaultWorkspace';
import type { useCloudSync } from '../hooks/useCloudSync';
import type { usePwa } from '../hooks/usePwa';
import { canConnectDirectory, pickDirectory, writeVaultToDirectory } from '../lib/connected-directory';
import { MetadataSchemaManager } from './MetadataSchemaManager';
import { KeyboardShortcuts } from './KeyboardShortcuts';
import { TemplateSettings } from './TemplateSettings';
import { PeriodNotesSettings } from './PeriodNotesSettings';
import { AiSettings } from './AiSettings';
import { PluginManager } from './PluginManager';
import { ThemeManager } from './ThemeManager';
import { PublishingManager } from './PublishingManager';
import { PrivateShareManager } from './PrivateShareManager';
import type { PluginHost } from '../lib/plugin-host';
import { useAccount } from '../auth/AuthProvider';
import type { CommandDefinition } from '../lib/commands';
import type { ShortcutOverrides } from '../lib/shortcuts';
import { settingsCategories, type SettingsCategory } from '../lib/settings-system';
import type { EditorPreferences } from '../lib/editor-preferences';
import type { ShellView } from './ShellNavigation';
import { canManage, memberRoleSchema, type MemberRole } from '../lib/sharing';
import styles from './SettingsView.module.css';

interface SettingsViewProps {
  workspace: ReturnType<typeof useVaultWorkspace>;
  sync: ReturnType<typeof useCloudSync>;
  pwa: ReturnType<typeof usePwa>;
  onImport: () => void;
  onExport: () => void;
  onBackup: () => void;
  onRecovery: () => void;
  onBack: () => void;
  onOpenNote: (id: string) => void;
  onPreviewTemplate: (id: string) => void;
  onOpenNavigation: (event: MouseEvent<HTMLButtonElement>) => void;
  commands: CommandDefinition[];
  shortcutOverrides: ShortcutOverrides;
  onShortcutChange: (id: string, shortcut: string | null | undefined) => string | null;
  pluginHost: PluginHost;
  editorPreferences: EditorPreferences;
  onEditorPreferences: (next: EditorPreferences) => void;
  editorPersistenceWarning: string | null;
  onNavigate: (view: ShellView) => void;
  onShowTour: () => void;
  initialCategory?: SettingsCategory;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  const size = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / (1024 ** size)).toFixed(1)} ${units[size - 1] ?? 'TB'}`;
}

export function SettingsView({ workspace, sync, pwa, onImport, onExport, onBackup, onRecovery, onBack, onOpenNote, onPreviewTemplate, onOpenNavigation, commands, shortcutOverrides, onShortcutChange, pluginHost, editorPreferences, onEditorPreferences, editorPersistenceWarning, onNavigate, onShowTour, initialCategory = 'general' }: SettingsViewProps) {
  const account = useAccount();
  const [category, setCategory] = useState<SettingsCategory>(initialCategory);
  const selectedCategory = settingsCategories.find((item) => item.id === category) ?? settingsCategories[0];
  const [usage, setUsage] = useState<string | null>(null);
  const [statistics, setStatistics] = useState<VaultStatistics | null>(null);
  const [directory, setDirectory] = useState<FileSystemDirectoryHandle | null>(null);
  const [directorySupported, setDirectorySupported] = useState(false);
  const [dialog, setDialog] = useState<'create' | 'rename' | 'delete' | null>(null);
  const [name, setName] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [cloudVaults, setCloudVaults] = useState<{ id: string; name: string; encrypted: boolean; shared: boolean }[]>([]);
  const [shareEmail, setShareEmail] = useState('');
  const [shareRole, setShareRole] = useState<MemberRole>('editor');
  const [members, setMembers] = useState<{ userId: string; email: string; role: MemberRole }[]>([]);
  const [invites, setInvites] = useState<{ id: string; vault_id: string; vault_name: string; role: MemberRole; expires_at: string }[]>([]);
  const [sentInvites, setSentInvites] = useState<{ id: string; email: string; role: MemberRole; expires_at: string }[]>([]);
  const [transfers, setTransfers] = useState<{ vault_id: string; vault_name: string; from_email: string; expires_at: string }[]>([]);
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
    <div className={styles.layout}>
      <nav className={styles.categoryNav} aria-label="Settings categories">
        {settingsCategories.map((item) => <button key={item.id} type="button" aria-current={category === item.id ? 'page' : undefined} className={category === item.id ? styles.selectedCategory : undefined} onClick={() => setCategory(item.id)}>{item.label}</button>)}
      </nav>
    <div className={styles.content}>
      <span className={styles.eyebrow}>PREFERENCES · {selectedCategory.scope.toUpperCase()}</span><h1>Settings</h1><p className={styles.intro}>{selectedCategory.label} · {selectedCategory.scope}</p>
      {message && <p className={styles.message} role="status">{message}</p>}
      {category === 'general' && <>
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
      </>}
      {(category === 'appearance' || category === 'themes') && <ThemeManager />}
      {category === 'editor' && <section className={styles.card} aria-labelledby="editor-settings-heading">
        <div className={styles.sectionHeading}><h2 id="editor-settings-heading">Editor defaults</h2><p>These preferences apply to this browser and take effect in every vault.</p></div>
        {editorPersistenceWarning && <p className={styles.message} role="alert">{editorPersistenceWarning}</p>}
        <div className={styles.editorOptions}>
          {(['lineNumbers', 'spellcheck', 'wordWrap', 'focusMode', 'typewriterMode'] as const).map((key) => <label key={key}><input type="checkbox" checked={editorPreferences[key]} onChange={(event) => onEditorPreferences({ ...editorPreferences, [key]: event.target.checked })} /> {{ lineNumbers: 'Line numbers', spellcheck: 'Spellcheck', wordWrap: 'Wrap lines', focusMode: 'Focus mode', typewriterMode: 'Typewriter mode' }[key]}</label>)}
          <Select label="Editor font" value={editorPreferences.fontFamily} onChange={(event) => onEditorPreferences({ ...editorPreferences, fontFamily: event.target.value as EditorPreferences['fontFamily'] })}><option value="sans">Sans serif</option><option value="serif">Serif</option><option value="mono">Monospace</option></Select>
          <label>Font size <output>{editorPreferences.fontSize} px</output><input type="range" min="11" max="28" value={editorPreferences.fontSize} onChange={(event) => onEditorPreferences({ ...editorPreferences, fontSize: Number(event.target.value) })} /></label>
          <label>Line height <output>{editorPreferences.lineHeight.toFixed(1)}</output><input type="range" min="1.2" max="2.5" step="0.1" value={editorPreferences.lineHeight} onChange={(event) => onEditorPreferences({ ...editorPreferences, lineHeight: Number(event.target.value) })} /></label>
        </div>
      </section>}
      {category === 'general' && <>
      <section className={styles.card} aria-labelledby="account-heading">
        <div className={styles.sectionHeading}><h2 id="account-heading">Account</h2><p>Sign-in is optional. Your vault remains available locally.</p></div>
        <div className={styles.dataLine}><ShieldCheck size={18} /><span>{account.user?.email ?? (account.configuration.kind === 'supabase' ? 'Not signed in' : 'Local-only workspace')}</span><span>{account.user ? 'Account connected' : 'No account required'}</span></div>
        <div className={styles.actions}><Link className="nn-button nn-button--secondary" href="/account/">{account.user ? 'Manage account' : 'Sign in or create account'}</Link></div>
      </section>
      </>}
      {category === 'sync' && <>
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
        </div> : <div className={styles.helper}><p>{account.configuration.kind === 'supabase' ? 'Connect an account to enable cloud sync. Your local vault remains available.' : 'Cloud sync needs a configured Supabase connection. Your local vault remains available.'}</p>{account.configuration.kind === 'supabase' && <Link className="nn-button nn-button--secondary" href="/account/">Sign in or create account</Link>}</div>}
        {sync.enabled && <label className={styles.helper}><input type="checkbox" checked={sync.attachments} onChange={(event) => { void sync.changeAttachments(event.target.checked).catch((error: unknown) => setSyncMessage(error instanceof Error ? error.message : 'Attachment sync could not be changed.')); }} /> Sync attachments</label>}
        </section>
      </>}
      {category === 'collaboration' && <section className={styles.card} aria-labelledby="collaboration-heading">
        <div className={styles.sectionHeading}><h2 id="collaboration-heading">Shared vault</h2><p>Invite accounts and manage access for this vault.</p></div>
        {syncMessage && <p className={styles.helper} role="status">{syncMessage}</p>}
        {sync.enabled && sync.encryption === 'none' && sync.role && <div className={styles.encryptionPanel}>
          <h3>Shared vault</h3><p>Your role: {sync.role}. Sharing is available for plaintext cloud vaults. Existing verified Noor Note accounts receive an invitation in the app; access begins when they accept.</p>
          {canManage(sync.role) && <><label>Invite account email<input type="email" value={shareEmail} onChange={(event) => setShareEmail(event.target.value)} /></label>
          <Select label="Invitation role" value={shareRole} onChange={(event) => setShareRole(memberRoleSchema.parse(event.target.value))}>{(['admin', 'editor', 'commenter', 'viewer'] as const).filter((item) => sync.role === 'owner' || item !== 'admin').map((item) => <option key={item} value={item}>{item[0].toUpperCase() + item.slice(1)}</option>)}</Select>
          <div className={styles.actions}><Button variant="secondary" disabled={!shareEmail.trim()} onClick={() => { void sync.shareVault(shareEmail, shareRole).then(async () => { setShareEmail(''); setSentInvites(await sync.listSentInvites()); setSyncMessage('Invitation created. The recipient must accept it in Settings.'); }).catch((error: unknown) => setSyncMessage(error instanceof Error ? error.message : 'Could not invite this account.')); }}>Send invitation</Button><Button variant="ghost" onClick={() => { void sync.listSentInvites().then(setSentInvites).catch((error: unknown) => setSyncMessage(error instanceof Error ? error.message : 'Could not list invitations.')); }}>Show pending invitations</Button></div>
          {sentInvites.map((invite) => <div className={styles.dataLine} key={invite.id}><span>{invite.email} · {invite.role} · pending</span><Button variant="ghost" disabled={sync.role === 'admin' && invite.role === 'admin'} onClick={() => { void sync.revokeInvite(invite.id).then(async () => { setSentInvites(await sync.listSentInvites()); setSyncMessage('Invitation revoked.'); }).catch((error: unknown) => setSyncMessage(error instanceof Error ? error.message : 'Could not revoke invitation.')); }}>Revoke</Button></div>)}</>}
          <div className={styles.actions}><Button variant="ghost" onClick={() => { void sync.listMembers().then(setMembers).catch((error: unknown) => setSyncMessage(error instanceof Error ? error.message : 'Could not list members.')); }}>Show members</Button>{sync.role !== 'owner' && <Button variant="secondary" onClick={() => { void sync.leaveVault().then(() => setSyncMessage('You left the cloud vault. Your downloaded local copy remains on this device.')).catch((error: unknown) => setSyncMessage(error instanceof Error ? error.message : 'Could not leave the vault.')); }}>Leave shared vault</Button>}</div>
          {members.map((member) => <div className={styles.dataLine} key={member.userId}><span>{member.email}</span>{canManage(sync.role) && (sync.role === 'owner' || member.role !== 'admin') ? <><Select label={`Role for ${member.email}`} value={member.role} onChange={(event) => { void sync.changeMemberRole(member.userId, memberRoleSchema.parse(event.target.value)).then(async () => { setMembers(await sync.listMembers()); setSyncMessage('Role updated.'); }).catch((error: unknown) => setSyncMessage(error instanceof Error ? error.message : 'Could not change role.')); }}>{(['admin', 'editor', 'commenter', 'viewer'] as const).filter((item) => sync.role === 'owner' || item !== 'admin').map((item) => <option key={item} value={item}>{item}</option>)}</Select><Button variant="ghost" onClick={() => { void sync.removeMember(member.userId).then(async () => { setMembers(await sync.listMembers()); setSyncMessage('Member removed.'); }).catch((error: unknown) => setSyncMessage(error instanceof Error ? error.message : 'Could not remove member.')); }}>Remove</Button>{sync.role === 'owner' && <Button variant="secondary" onClick={() => { void sync.requestTransfer(member.userId).then(() => setSyncMessage(`Ownership transfer offered to ${member.email}. They must accept within seven days; you remain owner until then.`)).catch((error: unknown) => setSyncMessage(error instanceof Error ? error.message : 'Could not request transfer.')); }}>Offer ownership</Button>}</> : <span>{member.role}</span>}</div>)}
          {sync.role === 'owner' && <Button variant="ghost" onClick={() => { void sync.cancelTransfer().then(() => setSyncMessage('Pending ownership transfer canceled.')).catch((error: unknown) => setSyncMessage(error instanceof Error ? error.message : 'Could not cancel transfer.')); }}>Cancel pending transfer</Button>}
        </div>}
        {sync.available && <div className={styles.encryptionPanel}><h3>Invitations and ownership offers</h3><div className={styles.actions}><Button variant="secondary" onClick={() => { void Promise.all([sync.listInvites(), sync.listTransfers()]).then(([nextInvites, nextTransfers]) => { setInvites(nextInvites); setTransfers(nextTransfers); }).catch((error: unknown) => setSyncMessage(error instanceof Error ? error.message : 'Could not load invitations.')); }}>Check invitations</Button></div>
          {invites.map((invite) => <div className={styles.dataLine} key={invite.id}><span>{invite.vault_name} · {invite.role}</span><Button variant="primary" onClick={() => { void sync.respondInvite(invite.id, true).then(async () => { setInvites(await sync.listInvites()); setCloudVaults(await sync.listRemoteVaults()); setSyncMessage('Invitation accepted. Download the shared vault below.'); }).catch((error: unknown) => setSyncMessage(error instanceof Error ? error.message : 'Could not accept invitation.')); }}>Accept</Button><Button variant="ghost" onClick={() => { void sync.respondInvite(invite.id, false).then(async () => setInvites(await sync.listInvites())).catch((error: unknown) => setSyncMessage(error instanceof Error ? error.message : 'Could not decline invitation.')); }}>Decline</Button></div>)}
          {transfers.map((transfer) => <div className={styles.dataLine} key={transfer.vault_id}><span>{transfer.vault_name} · offered by {transfer.from_email}</span><Button variant="primary" onClick={() => { void sync.respondTransfer(transfer.vault_id, true).then(async () => { setTransfers(await sync.listTransfers()); setSyncMessage('You now own this cloud vault.'); }).catch((error: unknown) => setSyncMessage(error instanceof Error ? error.message : 'Could not accept transfer.')); }}>Accept ownership</Button><Button variant="ghost" onClick={() => { void sync.respondTransfer(transfer.vault_id, false).then(async () => setTransfers(await sync.listTransfers())).catch((error: unknown) => setSyncMessage(error instanceof Error ? error.message : 'Could not decline transfer.')); }}>Decline</Button></div>)}
        </div>}
        {!sync.enabled && <p className={styles.helper}>Enable cloud sync to manage shared vaults.</p>}
      </section>}
      {category === 'sync' && <section className={styles.card} aria-labelledby="remote-vaults-heading"><div className={styles.sectionHeading}><h2 id="remote-vaults-heading">Remote vaults</h2><p>Download a vault from your account.</p></div>
        {sync.available && <div className={styles.actions}><Button variant="secondary" onClick={() => { void sync.listRemoteVaults().then(setCloudVaults).catch((error: unknown) => setSyncMessage(error instanceof Error ? error.message : 'Could not list cloud vaults.')); }}>Browse cloud vaults</Button></div>}
        {cloudVaults.filter((item) => !workspace.vaults.some((local) => local.id === item.id)).map((item) => <div key={item.id}><div className={styles.dataLine}><span>{item.name}{item.encrypted ? ' · encrypted' : item.shared ? ' · shared with you' : ''}</span><Button variant="secondary" onClick={() => {
          setSyncMessage(null);
          if (item.encrypted) { setRestoreId(item.id); return; }
          void sync.restoreRemoteVault(item.id).then(() => workspace.switchVault(item.id)).catch((error: unknown) => setSyncMessage(error instanceof Error ? error.message : 'Could not restore cloud vault.'));
        }}>{item.encrypted ? 'Recover vault' : 'Download vault'}</Button></div>{restoreId === item.id && <div className={styles.encryptionPanel}><p>Enter the recovery code and choose a new passphrase for this device.</p><label>Recovery code<input type="password" autoComplete="off" value={restoreCode} onChange={(event) => setRestoreCode(event.target.value)} /></label><label>New encryption passphrase<input type="password" autoComplete="new-password" value={restorePassphrase} onChange={(event) => setRestorePassphrase(event.target.value)} /></label><div className={styles.actions}><Button variant="primary" disabled={!restoreCode || restorePassphrase.length < 12} onClick={() => { void sync.restoreRemoteVault(item.id, restoreCode, restorePassphrase).then(async () => { setRestoreCode(''); setRestorePassphrase(''); setRestoreId(null); await workspace.switchVault(item.id); }).catch((error: unknown) => setSyncMessage(error instanceof Error ? error.message : 'Could not recover cloud vault.')); }}>Recover and download</Button><Button variant="secondary" onClick={() => { setRestoreId(null); setRestoreCode(''); setRestorePassphrase(''); }}>Cancel</Button></div></div>}</div>)}
      </section>}
      {category === 'ai' && <AiSettings />}
      {category === 'publishing' && <PublishingManager workspace={workspace} sync={sync} />}
      {category === 'privacy' && <PrivateShareManager key={`${vaultId ?? 'no-vault'}:${account.user?.id ?? 'local'}`} workspace={workspace} sync={sync} />}
      {category === 'advanced' && <KeyboardShortcuts commands={commands} overrides={shortcutOverrides} onChange={onShortcutChange} />}
      {category === 'templates' && <TemplateSettings workspace={workspace} onOpenNote={onOpenNote} onPreview={onPreviewTemplate} />}
      {category === 'daily-notes' && <PeriodNotesSettings workspace={workspace} />}
      {(category === 'general' || category === 'backup') && <>
      <section className={styles.card} aria-labelledby="data-heading">
        <div className={styles.sectionHeading}><h2 id="data-heading">Your data</h2><p>Notes and metadata are stored in this browser. Larger attachments use private browser file storage when available.</p></div>
        <div className={styles.dataLine}><HardDrive size={18} /><span>{workspace.notes.length} {workspace.notes.length === 1 ? 'note' : 'notes'} in this vault</span><span>{usage ?? 'Browser storage'}</span></div>
        <div className={styles.actions}><Button variant="secondary" onClick={onImport}><Upload size={16} /> Import Markdown or ZIP</Button><Button variant="secondary" onClick={onExport}><Download size={16} /> Export Center</Button><Button variant="secondary" onClick={onBackup}><Archive size={16} /> Backup Center</Button><Button variant="secondary" onClick={onRecovery}><LifeBuoy size={16} /> Recovery Center</Button></div>
        <p className={styles.helper}><ShieldCheck size={15} /> Export a ZIP before clearing browser data or moving to another device.</p>
      </section>
      </>}
      {category === 'general' && <>
      <section className={styles.card} aria-labelledby="app-heading">
        <div className={styles.sectionHeading}><h2 id="app-heading">Offline app</h2><p>Install Noor Note for a standalone window. Vault notes stay in this browser and remain available offline after the app shell is ready.</p></div>
        <p className={styles.helper} role="status">{pwa.online ? pwa.offlineReady ? 'Online · App shell ready for offline use' : 'Online · Preparing offline app shell' : 'Offline · Local vault remains available'}{pwa.installed ? ' · Installed' : ''}</p>
        {pwa.error && <p role="alert">{pwa.error}</p>}
        <div className={styles.actions}>
          {pwa.installAvailable && <Button variant="secondary" onClick={() => { void pwa.install(); }}>Install Noor Note</Button>}
          {pwa.updateAvailable && <Button variant="secondary" onClick={() => { void pwa.applyUpdate(workspace.flushPending); }}>Update now</Button>}
        </div>
        {!pwa.installed && !pwa.installAvailable && <p className={styles.helper}>If your browser supports installation, use its Install app or Add to Home Screen menu.</p>}
        <p className={styles.helper}>Offline readiness covers the app shell. Optional OCR and transcription files are cached after first use; browser storage can still be cleared or evicted.</p>
      </section>
      </>}
      {category === 'files-links' && <>
      <section className={styles.card} aria-labelledby="directory-heading">
        <div className={styles.sectionHeading}><h2 id="directory-heading">Connected folder</h2><p>Write portable Markdown and attachments to a folder you choose. This is a manual export.</p></div>
        {directorySupported ? <><div className={styles.dataLine}><FolderOpen size={18} /><span>{directory?.name ?? 'No folder connected'}</span></div><div className={styles.actions}>
          <Button variant="secondary" onClick={() => { void connect(); }}>{directory ? 'Change folder' : 'Connect folder'}</Button>
          {directory && <><Button variant="primary" onClick={() => { void writeFiles(); }}>Write files</Button><Button variant="ghost" onClick={() => { if (vault && repository) void repository.disconnectDirectory(vault.id).then(() => { setDirectory(null); setMessage('Folder disconnected.'); }); }}>Disconnect</Button></>}
        </div></> : <p className={styles.helper}>Folder access is unavailable in this browser. ZIP export remains available.</p>}
      </section>
      <section className={styles.card} aria-labelledby="file-sort-heading"><div className={styles.sectionHeading}><h2 id="file-sort-heading">File tree sorting</h2><p>Saved with this vault.</p></div><Select label="Sort files by" value={vault?.settings.sortBy ?? 'name'} disabled={!vault} onChange={(event) => { void workspace.updateVaultSettings({ sortBy: event.target.value === 'updatedAt' ? 'updatedAt' : 'name' }).catch(() => setMessage('Could not save file sorting.')); }}><option value="name">Name</option><option value="updatedAt">Last modified</option></Select><Select label="Sort direction" value={vault?.settings.sortDirection ?? 'asc'} disabled={!vault} onChange={(event) => { void workspace.updateVaultSettings({ sortDirection: event.target.value === 'desc' ? 'desc' : 'asc' }).catch(() => setMessage('Could not save file sorting.')); }}><option value="asc">Ascending</option><option value="desc">Descending</option></Select></section>
      </>}
      {category === 'bases' && vaultId && <MetadataSchemaManager vaultId={vaultId} folders={workspace.folders} repository={repository} onPut={workspace.putMetadataSchema} onDelete={workspace.deleteMetadataSchema} />}
      {category === 'plugins' && <PluginManager host={pluginHost} />}
      {category === 'security' && <section className={styles.card}><div className={styles.sectionHeading}><h2>Account and vault protection</h2><p>Manage sign-in and encrypted sync.</p></div><div className={styles.actions}><Link className="nn-button nn-button--secondary" href="/account/">Manage account</Link><Button variant="secondary" onClick={() => setCategory('sync')}>Encryption and sync</Button></div></section>}
      {category === 'tasks' && <section className={styles.card}><h2>Task views</h2><p className={styles.helper}>Saved task queries belong to this vault. Manage them in the task dashboard.</p><Button variant="secondary" onClick={() => onNavigate('tasks')}>Open tasks</Button></section>}
      {category === 'calendar' && <section className={styles.card}><h2>Calendar</h2><p className={styles.helper}>Calendar layout is saved with the current workspace. Daily and periodic note rules are under Daily Notes.</p><div className={styles.actions}><Button variant="secondary" onClick={() => onNavigate('periods')}>Open calendar</Button><Button variant="secondary" onClick={() => setCategory('daily-notes')}>Daily Notes settings</Button></div></section>}
      {category === 'graph' && <section className={styles.card}><h2>Graph</h2><p className={styles.helper}>Graph filters and layout are saved with the current workspace. Configure them in Graph.</p><Button variant="secondary" onClick={() => onNavigate('graph')}>Open graph</Button></section>}
      {category === 'canvas' && <section className={styles.card}><h2>Canvas</h2><p className={styles.helper}>Canvas controls are available on each canvas. There are no global Canvas preferences yet.</p><Button variant="secondary" onClick={() => onNavigate('canvas')}>Open Canvas</Button></section>}
      {category === 'search' && <section className={styles.card}><h2>Search</h2><p className={styles.helper}>Recent and saved searches belong to the active vault. Search mode and sorting are chosen in the search panel.</p><Button variant="secondary" onClick={() => onNavigate('notes')}>Open notes</Button></section>}
      {category === 'about' && <>
      <section className={styles.card} aria-labelledby="about-heading">
        <div className={styles.sectionHeading}><h2 id="about-heading">About Noor Note</h2><p>A calmer place to collect and connect your ideas.</p></div>
        <div className={styles.about}><Info size={19} /><div><strong>Local-first workspace</strong><span>Markdown-first and private by default. Cloud sync is optional and must be enabled for each vault.</span></div></div>
        <div className={styles.actions}><Button variant="secondary" onClick={onShowTour}>Show quick tour</Button></div>
      </section>
      </>}
    </div>
    </div>
    <Dialog open={dialog !== null} onOpenChange={(open) => { if (!open) setDialog(null); }} title={dialog === 'create' ? 'Create vault' : dialog === 'rename' ? 'Rename vault' : 'Delete vault'} description={dialog === 'delete' ? 'This vault will be hidden from the active list. Its local data remains in browser storage.' : undefined}>
      <form className={styles.dialogForm} onSubmit={(event) => { event.preventDefault(); void submitVault(); }}>
        {dialog !== 'delete' && <><label htmlFor="settings-vault-name">Vault name</label><input id="settings-vault-name" autoFocus required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} /></>}
        <div className={styles.actions}><Button type="button" variant="secondary" onClick={() => setDialog(null)}>Cancel</Button><Button type="submit" variant={dialog === 'delete' ? 'danger' : 'primary'}>{dialog === 'delete' ? 'Delete vault' : dialog === 'rename' ? 'Rename' : 'Create'}</Button></div>
      </form>
    </Dialog>
  </main>;
}
