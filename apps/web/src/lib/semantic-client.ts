import { z } from 'zod';
import type { VaultRepository } from '@noor-note/storage';
import type { SearchResult, SemanticNote } from '@noor-note/search';

const resultSchema = z.object({
  id: z.uuid(), title: z.string(), path: z.string(), excerpt: z.string(), highlights: z.array(z.object({ start: z.number(), end: z.number() })),
  kind: z.literal('note'), properties: z.array(z.object({ name: z.string(), value: z.string() })), score: z.number().finite(), similarity: z.number().finite(),
  heading: z.string().optional(), blockId: z.string().optional(), from: z.number().int().nonnegative(), to: z.number().int().nonnegative(), line: z.number().int().positive(), updatedAt: z.string(),
}).strict();
const responseSchema = z.discriminatedUnion('type', [
  z.object({ id: z.number().int(), type: z.literal('plan'), changed: z.array(z.uuid()), removed: z.array(z.uuid()) }),
  z.object({ id: z.number().int(), type: z.literal('done') }),
  z.object({ id: z.number().int(), type: z.literal('results'), results: z.array(resultSchema) }),
  z.object({ id: z.number().int(), type: z.literal('error'), error: z.string() }),
  z.object({ type: z.literal('progress'), message: z.string() }),
]);
type Response = z.infer<typeof responseSchema>;
type Reply = Exclude<Response, { type: 'progress' }>;
type Request =
  | { id: number; kind: 'plan'; vaultId: string; entries: { id: string; revision: number }[] }
  | { id: number; kind: 'update'; vaultId: string; notes: SemanticNote[]; removed: string[] }
  | { id: number; kind: 'search'; vaultId: string; query: string; limit: number };

/** Worker owns model inference, vector persistence, and similarity calculations. */
export class SemanticSearchClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, { resolve: (reply: Reply) => void; reject: (error: Error) => void }>();
  private nextId = 1;
  private queue: Promise<unknown> = Promise.resolve();
  private progress: ((message: string) => void) | null = null;
  private closed = false;

  constructor() {
    if (typeof Worker === 'undefined') throw new Error('Semantic search needs a browser with Web Worker support.');
    this.worker = new Worker('/semantic-worker.js');
    this.worker.onmessage = (event: MessageEvent<unknown>) => {
      const parsed = responseSchema.safeParse(event.data);
      if (!parsed.success) { this.failAll(new Error('Semantic worker returned invalid data.')); return; }
      const reply = parsed.data;
      if (reply.type === 'progress') { this.progress?.(reply.message); return; }
      const request = this.pending.get(reply.id);
      if (!request) return;
      this.pending.delete(reply.id);
      if (reply.type === 'error') request.reject(new Error(reply.error)); else request.resolve(reply);
    };
    this.worker.onerror = () => { this.closed = true; this.worker.terminate(); this.failAll(new Error('Semantic worker stopped.')); };
  }

  private failAll(error: Error): void { for (const request of this.pending.values()) request.reject(error); this.pending.clear(); }
  private dispatch(request: Request): Promise<Reply> {
    if (this.closed) return Promise.reject(new Error('Semantic search is closed.'));
    return new Promise((resolve, reject) => {
      this.pending.set(request.id, { resolve, reject });
      try { this.worker.postMessage(request); }
      catch (caught) { this.pending.delete(request.id); reject(caught instanceof Error ? caught : new Error('Semantic worker request failed.')); }
    });
  }

  search(repository: VaultRepository, vaultId: string, query: string, limit = 100, onProgress?: (message: string) => void): Promise<SearchResult[]> {
    const operation = this.queue.then(async () => {
      this.progress = onProgress ?? null;
      const tree = await repository.listTree(vaultId);
      const plan = await this.dispatch({ id: this.nextId++, kind: 'plan', vaultId, entries: tree.notes.map((entry) => ({ id: entry.id, revision: entry.revision })) });
      if (plan.type !== 'plan') throw new Error('Semantic index plan failed.');
      const changed = new Set(plan.changed);
      const entries = tree.notes.filter((entry) => changed.has(entry.id));
      if (entries.length || plan.removed.length) {
        onProgress?.(`Updating ${entries.length} changed notes in the local semantic index`);
        for (let start = 0; start < entries.length || start === 0; start += 20) {
          const batch = entries.slice(start, start + 20);
          const notes = (await Promise.all(batch.map((entry) => repository.getNote(entry.id)))).filter((note): note is NonNullable<typeof note> => Boolean(note));
          const reply = await this.dispatch({ id: this.nextId++, kind: 'update', vaultId, notes, removed: start === 0 ? plan.removed : [] });
          if (reply.type !== 'done') throw new Error('Semantic index update failed.');
          if (!entries.length) break;
        }
      }
      const reply = await this.dispatch({ id: this.nextId++, kind: 'search', vaultId, query, limit });
      if (reply.type !== 'results') throw new Error('Semantic search failed.');
      return reply.results;
    }).finally(() => { this.progress = null; });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  close(): void { this.closed = true; this.worker.terminate(); this.failAll(new Error('Semantic search closed.')); }
}
