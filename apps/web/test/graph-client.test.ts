import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeVaultNote, type VaultNote } from '@noor-note/core';
import { toNoteEntry, type VaultRepository } from '@noor-note/storage';
import { GraphClient } from '../src/lib/graph-client';
import type { GraphPositions } from '../src/lib/knowledge-graph';

afterEach(() => vi.unstubAllGlobals());

describe('graph client', () => {
  it('loads note bodies incrementally and resets when switching vaults', async () => {
    const sent: { kind: string; notes?: { id: string }[] }[] = [];
    class FakeWorker {
      onmessage: ((event: MessageEvent<{ id: number; graph?: { nodes: []; edges: [] }; positions?: GraphPositions }>) => void) | null = null;
      onerror: (() => void) | null = null;
      postMessage(request: { id: number; kind: string; notes?: { id: string }[] }) {
        sent.push(request);
        queueMicrotask(() => this.onmessage?.({ data: { id: request.id, graph: request.kind === 'build' ? { nodes: [], edges: [] } : undefined, positions: {} } } as MessageEvent<{ id: number; graph?: { nodes: []; edges: [] }; positions?: GraphPositions }>));
      }
      terminate() {}
    }
    vi.stubGlobal('Worker', FakeWorker);
    const vaultId = crypto.randomUUID();
    const one = await makeVaultNote({ vaultId, title: 'One', markdown: '[[Two]]' });
    const two = await makeVaultNote({ vaultId, title: 'Two', markdown: '' });
    const notes = new Map<string, VaultNote>([[one.id, one], [two.id, two]]);
    const getNote = vi.fn(async (id: string) => notes.get(id));
    const repository = { getNote } as unknown as VaultRepository;
    const client = new GraphClient();
    const load = () => client.load(repository, vaultId, [...notes.values()].map(toNoteEntry), []);
    await load();
    expect(getNote).toHaveBeenCalledTimes(2);
    await load();
    expect(getNote).toHaveBeenCalledTimes(2);
    notes.set(one.id, { ...one, revision: 2, markdown: 'Changed' });
    await load();
    expect(getNote).toHaveBeenCalledTimes(3);
    notes.delete(two.id);
    await load();
    expect(sent.some((request) => request.kind === 'update' && request.notes?.length === 0)).toBe(true);
    await client.load(repository, crypto.randomUUID(), [...notes.values()].map(toNoteEntry), []);
    expect(getNote).toHaveBeenCalledTimes(4);
    client.close();
  });
});
