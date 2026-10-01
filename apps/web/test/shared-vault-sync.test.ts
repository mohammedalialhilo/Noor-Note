import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DexieVaultRepository, type AttachmentBytesStore } from '@noor-note/storage';
import type { Attachment } from '@noor-note/core';
import { CloudSyncEngine, checksumBlob, checksumSyncRecord } from '../src/lib/cloud-sync';
import { CloudSyncStore } from '../src/lib/cloud-sync-store';
import { attachmentObjectPath, type RemoteRecord, type SyncRecord } from '../src/lib/cloud-sync-types';

const opened: Array<{ repository: DexieVaultRepository; store: CloudSyncStore; names: string[] }> = [];
afterEach(async () => {
  for (const item of opened.splice(0)) {
    item.repository.close(); await item.store.close();
    for (const name of item.names) await Dexie.delete(name);
  }
  vi.unstubAllGlobals();
});
function device() {
  const names = [crypto.randomUUID(), crypto.randomUUID()];
  const blobs = new Map<string, Blob>();
  const bytes: AttachmentBytesStore = {
    async write(id, blob) { blobs.set(id, blob); return 'indexeddb'; },
    async read(item: Attachment) { return blobs.get(item.id); },
    async remove(item: Attachment) { blobs.delete(item.id); },
  };
  const repository = new DexieVaultRepository(names[0]!, bytes), store = new CloudSyncStore(names[1]!);
  opened.push({ repository, store, names });
  return { repository, store };
}

describe('shared plaintext vault sync', () => {
  it('restores a collaborator vault and downloads attachments from the owner path', async () => {
    vi.stubGlobal('window', {}); vi.stubGlobal('navigator', { onLine: true });
    const owner = crypto.randomUUID(), member = crypto.randomUUID();
    const original = device(), recipient = device();
    const vault = await original.repository.initialize();
    const note = await original.repository.createNote(vault.id, null, 'Shared', 'Collaboration starts here');
    const attachment = await original.repository.addAttachment(vault.id, null, new Blob(['shared bytes']), 'data.txt');
    const blob = (await original.repository.getAttachmentBlob(attachment.id))!;
    const blobChecksum = await checksumBlob(blob);
    const payloads: SyncRecord[] = [{ kind: 'vault', item: vault }, { kind: 'note', item: note }, { kind: 'attachment', item: attachment, checksum: blobChecksum }];
    const records: RemoteRecord[] = await Promise.all(payloads.map(async (payload, index) => ({
      vault_id: vault.id, kind: payload.kind, item_id: payload.item.id, version: 1, sequence: index + 1,
      revision_id: crypto.randomUUID(), checksum: await checksumSyncRecord(payload), payload,
      device_id: crypto.randomUUID(), updated_at: new Date().toISOString(),
    })));
    const expectedPath = attachmentObjectPath(owner, vault.id, attachment.id, blobChecksum);
    const downloadedPaths: string[] = [];
    const client = {
      from(table: string) {
        if (table === 'noor_sync_vaults') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: vault.id, owner_id: owner, storage_owner_id: owner, name: vault.name, encryption_mode: 'none' }, error: null }) }) }) };
        const filters: Array<[string, string]> = []; let after = 0;
        const query = {
          eq(column: string, value: string) { filters.push([column, value]); return query; },
          gt(_column: string, value: number) { after = value; return query; },
          order() { return query; },
          async limit() { return { data: records.filter((row) => row.sequence > after && filters.every(([key, value]) => String(row[key as keyof RemoteRecord]) === value)), error: null }; },
          async maybeSingle() { return { data: records.find((row) => filters.every(([key, value]) => String(row[key as keyof RemoteRecord]) === value)) ?? null, error: null }; },
        };
        return { select: () => query };
      },
      storage: { from: () => ({ download: async (path: string) => { downloadedPaths.push(path); return { data: blob, error: null }; } }) },
      rpc: vi.fn(async () => ({ data: 'editor', error: null })),
    } as unknown as SupabaseClient;
    await recipient.repository.initialize();
    const engine = new CloudSyncEngine(client, recipient.repository, recipient.store, member, vault.id);
    await engine.restoreRemoteVault(vault.id);
    expect(engine.getSnapshot().status).toBe('synced');
    expect((await recipient.repository.getNote(note.id))?.markdown).toBe('Collaboration starts here');
    expect(await (await recipient.repository.getAttachmentBlob(attachment.id))?.text()).toBe('shared bytes');
    expect(downloadedPaths).toEqual([expectedPath]);
    expect(client.rpc).toHaveBeenCalledWith('noor_vault_role', { p_vault_id: vault.id });
  });
});
