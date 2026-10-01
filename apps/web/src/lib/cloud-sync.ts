import type { SupabaseClient } from '@supabase/supabase-js';
import { sha256 } from '@noble/hashes/sha2.js';
import { z } from 'zod';
import { checksumMarkdown, type Attachment, type Vault, type VaultNote } from '@noor-note/core';
import { createVaultEncryption, recoverVault, unlockVault, type VaultCipher, type VaultEncryptionProfile } from '@noor-note/crypto';
import type { VaultRepository } from '@noor-note/storage';
import { attachmentObjectPath, encryptedSyncRecordSchema, nextRetryDelay, noteFingerprint, pushResultSchema, remoteRecordSchema, syncFingerprint, syncRecordSchema, type RemotePayload, type RemoteRecord, type SyncRecord } from './cloud-sync-types';
import { CloudSyncStore, type SyncQueueItem } from './cloud-sync-store';
import { VaultEncryptionStore } from './vault-encryption-store';
import { CollabStore } from './collab-store';
import { canEdit, vaultRoleSchema, type VaultRole } from './sharing';

export type SyncStatus = 'disabled' | 'synced' | 'syncing' | 'offline' | 'pending' | 'error';
export interface SyncSnapshot { status: SyncStatus; pending: number; error: string | null; lastSyncedAt: number | null }
const initialSnapshot: SyncSnapshot = { status: 'disabled', pending: 0, error: null, lastSyncedAt: null };
const vaultRowSchema = z.object({ id: z.uuid(), owner_id: z.uuid(), storage_owner_id: z.uuid(), name: z.string(), encryption_mode: z.enum(['none', 'e2ee']).default('none') });

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function hex(bytes: Uint8Array): string { return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(''); }
export async function checksumSyncRecord(record: RemotePayload): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(record)))));
}
export async function checksumBlob(blob: Blob): Promise<string> {
  const hash = sha256.create();
  const reader = blob.stream().getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
    }
    return hex(hash.digest());
  } finally { reader.releaseLock(); }
}
function message(error: unknown): string { return error instanceof Error ? error.message : 'Unknown cloud sync error'; }
function isOnline(): boolean { return typeof navigator === 'undefined' || navigator.onLine; }

export class CloudSyncEngine {
  private running = false;
  private cipher: VaultCipher | null = null;
  private remoteOwnerId: string;
  private remoteRole: VaultRole | null = null;
  private accessLost = false;
  private pendingProfile: VaultEncryptionProfile | null = null;
  private snapshot: SyncSnapshot = initialSnapshot;
  private readonly listeners = new Set<(snapshot: SyncSnapshot) => void>();
  private readonly onRemoteChange?: () => void;
  private readonly beforeLocalScan?: () => Promise<void>;
  constructor(
    private readonly client: SupabaseClient,
    private readonly repository: VaultRepository,
    private readonly store: CloudSyncStore,
    readonly ownerId: string,
    readonly vaultId: string,
    onRemoteChange?: () => void,
    beforeLocalScan?: () => Promise<void>,
    private readonly encryptionStore?: VaultEncryptionStore,
  ) { this.onRemoteChange = onRemoteChange; this.beforeLocalScan = beforeLocalScan; this.remoteOwnerId = ownerId; }
  isOwner(): boolean { return this.remoteRole === 'owner'; }
  role(): VaultRole | null { return this.remoteRole; }
  async recordRevisionRestore(noteId: string, sourceRevisionId: string): Promise<void> {
    const vault = await this.repository.getVault(this.vaultId);
    if (!vault || vault.settings.syncEncryptionMode === 'e2ee') return;
    await this.store.enqueueRevisionActivity(this.ownerId, this.vaultId, noteId, sourceRevisionId);
    void this.run();
  }
  isUnlocked(): boolean { return this.cipher !== null; }
  async hasEncryption(): Promise<boolean> { return Boolean(await this.encryptionStore?.profile(this.vaultId)); }
  async configureEncryption(passphrase: string): Promise<string> {
    if (!this.encryptionStore) throw new Error('Encryption storage is unavailable');
    if (this.pendingProfile) throw new Error('Save or cancel the current recovery code first');
    if (await this.encryptionStore.profile(this.vaultId)) throw new Error('This vault already has an encryption key');
    if ((await this.store.preference(this.ownerId, this.vaultId)).enabled || await this.store.hasEverSynced(this.ownerId, this.vaultId)) throw new Error('Create a new vault to use encryption. Previously synchronized plaintext cannot be made private retroactively.');
    if (!isOnline()) throw new Error('Connect to the internet before protecting a vault for sync');
    const remote = await this.client.from('noor_sync_vaults').select('id').eq('id', this.vaultId).maybeSingle();
    if (remote.error) throw remote.error;
    if (remote.data) throw new Error('This vault already exists in the cloud. Create a new vault for encrypted sync.');
    const created = await createVaultEncryption(this.vaultId, passphrase);
    this.pendingProfile = created.profile;
    this.cipher = created.cipher;
    return created.recoveryCode;
  }
  async confirmEncryption(): Promise<void> {
    if (!this.pendingProfile || !this.encryptionStore) throw new Error('No recovery code is awaiting confirmation');
    await this.repository.updateVaultSettings(this.vaultId, { syncEncryptionMode: 'e2ee' });
    await this.encryptionStore.save(this.pendingProfile);
    this.pendingProfile = null;
  }
  cancelPendingEncryption(): void { this.pendingProfile = null; this.cipher = null; }
  async unlockEncryption(passphrase: string): Promise<void> {
    const profile = await this.encryptionStore?.profile(this.vaultId);
    if (!profile) throw new Error('This vault has no local encryption key');
    this.cipher = await unlockVault(profile, passphrase);
    await this.run();
  }
  async recoverLocalEncryption(recoveryCode: string, newPassphrase: string): Promise<void> {
    if (!this.encryptionStore) throw new Error('Encryption storage is unavailable');
    const vault = await this.repository.getVault(this.vaultId);
    if (vault?.settings.syncEncryptionMode !== 'e2ee') throw new Error('This local vault is not marked as encrypted');
    if (await this.hasEncryption()) throw new Error('This vault already has a local encryption key');
    const { data, error } = await this.client.from('noor_sync_records')
      .select('vault_id,kind,item_id,version,sequence,revision_id,checksum,payload,device_id,updated_at')
      .eq('vault_id', this.vaultId).eq('kind', 'vault').eq('item_id', this.vaultId).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('No encrypted cloud snapshot is available for this vault');
    const remote = remoteRecordSchema.parse(data);
    if (await checksumSyncRecord(remote.payload) !== remote.checksum || remote.payload.kind !== 'vault' || !('sealed' in remote.payload) || !remote.payload.recovery || remote.payload.recovery.vaultId !== this.vaultId) throw new Error('Remote recovery envelope is invalid');
    const recovered = await recoverVault(remote.payload.recovery, recoveryCode, newPassphrase);
    const record = syncRecordSchema.parse(await recovered.cipher.openJson('vault', this.vaultId, remote.payload.sealed));
    if (record.kind !== 'vault' || record.item.id !== this.vaultId || record.item.settings.syncEncryptionMode !== 'e2ee') throw new Error('Encrypted vault identity mismatch');
    await this.encryptionStore.save(recovered.profile);
    this.cipher = recovered.cipher;
    await this.run();
  }
  lockEncryption(): void { this.cipher = null; this.publish({ ...this.snapshot, status: 'error', error: 'Encrypted vault is locked. Unlock it to sync.' }); }
  subscribe(listener: (snapshot: SyncSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => { this.listeners.delete(listener); };
  }
  getSnapshot(): SyncSnapshot { return this.snapshot; }
  private publish(next: SyncSnapshot): void {
    this.snapshot = next;
    for (const listener of this.listeners) listener(next);
  }
  async enable(attachments = true): Promise<void> {
    const vault = await this.repository.getVault(this.vaultId);
    if (!vault) throw new Error('Local vault is unavailable');
    if (this.pendingProfile) throw new Error('Save and confirm the recovery code before enabling sync');
    if (vault.settings.syncEncryptionMode === 'e2ee' && !this.cipher) throw new Error('Unlock this encrypted vault before enabling sync');
    if (await this.hasEncryption() && !this.cipher) throw new Error('Unlock this encrypted vault before enabling sync');
    await this.store.setPreference(this.ownerId, this.vaultId, { enabled: true, attachments });
    await this.run();
  }
  async disable(): Promise<void> {
    const preference = await this.store.preference(this.ownerId, this.vaultId);
    await this.store.setPreference(this.ownerId, this.vaultId, { ...preference, enabled: false });
    this.publish({ ...this.snapshot, status: 'disabled' });
  }
  async setAttachments(enabled: boolean): Promise<void> {
    const preference = await this.store.preference(this.ownerId, this.vaultId);
    await this.store.setPreference(this.ownerId, this.vaultId, { ...preference, attachments: enabled });
    if (enabled && !preference.attachments) await this.store.resetCursor(this.ownerId, this.vaultId);
    await this.run();
  }
  async load(): Promise<void> {
    const preference = await this.store.preference(this.ownerId, this.vaultId);
    const pending = await this.store.pendingCount(this.ownerId, this.vaultId);
    this.publish({ ...this.snapshot, status: preference.enabled ? isOnline() ? 'syncing' : 'offline' : 'disabled', pending });
  }
  async listRemoteVaults(): Promise<{ id: string; name: string; encrypted: boolean; shared: boolean }[]> {
    const { data, error } = await this.client.from('noor_sync_vaults').select('id,owner_id,storage_owner_id,name,encryption_mode').order('created_at');
    if (error) throw error;
    const vaults = z.array(vaultRowSchema).parse(data);
    const snapshots = await this.client.from('noor_sync_records').select('vault_id,payload').eq('kind', 'vault');
    if (snapshots.error) throw snapshots.error;
    const names = new Map<string, string>();
    for (const row of z.array(z.object({ vault_id: z.uuid(), payload: z.unknown() })).parse(snapshots.data)) {
      const parsed = remoteRecordSchema.shape.payload.safeParse(row.payload);
      if (parsed.success && parsed.data.kind === 'vault' && !('sealed' in parsed.data) && parsed.data.item.id === row.vault_id) names.set(row.vault_id, parsed.data.item.name);
    }
    return vaults.map(({ id, name, owner_id, encryption_mode }) => ({ id, name: names.get(id) ?? name, encrypted: encryption_mode === 'e2ee', shared: owner_id !== this.ownerId }));
  }
  async restoreRemoteVault(remoteVaultId: string, recoveryCode?: string, newPassphrase?: string): Promise<void> {
    const id = z.uuid().parse(remoteVaultId);
    const { data, error } = await this.client.from('noor_sync_records')
      .select('vault_id,kind,item_id,version,sequence,revision_id,checksum,payload,device_id,updated_at')
      .eq('vault_id', id).eq('kind', 'vault').eq('item_id', id).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('This cloud vault has no synchronized snapshot yet');
    const remote = remoteRecordSchema.parse(data);
    if (remote.payload.kind !== 'vault' || await checksumSyncRecord(remote.payload) !== remote.checksum) throw new Error('Remote vault snapshot is invalid');
    let record: SyncRecord;
    let targetCipher: VaultCipher | null = null;
    if ('sealed' in remote.payload) {
      if (!recoveryCode || !newPassphrase || !this.encryptionStore || !remote.payload.recovery) throw new Error('Recovery code and a new passphrase are required for this encrypted vault');
      if (remote.payload.recovery.vaultId !== id) throw new Error('Remote recovery envelope identity mismatch');
      const recovered = await recoverVault(remote.payload.recovery, recoveryCode, newPassphrase);
      targetCipher = recovered.cipher;
      record = syncRecordSchema.parse(await targetCipher.openJson('vault', id, remote.payload.sealed));
      if (record.kind !== 'vault' || record.item.id !== id) throw new Error('Encrypted vault identity mismatch');
      if (record.item.settings.syncEncryptionMode !== 'e2ee') throw new Error('Encrypted vault marker is missing');
      await this.encryptionStore.save(recovered.profile);
    } else record = remote.payload;
    if (record.kind !== 'vault') throw new Error('Remote vault snapshot has the wrong kind');
    await this.repository.importSyncedVault(record.item);
    await this.store.acceptRemote(this.ownerId, id, record, remote.version);
    await this.store.setPreference(this.ownerId, id, { enabled: true, attachments: true });
    const engine = new CloudSyncEngine(this.client, this.repository, this.store, this.ownerId, id, this.onRemoteChange, this.beforeLocalScan, this.encryptionStore);
    engine.cipher = targetCipher;
    await engine.run();
    if (engine.getSnapshot().status === 'error') throw new Error(engine.getSnapshot().error ?? 'Cloud vault download failed');
    this.publish(engine.getSnapshot());
  }
  private async ensureRemoteVault(vault: Vault): Promise<void> {
    if ((vault.settings.syncEncryptionMode === 'e2ee') !== Boolean(this.cipher)) throw new Error('Local vault encryption mode does not match the unlocked key');
    if (this.cipher && this.cipher.vaultId !== vault.id) throw new Error('Unlocked vault key identity mismatch');
    const { data, error } = await this.client.from('noor_sync_vaults').select('id,owner_id,storage_owner_id,name,encryption_mode').eq('id', vault.id).maybeSingle();
    if (error) throw error;
    if (data) {
      const row = vaultRowSchema.parse(data);
      if (row.owner_id !== this.ownerId && row.encryption_mode !== 'none') throw new Error('Encrypted vault sharing is unavailable');
      this.remoteOwnerId = row.storage_owner_id;
      this.accessLost = false;
      if (row.owner_id === this.ownerId) this.remoteRole = 'owner';
      else {
        const access = await this.client.rpc('noor_vault_role', { p_vault_id: vault.id });
        if (access.error) throw access.error;
        const parsed = vaultRoleSchema.nullable().parse(access.data);
        if (!parsed) { this.remoteRole = null; this.accessLost = true; throw new Error('Your access to this shared vault has ended'); }
        this.remoteRole = parsed;
      }
      if ((row.encryption_mode === 'e2ee') !== Boolean(this.cipher)) throw new Error('Cloud vault encryption mode does not match the local vault');
      return;
    }
    if (await this.store.hasEverSynced(this.ownerId, this.vaultId)) {
      this.remoteRole = null;
      this.accessLost = true;
      throw new Error('This cloud vault is unavailable or your access has ended. Your local copy remains on this device.');
    }
    const inserted = await this.client.from('noor_sync_vaults').insert({ id: vault.id, owner_id: this.ownerId, name: this.cipher ? 'Encrypted vault' : vault.name, encryption_mode: this.cipher ? 'e2ee' : 'none' });
    if (inserted.error) throw inserted.error;
    this.remoteRole = 'owner';
  }
  async run(): Promise<void> {
    if (this.running) return;
    const preference = await this.store.preference(this.ownerId, this.vaultId);
    if (!preference.enabled) { await this.load(); return; }
    const localVault = await this.repository.getVault(this.vaultId);
    if ((localVault?.settings.syncEncryptionMode === 'e2ee' || await this.hasEncryption()) && !this.cipher) {
      this.publish({ ...this.snapshot, status: 'error', error: 'Encrypted vault is locked. Unlock it to sync.', pending: await this.store.pendingCount(this.ownerId, this.vaultId) });
      return;
    }
    try { await this.beforeLocalScan?.(); }
    catch (error) { this.publish({ ...this.snapshot, status: 'error', error: `Local save failed: ${message(error)}` }); return; }
    if (!isOnline()) {
      try {
        const localErrors = !this.accessLost && (this.remoteRole === null || canEdit(this.remoteRole)) ? await this.reconcile(preference.attachments) : [];
        this.publish({ ...this.snapshot, status: 'offline', error: localErrors[0] ?? null, pending: await this.store.pendingCount(this.ownerId, this.vaultId) });
      } catch (error) {
        this.publish({ ...this.snapshot, status: 'offline', error: message(error), pending: await this.store.pendingCount(this.ownerId, this.vaultId) });
      }
      return;
    }
    this.running = true;
    this.publish({ ...this.snapshot, status: 'syncing', error: null });
    const errors: string[] = [];
    try {
      const vault = await this.repository.getVault(this.vaultId);
      if (!vault) throw new Error('Local vault is unavailable');
      await this.ensureRemoteVault(vault);
      if (canEdit(this.remoteRole)) errors.push(...await this.reconcile(preference.attachments));
      try { await this.pull(preference.attachments); } catch (error) { errors.push(message(error)); }
      if (canEdit(this.remoteRole)) errors.push(...await this.reconcile(preference.attachments));
      const due = canEdit(this.remoteRole) ? await this.store.due(this.ownerId, this.vaultId) : [];
      for (const item of due) {
        const currentPreference = await this.store.preference(this.ownerId, this.vaultId);
        if (!currentPreference.enabled) break;
        if (item.kind === 'attachment' && !currentPreference.attachments) continue;
        try { await this.push(item); }
        catch (error) {
          const reason = message(error);
          errors.push(reason);
          await this.store.fail(item, reason, Date.now() + nextRetryDelay(item.attempts));
        }
      }
      if (canEdit(this.remoteRole) && !this.cipher) {
        for (const item of await this.store.dueRevisionActivities(this.ownerId, this.vaultId)) {
          if (await this.store.hasPending(this.ownerId, this.vaultId, 'note', item.noteId)) continue;
          try {
            const result = await this.client.rpc('noor_record_revision_restore', {
              p_vault: this.vaultId, p_note: item.noteId, p_source_revision: item.sourceRevisionId, p_event: item.id,
            });
            if (result.error) throw result.error;
            await this.store.acknowledgeRevisionActivity(item.id);
          } catch (error) {
            const reason = message(error);
            errors.push(reason);
            await this.store.failRevisionActivity(item, reason, Date.now() + nextRetryDelay(item.attempts));
          }
        }
      }
      if (canEdit(this.remoteRole)) errors.push(...await this.reconcile(preference.attachments));
      const pending = await this.store.pendingCount(this.ownerId, this.vaultId);
      if (!canEdit(this.remoteRole) && pending > 0) errors.push('Your current vault role cannot upload locally queued changes. The local copy remains on this device.');
      const currentPreference = await this.store.preference(this.ownerId, this.vaultId);
      this.publish({
        status: !currentPreference.enabled ? 'disabled' : errors.length ? 'error' : pending ? 'pending' : 'synced',
        pending, error: errors[0] ?? null,
        lastSyncedAt: errors.length || pending ? this.snapshot.lastSyncedAt : Date.now(),
      });
    } catch (error) {
      let reason = message(error);
      try {
        const localErrors = !this.accessLost && (this.remoteRole === null || canEdit(this.remoteRole)) ? await this.reconcile(preference.attachments) : [];
        if (localErrors.length) reason = `${reason}; ${localErrors[0]}`;
      } catch (localError) { reason = `${reason}; ${message(localError)}`; }
      this.publish({ ...this.snapshot, status: 'error', error: reason, pending: await this.store.pendingCount(this.ownerId, this.vaultId) });
    } finally { this.running = false; }
  }
  private async digestAttachment(attachment: Attachment): Promise<string | null> {
    if (attachment.deletedAt) return null;
    const signature = `${attachment.id}:${attachment.size}:${attachment.createdAt}`;
    const cached = await this.store.attachmentDigest(attachment.id, signature);
    if (cached) return cached;
    const blob = await this.repository.getAttachmentBlob(attachment.id);
    if (!blob) throw new Error(`Attachment ${attachment.name} is missing its local bytes`);
    const checksum = await checksumBlob(blob);
    await this.store.saveAttachmentDigest(attachment.id, signature, checksum);
    return checksum;
  }
  private async reconcile(includeAttachments: boolean): Promise<string[]> {
    const errors: string[] = [];
    const vault = await this.repository.getVault(this.vaultId);
    if (!vault) return errors;
    const known = await this.store.knownFingerprints(this.ownerId, this.vaultId);
    const needsRecord = (record: SyncRecord) => {
      const previous = known.get(CloudSyncStore.itemKey(this.ownerId, this.vaultId, record.kind, record.item.id));
      const fingerprint = syncFingerprint(record);
      return previous?.pending !== fingerprint && (previous?.ledger !== fingerprint || previous.pending !== null);
    };
    const vaultRecord: SyncRecord = { kind: 'vault', item: vault };
    if (this.isOwner() && needsRecord(vaultRecord)) await this.store.enqueue(this.ownerId, this.vaultId, vaultRecord);
    const [tree, trash] = await Promise.all([this.repository.listTree(this.vaultId), this.repository.listTrash(this.vaultId)]);
    for (const folder of [...tree.folders, ...trash.folders]) {
      const record: SyncRecord = { kind: 'folder', item: folder };
      if (needsRecord(record)) await this.store.enqueue(this.ownerId, this.vaultId, record);
    }
    for (const entry of [...tree.notes, ...trash.notes]) {
      if (entry.collaborative) {
        const collabStore = new CollabStore();
        try { if (await collabStore.hasDocument(entry.id)) continue; }
        finally { collabStore.close(); }
      }
      const previous = known.get(CloudSyncStore.itemKey(this.ownerId, this.vaultId, 'note', entry.id));
      const fingerprint = noteFingerprint(entry);
      if (previous?.pending === fingerprint || previous?.ledger === fingerprint && previous.pending === null) continue;
      const note = await this.repository.getNote(entry.id);
      if (note) await this.store.enqueue(this.ownerId, this.vaultId, { kind: 'note', item: note });
    }
    if (includeAttachments) {
      for (const attachment of [...tree.attachments, ...trash.attachments]) {
        try {
          const checksum = await this.digestAttachment(attachment);
          const record: SyncRecord = { kind: 'attachment', item: attachment, checksum };
          if (needsRecord(record)) await this.store.enqueue(this.ownerId, this.vaultId, record);
        } catch (error) {
          errors.push(message(error));
        }
      }
    }
    for (const tombstone of await this.repository.listSyncTombstones(this.vaultId)) {
      if (tombstone.kind === 'attachment' && !includeAttachments) continue;
      const record: SyncRecord = tombstone.kind === 'attachment' ? { ...tombstone, checksum: null } : tombstone;
      if (needsRecord(record)) await this.store.enqueue(this.ownerId, this.vaultId, record);
    }
    return errors;
  }
  private async push(item: SyncQueueItem): Promise<void> {
    const latest = await this.store.ledger(this.ownerId, this.vaultId, item.kind, item.itemId);
    const record = item.record;
    let blobChecksum: string | undefined;
    if (record.kind === 'attachment' && !record.item.deletedAt && record.checksum) {
      const blob = await this.repository.getAttachmentBlob(item.itemId);
      if (!blob) throw new Error(`Attachment ${record.item.name} is missing its local bytes`);
      const checksum = await checksumBlob(blob);
      if (checksum !== record.checksum) throw new Error('Attachment changed during upload');
      const bytes = this.cipher ? await this.cipher.sealAttachment(item.itemId, blob) : blob;
      blobChecksum = this.cipher ? await checksumBlob(bytes) : undefined;
      const path = attachmentObjectPath(this.remoteOwnerId, this.vaultId, item.itemId, blobChecksum ?? checksum);
      const uploaded = await this.client.storage.from('noor-note-attachments').upload(path, bytes, { upsert: true, contentType: this.cipher ? 'application/octet-stream' : record.item.mime });
      if (uploaded.error) throw uploaded.error;
    }
    const payload: RemotePayload = this.cipher ? encryptedSyncRecordSchema.parse({
      kind: record.kind, item: { id: record.item.id, vaultId: this.vaultId },
      sealed: await this.cipher.sealJson(record.kind, record.item.id, record),
      ...(blobChecksum ? { blobChecksum } : {}),
      ...(record.kind === 'vault' ? { recovery: (await this.encryptionStore?.profile(this.vaultId))?.recovery } : {}),
    }) : record;
    const checksum = await checksumSyncRecord(payload);
    const { data, error } = await this.client.rpc('noor_push_sync_record', {
      p_operation_id: item.id, p_vault_id: this.vaultId, p_kind: item.kind, p_item_id: item.itemId,
      p_expected_version: latest?.version ?? 0, p_revision_id: item.revisionId,
      p_checksum: checksum, p_payload: payload, p_device_id: await this.store.deviceId(),
    });
    if (error) throw error;
    const result = pushResultSchema.parse(data);
    if (result.status === 'applied') {
      await this.store.acknowledge(item, result.version);
    } else {
      await this.applyRemote(result.current, true);
      await this.store.discard(item);
    }
  }
  private async pull(includeAttachments: boolean): Promise<void> {
    let cursor = await this.store.cursor(this.ownerId, this.vaultId);
    for (let page = 0; page < 20; page += 1) {
      if (!(await this.store.preference(this.ownerId, this.vaultId)).enabled) return;
      const { data, error } = await this.client.from('noor_sync_records')
        .select('vault_id,kind,item_id,version,sequence,revision_id,checksum,payload,device_id,updated_at')
        .eq('vault_id', this.vaultId).gt('sequence', cursor).order('sequence').limit(100);
      if (error) throw error;
      const records = z.array(remoteRecordSchema).parse(data);
      if (!records.length) return;
      let failed = false;
      let firstError: string | null = null;
      for (const record of records) {
        try {
          if (record.kind === 'attachment' && !includeAttachments) {
            if (!failed) {
              await this.store.advanceCursor(this.ownerId, this.vaultId, record.sequence);
              cursor = record.sequence;
            }
            continue;
          }
          await this.applyRemote(record, false);
          if (!failed) {
            await this.store.advanceCursor(this.ownerId, this.vaultId, record.sequence);
            cursor = record.sequence;
          }
        } catch (error) {
          failed = true;
          firstError ??= message(error);
        }
      }
      if (failed) throw new Error(firstError ?? 'Remote change could not be applied');
      if (records.length < 100) return;
    }
  }
  private async applyRemote(remote: RemoteRecord, force: boolean): Promise<void> {
    if (remote.vault_id !== this.vaultId || remote.item_id !== remote.payload.item.id || remote.kind !== remote.payload.kind) throw new Error('Remote record identity mismatch');
    if (await checksumSyncRecord(remote.payload) !== remote.checksum) throw new Error('Remote record checksum mismatch');
    let record: SyncRecord;
    if ('sealed' in remote.payload) {
      if (!this.cipher) throw new Error('Unlock this encrypted vault before downloading changes');
      record = syncRecordSchema.parse(await this.cipher.openJson(remote.kind, remote.item_id, remote.payload.sealed));
      if (record.kind !== remote.kind || record.item.id !== remote.item_id || (record.kind !== 'vault' && record.item.vaultId !== this.vaultId)) throw new Error('Encrypted record identity mismatch');
    } else {
      if (await this.hasEncryption()) throw new Error('Plaintext record in an encrypted vault');
      record = remote.payload;
    }
    const ledger = await this.store.ledger(this.ownerId, this.vaultId, record.kind, record.item.id);
    if (!force && ledger && ledger.version >= remote.version) return;
    if (!force && await this.store.hasPending(this.ownerId, this.vaultId, record.kind, record.item.id)) return;
    if (record.kind === 'vault') {
      await this.repository.importSyncedVault(record.item);
    } else if (record.kind === 'folder') {
      await this.repository.applySyncedFolder(record.item);
      if (record.purged) await this.repository.permanentlyDeleteFolder(record.item.id);
    } else if (record.kind === 'note') {
      if (await checksumMarkdown(record.item.markdown) !== record.item.checksum) throw new Error('Remote note Markdown checksum mismatch');
      const local = await this.repository.getNote(record.item.id);
      if (local && syncFingerprint({ kind: 'note', item: local }) !== syncFingerprint(record) &&
        (!ledger || syncFingerprint({ kind: 'note', item: local }) !== ledger.fingerprint)) {
        await this.preserveNoteConflict(local);
      }
      await this.repository.applySyncedNote(record.item);
      if (record.purged) await this.repository.permanentlyDeleteNote(record.item.id);
    } else {
      const local = await this.findLocalAttachment(record.item.id);
      const localChecksum = local && !local.deletedAt ? await this.digestAttachment(local) : null;
      let blob: Blob | null = null;
      if (!record.item.deletedAt && record.checksum && localChecksum !== record.checksum) {
        const remoteChecksum = 'sealed' in remote.payload ? remote.payload.blobChecksum : record.checksum;
        if (!remoteChecksum) throw new Error('Encrypted attachment checksum is missing');
        const path = attachmentObjectPath(this.remoteOwnerId, this.vaultId, record.item.id, remoteChecksum);
        const downloaded = await this.client.storage.from('noor-note-attachments').download(path);
        if (downloaded.error) throw downloaded.error;
        if (await checksumBlob(downloaded.data) !== remoteChecksum) throw new Error('Downloaded attachment checksum mismatch');
        blob = 'sealed' in remote.payload ? await this.cipher!.openAttachment(record.item.id, downloaded.data, record.item.mime) : downloaded.data;
        if (await checksumBlob(blob) !== record.checksum) throw new Error('Decrypted attachment checksum mismatch');
      }
      if (local && !local.deletedAt) {
        const changedLocally = !ledger || syncFingerprint({ kind: 'attachment', item: local, checksum: localChecksum }) !== ledger.fingerprint;
        if (changedLocally) {
          const bytes = await this.repository.getAttachmentBlob(local.id);
          if (bytes) {
            const suffix = ` (conflict ${crypto.randomUUID().slice(0, 8)})`;
            await this.repository.addAttachment(local.vaultId, local.folderId, bytes, `${local.name.slice(0, 200 - suffix.length)}${suffix}`);
          }
        }
      }
      await this.repository.applySyncedAttachment(record.item, blob);
      if (record.purged) await this.repository.permanentlyDeleteAttachment(record.item.id);
      if (record.checksum) await this.store.saveAttachmentDigest(record.item.id, `${record.item.id}:${record.item.size}:${record.item.createdAt}`, record.checksum);
    }
    await this.store.acceptRemote(this.ownerId, this.vaultId, record, remote.version);
    this.onRemoteChange?.();
  }
  private async preserveNoteConflict(note: VaultNote): Promise<void> {
    const suffix = ` (conflict ${new Date().toISOString().slice(0, 10)})`;
    const title = `${(note.title || 'Untitled').slice(0, 200 - suffix.length)}${suffix}`;
    const copy = await this.repository.createNote(note.vaultId, note.folderId, title, note.markdown);
    if (note.aliases.length || Object.keys(note.properties).length) await this.repository.saveNote(copy.id, { aliases: note.aliases, properties: note.properties });
  }
  private async findLocalAttachment(id: string): Promise<Attachment | undefined> {
    const [tree, trash] = await Promise.all([this.repository.listTree(this.vaultId), this.repository.listTrash(this.vaultId)]);
    return [...tree.attachments, ...trash.attachments].find((item) => item.id === id);
  }
}
