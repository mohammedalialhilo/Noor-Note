import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { ChatHistoryStore, type ChatSession } from '../src/lib/chat-history';

describe('optional chat history', () => {
  it('keeps chats vault scoped and deletes one or all saved conversations', async () => {
    const store = new ChatHistoryStore();
    const vaultId = crypto.randomUUID(), otherVaultId = crypto.randomUUID(), now = new Date().toISOString();
    const session = (id: string, vault: string): ChatSession => ({ id, vaultId: vault, title: 'Release question', createdAt: now, updatedAt: now, messages: [{ id: crypto.randomUUID(), role: 'user', text: 'When is release?', createdAt: now }] });
    const one = session(crypto.randomUUID(), vaultId), two = session(crypto.randomUUID(), vaultId), other = session(crypto.randomUUID(), otherVaultId);
    await store.save(one); await store.save(two); await store.save(other);
    expect(await store.list(vaultId)).toHaveLength(2);
    await store.remove(otherVaultId, one.id);
    expect(await store.list(vaultId)).toHaveLength(2);
    await store.remove(vaultId, one.id);
    expect((await store.list(vaultId)).map((item) => item.id)).toEqual([two.id]);
    await store.clear(vaultId);
    expect(await store.list(vaultId)).toEqual([]);
    expect(await store.list(otherVaultId)).toHaveLength(1);
    await expect(store.save({ ...one, messages: [{ id: crypto.randomUUID(), role: 'assistant', text: 'Answer [S1]', createdAt: now, sources: [{ id: 'S1', vaultId: otherVaultId, noteId: crypto.randomUUID(), revision: 1, title: 'Other vault', path: '/Other.md', heading: null, blockId: null, line: 1, from: 0, to: 6, excerpt: 'Answer' }] }] })).rejects.toThrow();
    store.close();
  });
});
