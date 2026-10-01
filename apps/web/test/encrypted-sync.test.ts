import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DexieVaultRepository, type AttachmentBytesStore } from '@noor-note/storage';
import type { Attachment } from '@noor-note/core';
import { CloudSyncEngine, checksumBlob, checksumSyncRecord } from '../src/lib/cloud-sync';
import { CloudSyncStore } from '../src/lib/cloud-sync-store';
import { VaultEncryptionStore } from '../src/lib/vault-encryption-store';
import type { RemoteRecord } from '../src/lib/cloud-sync-types';

const opened: Array<{ repository: DexieVaultRepository; store: CloudSyncStore; encryption: VaultEncryptionStore; names: string[] }> = [];
afterEach(async () => {
  for (const item of opened.splice(0)) {
    item.repository.close(); await item.store.close(); item.encryption.close();
    for (const name of item.names) await Dexie.delete(name);
  }
  vi.unstubAllGlobals();
});

function localDevice() {
  const names = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const blobs = new Map<string, Blob>();
  const bytes: AttachmentBytesStore = {
    async write(id, blob) { blobs.set(id, blob); return 'indexeddb'; },
    async read(item: Attachment) { return blobs.get(item.id); },
    async remove(item: Attachment) { blobs.delete(item.id); },
  };
  const repository = new DexieVaultRepository(names[0], bytes);
  const store = new CloudSyncStore(names[1]);
  const encryption = new VaultEncryptionStore(names[2]);
  opened.push({ repository, store, encryption, names });
  return { repository, store, encryption };
}

describe('encrypted sync boundary', () => {
  it('uploads opaque records and attachment bytes, then recovers on another device', async () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', { onLine: true });
    const first = localDevice(), second = localDevice();
    const owner = crypto.randomUUID();
    const vault = await first.repository.initialize();
    const note = await first.repository.createNote(vault.id, null, 'Secret plan', 'private research body');
    const attachment = await first.repository.addAttachment(vault.id, null, new Blob(['private attachment'], { type: 'text/plain' }), 'secret.txt');
    const vaultRows: Array<{ id: string; owner_id: string; storage_owner_id: string; name: string; encryption_mode: string }> = [];
    const records: RemoteRecord[] = [];
    const uploaded = new Map<string, Blob>();
    const client = {
      from(table: string) {
        if (table === 'noor_sync_vaults') return {
          select: () => ({ eq: (_column: string, id: string) => ({ maybeSingle: async () => ({ data: vaultRows.find((row) => row.id === id) ?? null, error: null }) }) }),
          insert: async (value: { id: string; owner_id: string; name: string; encryption_mode: string }) => { vaultRows.push({ ...value, storage_owner_id: value.owner_id }); return { error: null }; },
        };
        const filters: Array<[string, string]> = [];
        let after = 0;
        const query = {
          eq(column: string, value: string) { filters.push([column, value]); return query; },
          gt(_column: string, value: number) { after = value; return query; },
          order() { return query; },
          async limit() { return { data: records.filter((row) => row.sequence > after && filters.every(([key, value]) => String(row[key as keyof RemoteRecord]) === value)), error: null }; },
          async maybeSingle() { return { data: records.find((row) => filters.every(([key, value]) => String(row[key as keyof RemoteRecord]) === value)) ?? null, error: null }; },
        };
        return { select: () => query };
      },
      storage: { from: () => ({ upload: async (path: string, blob: Blob) => { uploaded.set(path, blob); return { error: null }; }, download: async (path: string) => ({ data: uploaded.get(path), error: null }) }) },
      async rpc(_name: string, args: Record<string, unknown>) {
        const row = { vault_id: args.p_vault_id, kind: args.p_kind, item_id: args.p_item_id, version: 1, sequence: records.length + 1, revision_id: args.p_revision_id, checksum: args.p_checksum, payload: args.p_payload, device_id: args.p_device_id, updated_at: new Date().toISOString() } as RemoteRecord;
        records.push(row);
        return { data: { status: 'applied', version: 1, sequence: row.sequence }, error: null };
      },
    } as unknown as SupabaseClient;

    const uploader = new CloudSyncEngine(client, first.repository, first.store, owner, vault.id, undefined, undefined, first.encryption);
    const recoveryCode = await uploader.configureEncryption('correct horse battery staple');
    await expect(uploader.enable()).rejects.toThrow(/Confirm|confirm|Save/);
    await uploader.confirmEncryption();
    await uploader.enable();
    expect(uploader.getSnapshot().status).toBe('synced');
    expect(vaultRows[0]?.name).toBe('Encrypted vault');
    expect(vaultRows[0]?.encryption_mode).toBe('e2ee');
    expect(records.map((row) => row.kind)).toEqual(['vault', 'note', 'attachment']);
    for (const row of records) {
      expect('sealed' in row.payload).toBe(true);
      expect(JSON.stringify(row.payload)).not.toMatch(/Secret plan|private research body|secret\.txt|private attachment/);
    }
    const ciphertext = [...uploaded.values()][0]!;
    expect(await checksumBlob(ciphertext)).toBe((records[2]!.payload as { blobChecksum: string }).blobChecksum);
    expect(await ciphertext.text()).not.toContain('private attachment');

    await second.repository.initialize();
    const downloader = new CloudSyncEngine(client, second.repository, second.store, owner, vault.id, undefined, undefined, second.encryption);
    const vaultRecord = records[0]!;
    const originalPayload = vaultRecord.payload;
    if (!('sealed' in originalPayload) || !originalPayload.recovery) throw new Error('Expected encrypted vault record');
    const wrongVaultPayload = { ...originalPayload, recovery: { ...originalPayload.recovery, vaultId: crypto.randomUUID() } };
    vaultRecord.payload = wrongVaultPayload;
    vaultRecord.checksum = await checksumSyncRecord(wrongVaultPayload);
    await expect(downloader.restoreRemoteVault(vault.id, recoveryCode, 'different strong passphrase')).rejects.toThrow(/identity mismatch/i);
    vaultRecord.payload = originalPayload;
    vaultRecord.checksum = await checksumSyncRecord(originalPayload);
    await expect(downloader.restoreRemoteVault(vault.id, `NNR1-${'A'.repeat(43)}`, 'different strong passphrase')).rejects.toThrow(/recovery code/i);
    expect(await second.repository.getVault(vault.id)).toBeUndefined();
    await downloader.restoreRemoteVault(vault.id, recoveryCode, 'different strong passphrase');
    expect(downloader.getSnapshot().status).toBe('synced');
    expect((await second.repository.getNote(note.id))?.markdown).toBe('private research body');
    expect(await (await second.repository.getAttachmentBlob(attachment.id))?.text()).toBe('private attachment');
    await downloader.unlockEncryption('different strong passphrase');
    const downgrade = { kind: 'note' as const, item: { ...note, markdown: 'server plaintext' } };
    records.push({ ...records[1]!, sequence: 4, version: 2, payload: downgrade, checksum: await checksumSyncRecord(downgrade) });
    await downloader.run();
    expect(downloader.getSnapshot().error).toMatch(/Plaintext record/);
    expect((await second.repository.getNote(note.id))?.markdown).toBe('private research body');
    records.pop();
    uploader.lockEncryption();
    await first.repository.saveNote(note.id, { markdown: 'more private work' });
    await uploader.run();
    expect(uploader.getSnapshot()).toMatchObject({ status: 'error', error: 'Encrypted vault is locked. Unlock it to sync.' });
    expect(records).toHaveLength(3);
    const missingProfileName = crypto.randomUUID();
    const missingProfile = new VaultEncryptionStore(missingProfileName);
    try {
      const recovering = new CloudSyncEngine(client, first.repository, first.store, owner, vault.id, undefined, undefined, missingProfile);
      await recovering.run();
      expect(recovering.getSnapshot().error).toMatch(/locked/i);
      expect(records).toHaveLength(3);
      await expect(recovering.recoverLocalEncryption(`NNR1-${'A'.repeat(43)}`, 'replacement passphrase')).rejects.toThrow(/recovery code/i);
      expect(await missingProfile.profile(vault.id)).toBeNull();
      await recovering.recoverLocalEncryption(recoveryCode, 'replacement passphrase');
      expect(await missingProfile.profile(vault.id)).not.toBeNull();
      expect(['synced', 'pending']).toContain(recovering.getSnapshot().status);
      expect(records.every((row) => 'sealed' in row.payload)).toBe(true);
    } finally { missingProfile.close(); await Dexie.delete(missingProfileName); }
  });
});
