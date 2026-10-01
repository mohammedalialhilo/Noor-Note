'use client';

import { Button } from '@noor-note/ui';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import type { useVaultWorkspace } from '../hooks/useVaultWorkspace';
import type { useCloudSync } from '../hooks/useCloudSync';
import { useAccount } from '../auth/AuthProvider';
import { publicSnapshotMarkdown } from '../lib/publishing';
import styles from './PrivateShareManager.module.css';

const shareSchema = z.object({
  id: z.uuid(), vault_id: z.uuid(), note_id: z.uuid(), title: z.string(),
  password_required: z.boolean(), expires_at: z.string().nullable(), download_allowed: z.boolean(),
  created_at: z.string(), revoked_at: z.string().nullable(),
});
const createdSchema = z.object({ id: z.uuid(), token: z.string().regex(/^[0-9a-f]{64}$/u) });
type Share = z.infer<typeof shareSchema>;
type Expiry = '7-days' | '30-days' | 'custom' | 'never';

export function PrivateShareManager({ workspace, sync }: { workspace: ReturnType<typeof useVaultWorkspace>; sync: ReturnType<typeof useCloudSync> }) {
  const account = useAccount();
  const vaultId = workspace.activeVault?.id;
  const [shares, setShares] = useState<Share[]>([]);
  const [noteId, setNoteId] = useState('');
  const [expiry, setExpiry] = useState<Expiry>('7-days');
  const [customExpiry, setCustomExpiry] = useState('');
  const [password, setPassword] = useState('');
  const [downloadAllowed, setDownloadAllowed] = useState(false);
  const [approved, setApproved] = useState(false);
  const [createdLink, setCreatedLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [now, setNow] = useState(0);
  const available = Boolean(account.client && account.user && vaultId && sync.enabled && sync.encryption === 'none' && (sync.role === 'owner' || sync.role === 'admin'));

  useEffect(() => {
    const update = () => setNow(Date.now());
    const initial = window.setTimeout(update, 0);
    const interval = window.setInterval(update, 60_000);
    return () => { window.clearTimeout(initial); window.clearInterval(interval); };
  }, []);

  useEffect(() => {
    if (!available || !account.client || !vaultId) return;
    let active = true;
    const client = account.client;
    void (async () => {
      try {
        const { data, error } = await client.from('noor_private_shares').select('id,vault_id,note_id,title,password_required,expires_at,download_allowed,created_at,revoked_at')
          .eq('vault_id', vaultId).order('created_at', { ascending: false });
        if (!active) return;
        if (error) throw error;
        setShares(shareSchema.array().parse(data));
      } catch { if (active) setMessage('Could not load private shares. Apply the private-share migration and check your connection.'); }
    })();
    return () => { active = false; };
  }, [account.client, available, vaultId]);

  const reload = async () => {
    if (!account.client || !vaultId) return;
    const { data, error } = await account.client.from('noor_private_shares').select('id,vault_id,note_id,title,password_required,expires_at,download_allowed,created_at,revoked_at')
      .eq('vault_id', vaultId).order('created_at', { ascending: false });
    if (error) throw error;
    setShares(shareSchema.array().parse(data));
  };

  const create = async () => {
    if (!available || !account.client || !vaultId || !workspace.repository || !approved || !noteId) return;
    setBusy(true); setMessage(''); setCreatedLink('');
    try {
      if (password && (password.length < 12 || new TextEncoder().encode(password).length > 72)) throw new Error('The optional password must contain at least 12 characters and at most 72 UTF-8 bytes.');
      let expiresAt: string | null = null;
      if (expiry === '7-days') expiresAt = new Date(Date.now() + 7 * 86400_000).toISOString();
      if (expiry === '30-days') expiresAt = new Date(Date.now() + 30 * 86400_000).toISOString();
      if (expiry === 'custom') {
        const parsed = new Date(customExpiry);
        if (!customExpiry || Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now() + 60_000 || parsed.getTime() > Date.now() + 365 * 86400_000) throw new Error('Choose an expiration between one minute and one year from now.');
        expiresAt = parsed.toISOString();
      }
      await workspace.flushPending();
      const note = await workspace.repository.getNote(noteId);
      if (!note || note.deletedAt || note.vaultId !== vaultId) throw new Error('The selected note is unavailable.');
      const { data, error } = await account.client.rpc('noor_create_private_share', {
        p_vault_id: vaultId, p_note_id: note.id, p_title: note.title,
        p_markdown: publicSnapshotMarkdown(note.markdown), p_expires_at: expiresAt,
        p_password: password || null, p_download_allowed: downloadAllowed,
      });
      if (error) throw error;
      const created = createdSchema.parse(data);
      setCreatedLink(`${window.location.origin}/s/${created.token}`);
      setPassword(''); setApproved(false);
      await reload();
      setMessage('Private link created. Copy it now; Noor Note does not store the original link token.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not create the private link.'); }
    finally { setBusy(false); }
  };

  const revoke = async (shareId: string) => {
    if (!account.client) return;
    setBusy(true); setMessage('');
    try {
      const { error } = await account.client.rpc('noor_revoke_private_share', { p_share_id: shareId });
      if (error) throw error;
      await reload();
      setCreatedLink('');
      setMessage('Link revoked. Existing password sessions can no longer open it.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not revoke this link.'); }
    finally { setBusy(false); }
  };

  return <section className={styles.card} aria-labelledby="private-sharing-heading">
    <h2 id="private-sharing-heading">Private share links</h2>
    <p>Share one view-only note snapshot by secret link. These links are separate from public publishing and are never listed on your public site.</p>
    {!available ? <p role="status">Private links require a signed-in account, enabled plaintext cloud sync, and Owner or Admin access. Local-only and encrypted vaults stay private.</p> : <>
      <div className={styles.form}>
        <label>Note<select value={noteId} onChange={(event) => { setNoteId(event.target.value); setApproved(false); }}><option value="">Choose a note</option>{workspace.notes.filter((note) => !note.deletedAt).map((note) => <option key={note.id} value={note.id}>{note.path}</option>)}</select></label>
        <label>Expiration<select value={expiry} onChange={(event) => setExpiry(event.target.value as Expiry)}><option value="7-days">7 days</option><option value="30-days">30 days</option><option value="custom">Choose date and time</option><option value="never">No expiration</option></select></label>
        {expiry === 'custom' && <label>Expires at<input type="datetime-local" value={customExpiry} onChange={(event) => setCustomExpiry(event.target.value)} /></label>}
        <label>Optional password<input type="password" autoComplete="new-password" minLength={12} maxLength={72} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Leave blank for token-only access" /></label>
        <label className={styles.check}><input type="checkbox" checked={downloadAllowed} onChange={(event) => setDownloadAllowed(event.target.checked)} /> Allow Markdown download</label>
        <label className={styles.check}><input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} /> I approve sharing this note body with anyone who has the link and, if set, its password. Linked notes and local attachments are not included.</label>
        <Button variant="primary" disabled={busy || !noteId || !approved} onClick={() => { void create(); }}>Create private link</Button>
      </div>
      {createdLink && <div className={styles.created}><strong>Copy this link now</strong><input aria-label="New private share link" readOnly value={createdLink} onFocus={(event) => event.target.select()} /><Button variant="secondary" onClick={() => { void navigator.clipboard.writeText(createdLink).then(() => setMessage('Link copied.')).catch(() => setMessage('Copy failed. Select the link field and copy it manually.')); }}>Copy link</Button></div>}
      <h3>Existing links</h3>
      {shares.length === 0 && <p>No private links created for this vault.</p>}
      {shares.map((share) => {
        const expired = Boolean(share.expires_at && Date.parse(share.expires_at) <= now);
        const active = !share.revoked_at && !expired;
        return <div className={styles.row} key={share.id}><div><strong>{share.title}</strong><span>{share.revoked_at ? 'Revoked' : expired ? 'Expired' : 'Active'} · {share.password_required ? 'Password protected' : 'Token only'} · {share.download_allowed ? 'Download allowed' : 'View only'}{share.expires_at ? ` · Expires ${new Date(share.expires_at).toLocaleString()}` : ''}</span></div>{active && <Button variant="secondary" disabled={busy} onClick={() => { void revoke(share.id); }}>Revoke now</Button>}</div>;
      })}
    </>}
    {message && <p role="status" className={styles.message}>{message}</p>}
  </section>;
}
