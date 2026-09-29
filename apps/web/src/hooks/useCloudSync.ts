'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { VaultRepository } from '@noor-note/storage';
import { useAccount } from '../auth/AuthProvider';
import { CloudSyncEngine, type SyncSnapshot } from '../lib/cloud-sync';
import { CloudSyncStore } from '../lib/cloud-sync-store';
import { VaultEncryptionStore } from '../lib/vault-encryption-store';

const initialSnapshot: SyncSnapshot = { status: 'disabled', pending: 0, error: null, lastSyncedAt: null };

export function useCloudSync(repository: VaultRepository | null, vaultId: string | null, refresh: () => Promise<void>, flushPending: () => Promise<void>) {
  const { client, user } = useAccount();
  const userId = user?.id;
  const [snapshot, setSnapshot] = useState<SyncSnapshot>(initialSnapshot);
  const [enabled, setEnabled] = useState(false);
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
      queueMicrotask(() => { setEnabled(false); setEncryption('none'); setPendingRecoveryCode(null); setSnapshot(initialSnapshot); });
      return;
    }
    queueMicrotask(() => { setEnabled(false); setEncryption('none'); setPendingRecoveryCode(null); setSnapshot(initialSnapshot); });
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
      return engine.load().then(() => engine.run());
    }).catch((error: unknown) => {
      if (active) setSnapshot({ ...initialSnapshot, status: 'error', error: error instanceof Error ? error.message : 'Could not open sync queue' });
    });
    const tick = () => { if (document.visibilityState === 'visible') void engine.run(); };
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
  const syncNow = useCallback(async () => { await engineRef.current?.run(); }, []);
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
  return { snapshot, enabled, attachments, encryption, pendingRecoveryCode, available: Boolean(client && user), enable, disable, changeAttachments, syncNow, protectVault, confirmEncryption, cancelPendingEncryption, unlockVaultSync, recoverLocalEncryption, lockVaultSync, listRemoteVaults, restoreRemoteVault };
}
