'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { VaultRepository } from '@noor-note/storage';
import { useAccount } from '../auth/AuthProvider';
import { CloudSyncEngine, type SyncSnapshot } from '../lib/cloud-sync';
import { CloudSyncStore } from '../lib/cloud-sync-store';
import { VaultEncryptionStore } from '../lib/vault-encryption-store';
import { z } from 'zod';
import { memberRoleSchema, vaultRoleSchema, type MemberRole, type VaultRole } from '../lib/sharing';

const initialSnapshot: SyncSnapshot = { status: 'disabled', pending: 0, error: null, lastSyncedAt: null };

export function useCloudSync(repository: VaultRepository | null, vaultId: string | null, refresh: () => Promise<void>, flushPending: () => Promise<void>) {
  const { client, user } = useAccount();
  const userId = user?.id;
  const [snapshot, setSnapshot] = useState<SyncSnapshot>(initialSnapshot);
  const [enabled, setEnabled] = useState(false);
  const [role, setRole] = useState<VaultRole | null>(null);
  const [attachments, setAttachments] = useState(true);
  const [encryption, setEncryption] = useState<'none' | 'pending' | 'locked' | 'unlocked' | 'recovery'>('none');
  const [pendingRecoveryCode, setPendingRecoveryCode] = useState<string | null>(null);
  const engineRef = useRef<CloudSyncEngine | null>(null);
  const storeRef = useRef<CloudSyncStore | null>(null);
  const encryptionStoreRef = useRef<VaultEncryptionStore | null>(null);
  const refreshRef = useRef(refresh);
  const flushRef = useRef(flushPending);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);
  useEffect(() => { flushRef.current = flushPending; }, [flushPending]);

  useEffect(() => {
    if (!client || !userId || !repository || !vaultId) {
      queueMicrotask(() => { setEnabled(false); setRole(null); setEncryption('none'); setPendingRecoveryCode(null); setSnapshot(initialSnapshot); });
      return;
    }
    queueMicrotask(() => { setEnabled(false); setRole(null); setEncryption('none'); setPendingRecoveryCode(null); setSnapshot(initialSnapshot); });
    const store = new CloudSyncStore();
    const encryptionStore = new VaultEncryptionStore();
    const engine = new CloudSyncEngine(client, repository, store, userId, vaultId, () => { void refreshRef.current(); }, () => flushRef.current(), encryptionStore);
    engineRef.current = engine;
    storeRef.current = store;
    encryptionStoreRef.current = encryptionStore;
    const unsubscribe = engine.subscribe(setSnapshot);
    let active = true;
    void Promise.all([store.preference(userId, vaultId), encryptionStore.profile(vaultId), repository.getVault(vaultId)]).then(([preference, profile, vault]) => {
      if (!active) return;
      setEnabled(preference.enabled);
      setAttachments(preference.attachments);
      setEncryption(profile ? 'locked' : vault?.settings.syncEncryptionMode === 'e2ee' ? 'recovery' : 'none');
      return engine.load().then(() => engine.run()).then(() => { if (active) setRole(engine.role()); });
    }).catch((error: unknown) => {
      if (active) setSnapshot({ ...initialSnapshot, status: 'error', error: error instanceof Error ? error.message : 'Could not open sync queue' });
    });
    const tick = () => { if (document.visibilityState === 'visible') void engine.run().then(() => { if (active) setRole(engine.role()); }); };
    const interval = window.setInterval(tick, 15_000);
    window.addEventListener('online', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      active = false;
      unsubscribe();
      window.clearInterval(interval);
      window.removeEventListener('online', tick);
      document.removeEventListener('visibilitychange', tick);
      if (engineRef.current === engine) engineRef.current = null;
      if (storeRef.current === store) storeRef.current = null;
      if (encryptionStoreRef.current === encryptionStore) encryptionStoreRef.current = null;
      void store.close();
      encryptionStore.close();
    };
  }, [client, userId, repository, vaultId]);

  const enable = useCallback(async () => {
    if (!engineRef.current) throw new Error('Sign in to enable cloud sync');
    await engineRef.current.enable(attachments);
    setRole(engineRef.current.role());
    setEnabled(true);
  }, [attachments]);
  const disable = useCallback(async () => {
    if (!engineRef.current) return;
    await engineRef.current.disable();
    setEnabled(false);
  }, []);
  const changeAttachments = useCallback(async (value: boolean) => {
    if (!engineRef.current) return;
    await engineRef.current.setAttachments(value);
    setAttachments(value);
  }, []);
  const syncNow = useCallback(async () => { await engineRef.current?.run(); setRole(engineRef.current?.role() ?? null); }, []);
  const recordRevisionRestore = useCallback(async (noteId: string, sourceRevisionId: string) => {
    if (!engineRef.current || !enabled) return;
    await engineRef.current.recordRevisionRestore(z.uuid().parse(noteId), z.uuid().parse(sourceRevisionId));
  }, [enabled]);
  const protectVault = useCallback(async (passphrase: string): Promise<string> => {
    if (!engineRef.current) throw new Error('Sign in before enabling encrypted sync');
    const code = await engineRef.current.configureEncryption(passphrase);
    setPendingRecoveryCode(code);
    setEncryption('pending');
    return code;
  }, []);
  const confirmEncryption = useCallback(async () => {
    if (!engineRef.current) throw new Error('Cloud sync is unavailable');
    await engineRef.current.confirmEncryption();
    setPendingRecoveryCode(null);
    setEncryption('unlocked');
  }, []);
  const cancelPendingEncryption = useCallback(() => { engineRef.current?.cancelPendingEncryption(); setPendingRecoveryCode(null); setEncryption('none'); }, []);
  const unlockVaultSync = useCallback(async (passphrase: string): Promise<void> => {
    if (!engineRef.current) throw new Error('Cloud sync is unavailable');
    await engineRef.current.unlockEncryption(passphrase);
    setEncryption('unlocked');
  }, []);
  const recoverLocalEncryption = useCallback(async (recoveryCode: string, newPassphrase: string): Promise<void> => {
    if (!engineRef.current) throw new Error('Cloud sync is unavailable');
    await engineRef.current.recoverLocalEncryption(recoveryCode, newPassphrase);
    setEncryption('unlocked');
  }, []);
  const lockVaultSync = useCallback(() => { engineRef.current?.lockEncryption(); setEncryption('locked'); }, []);
  const listRemoteVaults = useCallback(async () => engineRef.current?.listRemoteVaults() ?? [], []);
  const restoreRemoteVault = useCallback(async (id: string, recoveryCode?: string, newPassphrase?: string) => {
    if (!engineRef.current) throw new Error('Sign in to restore a cloud vault');
    await engineRef.current.restoreRemoteVault(id, recoveryCode, newPassphrase);
  }, []);
  const shareVault = useCallback(async (email: string, memberRole: MemberRole): Promise<void> => {
    if (!client || !vaultId) throw new Error('Sign in and open a vault before sharing');
    const result = await client.rpc('noor_invite_vault_member', { p_vault_id: vaultId, p_email: z.email().parse(email.trim()), p_role: memberRoleSchema.parse(memberRole) });
    if (result.error) throw result.error;
  }, [client, vaultId]);
  const listMembers = useCallback(async (): Promise<{ userId: string; email: string; role: MemberRole }[]> => {
    if (!client || !vaultId) return [];
    const result = await client.rpc('noor_list_vault_members', { p_vault_id: vaultId });
    if (result.error) throw result.error;
    return z.array(z.object({ user_id: z.uuid(), email: z.email(), role: memberRoleSchema })).parse(result.data).map((item) => ({ userId: item.user_id, email: item.email, role: item.role }));
  }, [client, vaultId]);
  const removeMember = useCallback(async (memberId: string): Promise<void> => {
    if (!client || !vaultId) throw new Error('Sign in and open a vault before removing a member');
    const result = await client.rpc('noor_remove_vault_member', { p_vault_id: vaultId, p_user_id: z.uuid().parse(memberId) });
    if (result.error) throw result.error;
  }, [client, vaultId]);
  const changeMemberRole = useCallback(async (memberId: string, memberRole: MemberRole): Promise<void> => {
    if (!client || !vaultId) throw new Error('Sign in and open a vault before changing a role');
    const result = await client.rpc('noor_change_vault_member_role', { p_vault_id: vaultId, p_user_id: z.uuid().parse(memberId), p_role: memberRoleSchema.parse(memberRole) });
    if (result.error) throw result.error;
  }, [client, vaultId]);
  const leaveVault = useCallback(async (): Promise<void> => {
    if (!client || !vaultId) throw new Error('Sign in and open a shared vault before leaving');
    const result = await client.rpc('noor_leave_vault', { p_vault_id: vaultId });
    if (result.error) throw result.error;
    await engineRef.current?.disable();
    setEnabled(false); setRole(null);
  }, [client, vaultId]);
  const requestTransfer = useCallback(async (memberId: string): Promise<void> => {
    if (!client || !vaultId) throw new Error('Sign in and open a vault before transferring ownership');
    const result = await client.rpc('noor_request_vault_transfer', { p_vault_id: vaultId, p_user_id: z.uuid().parse(memberId) });
    if (result.error) throw result.error;
  }, [client, vaultId]);
  const cancelTransfer = useCallback(async (): Promise<void> => {
    if (!client || !vaultId) throw new Error('Sign in and open a vault before canceling a transfer');
    const result = await client.rpc('noor_cancel_vault_transfer', { p_vault_id: vaultId });
    if (result.error) throw result.error;
  }, [client, vaultId]);
  const listInvites = useCallback(async () => {
    if (!client) return [];
    const result = await client.rpc('noor_list_vault_invites');
    if (result.error) throw result.error;
    return z.array(z.object({ id: z.uuid(), vault_id: z.uuid(), vault_name: z.string(), role: memberRoleSchema, expires_at: z.iso.datetime({ offset: true }) })).parse(result.data);
  }, [client]);
  const listSentInvites = useCallback(async () => {
    if (!client || !vaultId) return [];
    const result = await client.rpc('noor_list_sent_vault_invites', { p_vault_id: vaultId });
    if (result.error) throw result.error;
    return z.array(z.object({ id: z.uuid(), email: z.email(), role: memberRoleSchema, expires_at: z.iso.datetime({ offset: true }) })).parse(result.data);
  }, [client, vaultId]);
  const revokeInvite = useCallback(async (inviteId: string): Promise<void> => {
    if (!client || !vaultId) throw new Error('Sign in and open a vault before revoking an invitation');
    const result = await client.rpc('noor_revoke_vault_invite', { p_vault_id: vaultId, p_invite_id: z.uuid().parse(inviteId) });
    if (result.error) throw result.error;
  }, [client, vaultId]);
  const respondInvite = useCallback(async (inviteId: string, accept: boolean): Promise<void> => {
    if (!client) throw new Error('Sign in to respond to an invitation');
    const result = await client.rpc('noor_respond_vault_invite', { p_invite_id: z.uuid().parse(inviteId), p_accept: accept });
    if (result.error) throw result.error;
  }, [client]);
  const listTransfers = useCallback(async () => {
    if (!client) return [];
    const result = await client.rpc('noor_list_vault_transfers');
    if (result.error) throw result.error;
    return z.array(z.object({ vault_id: z.uuid(), vault_name: z.string(), from_email: z.email(), expires_at: z.iso.datetime({ offset: true }) })).parse(result.data);
  }, [client]);
  const respondTransfer = useCallback(async (targetVaultId: string, accept: boolean): Promise<void> => {
    if (!client) throw new Error('Sign in to respond to a transfer');
    const result = await client.rpc('noor_respond_vault_transfer', { p_vault_id: z.uuid().parse(targetVaultId), p_accept: accept });
    if (result.error) throw result.error;
    if (targetVaultId === vaultId) await syncNow();
  }, [client, vaultId, syncNow]);
  const isOwner = useCallback(() => engineRef.current?.isOwner() ?? false, []);
  return { snapshot, enabled, role: role === null ? null : vaultRoleSchema.parse(role), attachments, encryption, pendingRecoveryCode, available: Boolean(client && user), enable, disable, changeAttachments, syncNow, recordRevisionRestore, protectVault, confirmEncryption, cancelPendingEncryption, unlockVaultSync, recoverLocalEncryption, lockVaultSync, listRemoteVaults, restoreRemoteVault, shareVault, listMembers, removeMember, changeMemberRole, leaveVault, requestTransfer, cancelTransfer, listInvites, listSentInvites, revokeInvite, respondInvite, listTransfers, respondTransfer, isOwner };
}
