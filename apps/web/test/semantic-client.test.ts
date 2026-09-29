import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeVaultNote, type VaultNote } from '@noor-note/core';
import { toNoteEntry, type VaultRepository } from '@noor-note/storage';
import { SemanticSearchClient } from '../src/lib/semantic-client';

type WorkerRequest =
  | { id: number; kind: 'plan'; vaultId: string; entries: { id: string; revision: number }[] }
  | { id: number; kind: 'update'; vaultId: string; notes: VaultNote[]; removed: string[] }
  | { id: number; kind: 'search'; vaultId: string; query: string; limit: number };

class FakeSemanticWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly requests: WorkerRequest[] = [];
  private readonly indexed = new Map<string, number>();

  postMessage(request: WorkerRequest): void {
    this.requests.push(request);
    let response: unknown;
    if (request.kind === 'plan') {
      const current = new Map(request.entries.map((entry) => [entry.id, entry.revision]));
      response = { id: request.id, type: 'plan', changed: request.entries.filter((entry) => this.indexed.get(entry.id) !== entry.revision).map((entry) => entry.id), removed: [...this.indexed.keys()].filter((id) => !current.has(id)) };
    } else if (request.kind === 'update') {
      request.removed.forEach((id) => this.indexed.delete(id));
      request.notes.forEach((item) => this.indexed.set(item.id, item.revision));
      response = { id: request.id, type: 'done' };
    } else response = { id: request.id, type: 'results', results: [] };
    queueMicrotask(() => this.onmessage?.({ data: response } as MessageEvent<unknown>));
  }

  terminate(): void { /* no resources in this test double */ }
}

afterEach(() => vi.unstubAllGlobals());

describe('semantic search client', () => {
  it('fetches only changed note bodies and removes deleted notes from the local index', async () => {
    const worker = new FakeSemanticWorker();
    vi.stubGlobal('Worker', class { constructor() { return worker; } });
    const vaultId = crypto.randomUUID();
    const one = await makeVaultNote({ vaultId, title: 'One', markdown: 'alpha' });
    const two = await makeVaultNote({ vaultId, title: 'Two', markdown: 'beta' });
    const notes = new Map<string, VaultNote>([[one.id, one], [two.id, two]]);
    const getNote = vi.fn(async (id: string) => notes.get(id));
    const repository = { listTree: async () => ({ notes: [...notes.values()].map(toNoteEntry) }), getNote } as unknown as VaultRepository;
    const client = new SemanticSearchClient();

    await client.search(repository, vaultId, 'first');
    expect(getNote).toHaveBeenCalledTimes(2);
    await client.search(repository, vaultId, 'second');
    expect(getNote).toHaveBeenCalledTimes(2);
    notes.set(one.id, { ...one, revision: 2, markdown: 'changed alpha' });
    await client.search(repository, vaultId, 'third');
    expect(getNote).toHaveBeenCalledTimes(3);
    expect(worker.requests.filter((item) => item.kind === 'update').at(-1)).toMatchObject({ notes: [{ id: one.id, revision: 2 }], removed: [] });
    notes.delete(two.id);
    await client.search(repository, vaultId, 'fourth');
    expect(getNote).toHaveBeenCalledTimes(3);
    expect(worker.requests.filter((item) => item.kind === 'update').at(-1)).toMatchObject({ notes: [], removed: [two.id] });
    client.close();
  });
});
