import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DexieVaultRepository, type AttachmentBytesStore } from '@noor-note/storage';
import { checksumMarkdown, type Attachment } from '@noor-note/core';
import { CloudSyncStore } from '../src/lib/cloud-sync-store';
import { CloudSyncEngine, checksumBlob, checksumSyncRecord } from '../src/lib/cloud-sync';
import { nextRetryDelay, noteFingerprint, syncFingerprint } from '../src/lib/cloud-sync-types';

describe('cloud sync foundation', () => {
  let repository: DexieVaultRepository;
  let store: CloudSyncStore;
  let vaultDb: string;
  let syncDb: string;
  const bytes = new Map<string, Blob>();
  const byteStore: AttachmentBytesStore = {
    async write(id, blob) { bytes.set(id, blob); return 'indexeddb'; },
    async read(attachment: Attachment) { return bytes.get(attachment.id); },
    async remove(attachment: Attachment) { bytes.delete(attachment.id); },
  };
  beforeEach(() => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', { onLine: true });
    vaultDb = `noor-sync-vault-test-${crypto.randomUUID()}`;
    syncDb = `noor-sync-test-${crypto.randomUUID()}`;
    repository = new DexieVaultRepository(vaultDb, byteStore);
    store = new CloudSyncStore(syncDb);
    bytes.clear();
  });
  afterEach(async () => {
    repository.close();
    await store.close();
    await Dexie.delete(vaultDb);
    await Dexie.delete(syncDb);
    vi.unstubAllGlobals();
  });

  it('coalesces offline edits, persists the queue, and acknowledges only the uploaded revision', async () => {
    const owner = crypto.randomUUID();
    const vault = await repository.initialize();
    const note = await repository.createNote(vault.id, null, 'Plan', 'first');
    expect(await store.enqueue(owner, vault.id, { kind: 'note', item: note })).toBe(true);
    const edited = await repository.saveNote(note.id, { markdown: 'second' });
    expect(await store.enqueue(owner, vault.id, { kind: 'note', item: edited })).toBe(true);
    let pending = await store.due(owner, vault.id);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.record.kind === 'note' && pending[0].record.item.markdown).toBe('second');
    await store.close();
    store = new CloudSyncStore(syncDb);
    pending = await store.due(owner, vault.id);
    expect(pending).toHaveLength(1);
    await store.acknowledge(pending[0]!, 3);
    expect(await store.pendingCount(owner, vault.id)).toBe(0);
    expect((await store.ledger(owner, vault.id, 'note', note.id))?.version).toBe(3);
    expect(noteFingerprint(edited)).toBe(syncFingerprint({ kind: 'note', item: edited }));
  });

  it('retains a durable tombstone when trash is emptied', async () => {
    const vault = await repository.initialize();
    const note = await repository.createNote(vault.id, null, 'Remove', 'keep deleted state');
    await repository.deleteNote(note.id);
    await repository.emptyTrash(vault.id);
    expect(await repository.getNote(note.id)).toBeUndefined();
    const tombstone = (await repository.listSyncTombstones(vault.id)).find((item) => item.item.id === note.id);
    expect(tombstone?.kind).toBe('note');
    expect(tombstone?.purged).toBe(true);
    expect(tombstone?.item.deletedAt).not.toBeNull();
    if (tombstone?.kind === 'note') expect(tombstone.item.markdown).toBe('');
  });

  it('cancels a queued change when the item returns to the last synced snapshot', async () => {
    const owner = crypto.randomUUID();
    const vault = await repository.initialize();
    const note = await repository.createNote(vault.id, null, 'Draft', 'original');
    await store.enqueue(owner, vault.id, { kind: 'note', item: note });
    const originalOperation = (await store.due(owner, vault.id))[0]!;
    await store.acknowledge(originalOperation, 1);
    const changed = await repository.saveNote(note.id, { markdown: 'changed' });
    await store.enqueue(owner, vault.id, { kind: 'note', item: changed });
    expect(await store.pendingCount(owner, vault.id)).toBe(1);
    await store.enqueue(owner, vault.id, { kind: 'note', item: note });
    expect(await store.pendingCount(owner, vault.id)).toBe(0);
  });

  it('checks attachment bytes incrementally and backs off retries', async () => {
    const blob = new Blob(['hello', ' ', 'world']);
    expect(await checksumBlob(blob)).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
    expect(nextRetryDelay(0, 0)).toBe(1000);
    expect(nextRetryDelay(8, 0)).toBe(256000);
    expect(nextRetryDelay(20, 1)).toBe(256500);
  });

  it('queues local changes while offline without calling the cloud client', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const owner = crypto.randomUUID();
    const vault = await repository.initialize();
    const note = await repository.createNote(vault.id, null, 'Offline', 'available locally');
    const client = { from: vi.fn(), rpc: vi.fn() } as unknown as SupabaseClient;
    const engine = new CloudSyncEngine(client, repository, store, owner, vault.id);
    await engine.enable();
    expect(engine.getSnapshot().status).toBe('offline');
    expect(await store.pendingCount(owner, vault.id)).toBe(2);
    expect((await store.due(owner, vault.id)).some((item) => item.itemId === note.id)).toBe(true);
    expect(client.from).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('continues note sync when an attachment upload fails', async () => {
    const owner = crypto.randomUUID();
    const vault = await repository.initialize();
    const note = await repository.createNote(vault.id, null, 'Plan', 'local note');
    const attachment = await repository.addAttachment(vault.id, null, new Blob(['binary']), 'sample.bin');
    const pushed: string[] = [];
    const client = {
      from(table: string) {
        if (table === 'noor_sync_vaults') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: vault.id, owner_id: owner, name: vault.name }, error: null }) }) }) };
        return { select: () => ({ eq: () => ({ gt: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }) };
      },
      storage: { from: () => ({ upload: async () => ({ error: new Error('Attachment upload failed') }) }) },
      async rpc(_name: string, args: Record<string, unknown>) {
        pushed.push(String(args.p_kind));
        return { data: { status: 'applied', version: 1, sequence: pushed.length }, error: null };
      },
    } as unknown as SupabaseClient;
    const engine = new CloudSyncEngine(client, repository, store, owner, vault.id);
    await engine.enable();
    expect(pushed, JSON.stringify(engine.getSnapshot())).toContain('vault');
    expect(pushed).toContain('note');
    expect(pushed).not.toContain('attachment');
    expect((await store.ledger(owner, vault.id, 'note', note.id))?.version).toBe(1);
    expect(await store.pendingCount(owner, vault.id)).toBe(1);
    expect((await store.due(owner, vault.id, Date.now() + 60_000))[0]?.itemId).toBe(attachment.id);
    expect(engine.getSnapshot().status).toBe('error');
  });

  it('honors attachment selection and uploads files after it is enabled', async () => {
    const owner = crypto.randomUUID();
    const vault = await repository.initialize();
    const attachment = await repository.addAttachment(vault.id, null, new Blob(['optional bytes']), 'optional.bin');
    const upload = vi.fn(async () => ({ error: null }));
    const client = {
      from(table: string) {
        if (table === 'noor_sync_vaults') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: vault.id, owner_id: owner, name: vault.name }, error: null }) }) }) };
        return { select: () => ({ eq: () => ({ gt: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }) };
      },
      storage: { from: () => ({ upload }) },
      async rpc() { return { data: { status: 'applied', version: 1, sequence: 1 }, error: null }; },
    } as unknown as SupabaseClient;
    const engine = new CloudSyncEngine(client, repository, store, owner, vault.id);
    await engine.enable(false);
    expect(upload).not.toHaveBeenCalled();
    expect(await store.ledger(owner, vault.id, 'attachment', attachment.id)).toBeUndefined();
    await engine.setAttachments(true);
    expect(upload).toHaveBeenCalledOnce();
    expect((await store.ledger(owner, vault.id, 'attachment', attachment.id))?.version).toBe(1);
  });

  it('preserves local Markdown as a conflict copy before accepting a remote revision', async () => {
    const owner = crypto.randomUUID();
    const vault = await repository.initialize();
    const local = await repository.createNote(vault.id, null, 'Shared', 'local words');
    const remoteNote = { ...local, markdown: 'remote words', checksum: await checksumMarkdown('remote words'), revision: 2, updatedAt: new Date(Date.parse(local.updatedAt) + 1000).toISOString() };
    const payload = { kind: 'note' as const, item: remoteNote };
    const conflict = {
      vault_id: vault.id, kind: 'note', item_id: local.id, version: 2, sequence: 2,
      revision_id: crypto.randomUUID(), checksum: await checksumSyncRecord(payload), payload,
      device_id: crypto.randomUUID(), updated_at: new Date().toISOString(),
    };
    const client = {
      from(table: string) {
        if (table === 'noor_sync_vaults') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: vault.id, owner_id: owner, name: vault.name }, error: null }) }) }) };
        return { select: () => ({ eq: () => ({ gt: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }) };
      },
      async rpc(_name: string, args: Record<string, unknown>) {
        return args.p_kind === 'note'
          ? { data: { status: 'conflict', current: conflict }, error: null }
          : { data: { status: 'applied', version: 1, sequence: 1 }, error: null };
      },
    } as unknown as SupabaseClient;
    const engine = new CloudSyncEngine(client, repository, store, owner, vault.id);
    await engine.enable();
    expect((await repository.getNote(local.id))?.markdown).toBe('remote words');
    const copies = (await repository.listTree(vault.id)).notes.filter((note) => note.id !== local.id);
    expect(copies).toHaveLength(1);
    expect((await repository.getNote(copies[0]!.id))?.markdown).toBe('local words');
    expect(await store.pendingCount(owner, vault.id)).toBe(1);
  });

  it('applies a purged note tombstone without retaining deleted Markdown', async () => {
    const owner = crypto.randomUUID();
    const vault = await repository.initialize();
    const original = await repository.createNote(vault.id, null, 'Secret', 'remove these words');
    await repository.deleteNote(original.id);
    await repository.permanentlyDeleteNote(original.id);
    const tombstone = (await repository.listSyncTombstones(vault.id)).find((entry) => entry.kind === 'note');
    if (!tombstone || tombstone.kind !== 'note') throw new Error('Expected note tombstone');
    const secondName = `noor-sync-second-${crypto.randomUUID()}`;
    const second = new DexieVaultRepository(secondName, byteStore);
    try {
      await second.importSyncedVault(vault);
      await second.applySyncedNote(original);
      await store.acceptRemote(owner, vault.id, { kind: 'note', item: original }, 1);
      const payload = tombstone;
      const row = {
        vault_id: vault.id, kind: 'note', item_id: original.id, version: 2, sequence: 2,
        revision_id: crypto.randomUUID(), checksum: await checksumSyncRecord(payload), payload,
        device_id: crypto.randomUUID(), updated_at: new Date().toISOString(),
      };
      const client = {
        from(table: string) {
          if (table === 'noor_sync_vaults') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: vault.id, owner_id: owner, name: vault.name }, error: null }) }) }) };
          return { select: () => ({ eq: () => ({ gt: (_field: string, cursor: number) => ({ order: () => ({ limit: async () => ({ data: cursor < 2 ? [row] : [], error: null }) }) }) }) }) };
        },
        async rpc() { return { data: { status: 'applied', version: 1, sequence: 3 }, error: null }; },
      } as unknown as SupabaseClient;
      const engine = new CloudSyncEngine(client, second, store, owner, vault.id);
      await engine.enable();
      expect(await second.getNote(original.id), JSON.stringify(engine.getSnapshot())).toBeUndefined();
      expect((await second.listSyncTombstones(vault.id))[0]?.item.id).toBe(original.id);
      expect((await second.listSyncTombstones(vault.id))[0]?.kind === 'note' && (await second.listSyncTombstones(vault.id))[0]?.item).toMatchObject({ markdown: '' });
    } finally {
      second.close();
      await Dexie.delete(secondName);
    }
  });
});
