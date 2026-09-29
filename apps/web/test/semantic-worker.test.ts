import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import type { SemanticNote } from '@noor-note/search';

const modelCalls = vi.hoisted(() => ({ passages: [] as string[][], queries: [] as string[][] }));
vi.mock('@huggingface/transformers', () => ({
  env: { backends: { onnx: { wasm: {} } } },
  pipeline: vi.fn(async () => async (texts: string[]) => {
    if (texts[0]?.startsWith('passage:')) modelCalls.passages.push(texts);
    else modelCalls.queries.push(texts);
    const values = new Float32Array(texts.length * 384);
    texts.forEach((text, index) => { values[index * 384 + (text.includes('Alpha') ? 0 : 1)] = 1; });
    return { dims: [texts.length, 384], data: values };
  }),
}));

type Request = { id: number; kind: 'plan'; vaultId: string; entries: { id: string; revision: number }[] }
  | { id: number; kind: 'update'; vaultId: string; notes: SemanticNote[]; removed: string[] }
  | { id: number; kind: 'search'; vaultId: string; query: string; limit: number };
type RequestWithoutId = Request extends infer Item ? Item extends Request ? Omit<Item, 'id'> : never : never;

describe('local semantic worker', () => {
  it('persists passage vectors, embeds only changed chunks, and removes deleted notes', async () => {
    const pending = new Map<number, (reply: Record<string, unknown>) => void>();
    const scope = {
      onmessage: null as ((event: MessageEvent<Request>) => void) | null,
      postMessage(reply: Record<string, unknown>) { if (typeof reply.id === 'number') pending.get(reply.id)?.(reply); },
    };
    vi.stubGlobal('self', scope);
    await import('../src/lib/semantic-worker');
    let nextId = 1;
    const send = (request: RequestWithoutId): Promise<Record<string, unknown>> => new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, (reply) => { pending.delete(id); resolve(reply); });
      scope.onmessage?.({ data: { ...request, id } } as MessageEvent<Request>);
    });
    const vaultId = crypto.randomUUID(), id = crypto.randomUUID();
    const original: SemanticNote = { id, vaultId, revision: 1, title: 'Research', path: '/Research.md', markdown: '# One\nAlpha passage\n# Two\nBeta passage', updatedAt: '2026-09-29T12:00:00Z' };
    expect(await send({ kind: 'plan', vaultId, entries: [{ id, revision: 1 }] })).toMatchObject({ changed: [id], removed: [] });
    expect(await send({ kind: 'update', vaultId, notes: [original], removed: [] })).toMatchObject({ type: 'done' });
    expect(modelCalls.passages.flat()).toHaveLength(2);
    expect(await send({ kind: 'plan', vaultId, entries: [{ id, revision: 1 }] })).toMatchObject({ changed: [], removed: [] });

    const changed = { ...original, revision: 2, markdown: original.markdown.replace('Beta', 'Gamma') };
    expect(await send({ kind: 'update', vaultId, notes: [changed], removed: [] })).toMatchObject({ type: 'done' });
    expect(modelCalls.passages.flat()).toHaveLength(3);
    expect(modelCalls.passages.at(-1)?.[0]).toContain('Gamma passage');
    expect(await send({ kind: 'plan', vaultId, entries: [{ id, revision: 2 }] })).toMatchObject({ changed: [], removed: [] });
    const result = await send({ kind: 'search', vaultId, query: 'Alpha', limit: 10 });
    expect(result).toMatchObject({ type: 'results', results: [{ id, heading: 'One', line: 2, excerpt: 'Alpha passage' }] });
    expect(modelCalls.queries).toHaveLength(1);

    expect(await send({ kind: 'plan', vaultId, entries: [] })).toMatchObject({ changed: [], removed: [id] });
    expect(await send({ kind: 'update', vaultId, notes: [], removed: [id] })).toMatchObject({ type: 'done' });
    expect(await send({ kind: 'search', vaultId, query: 'Alpha', limit: 10 })).toMatchObject({ type: 'results', results: [] });
    vi.unstubAllGlobals();
  });
});
