import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { DexieNotificationStore } from '../src';

const name = `noor-note-notification-test-${crypto.randomUUID()}`;
const store = new DexieNotificationStore(name);
afterEach(async () => { store.close(); await Dexie.delete(name); });

describe('local notification store', () => {
  it('deduplicates issues, persists read state, and scopes items to the owner and vault', async () => {
    const vaultId = crypto.randomUUID(), otherVault = crypto.randomUUID();
    const input = { sourceKey: `sync:${vaultId}`, ownerKey: 'owner-a', kind: 'sync_issue' as const,
      title: 'Sync issue', body: 'Review sync settings.', vaultId,
      destination: { kind: 'settings' as const, section: 'sync' as const } };
    const first = await store.record(input);
    await store.markRead('owner-b', first.id);
    expect((await store.list('owner-a', vaultId))[0]?.readAt).toBeNull();
    await store.markRead('owner-a', first.id);
    expect((await store.record(input)).readAt).not.toBeNull();
    expect((await store.record(input, true)).readAt).toBeNull();
    expect((await store.list('owner-a', otherVault))).toEqual([]);
    expect((await store.list('owner-b', vaultId))).toEqual([]);
    await store.markAllRead('owner-a', vaultId);
    expect((await store.list('owner-a', vaultId))[0]?.readAt).not.toBeNull();
    await store.markUnread('owner-a', first.id);
    expect((await store.list('owner-a', vaultId))[0]?.readAt).toBeNull();
  });
});
