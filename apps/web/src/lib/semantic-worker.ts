/// <reference lib="webworker" />
import Dexie, { type EntityTable } from 'dexie';
import { env, pipeline, type FeatureExtractionPipelineType } from '@huggingface/transformers';
import { chunkFingerprint, chunkNote, semanticResults, SEMANTIC_EMBEDDING_VERSION, type EmbeddedChunk, type SemanticNote } from '@noor-note/search';

interface IndexedNote { key: string; vaultId: string; noteId: string; revision: number; embeddingVersion: string }
class SemanticDatabase extends Dexie {
  notes!: EntityTable<IndexedNote, 'key'>;
  chunks!: EntityTable<EmbeddedChunk, 'id'>;
  constructor() { super('noor-note-semantic'); this.version(1).stores({ notes: '&key, vaultId, noteId', chunks: '&id, vaultId, noteId, [vaultId+noteId]' }); }
}
type Request =
  | { id: number; kind: 'plan'; vaultId: string; entries: { id: string; revision: number }[] }
  | { id: number; kind: 'update'; vaultId: string; notes: SemanticNote[]; removed: string[] }
  | { id: number; kind: 'search'; vaultId: string; query: string; limit: number };
const worker = self as DedicatedWorkerGlobalScope;
const db = new SemanticDatabase();
const model = 'Xenova/multilingual-e5-small';
const revision = '761b726dd34fb83930e26aab4e9ac3899aa1fa78';
const wasm = env.backends.onnx.wasm;
if (!wasm) throw new Error('WebAssembly embedding runtime is unavailable.');
wasm.wasmPaths = '/transcription/runtime/';
wasm.numThreads = 1;
env.useBrowserCache = true;
env.allowRemoteModels = true;
let extractor: FeatureExtractionPipelineType | null = null;
let cachedVaultId: string | null = null;
let cachedChunks: EmbeddedChunk[] | null = null;
const queryCache = new Map<string, number[]>();
// The library's all-task overload exceeds TypeScript's union complexity here.
const loadExtractor = pipeline as unknown as (task: 'feature-extraction', modelId: string, options: { device: 'wasm'; dtype: 'q8'; revision: string }) => Promise<FeatureExtractionPipelineType>;

async function embed(texts: string[], prefix: 'query' | 'passage'): Promise<number[][]> {
  extractor ??= await loadExtractor('feature-extraction', model, { device: 'wasm', dtype: 'q8', revision });
  const output = await extractor(texts.map((text) => `${prefix}: ${text}`), { pooling: 'mean', normalize: true });
  const dimensions = output.dims;
  if (dimensions.length !== 2 || dimensions[0] !== texts.length || dimensions[1] !== 384) throw new Error('Embedding model returned unexpected dimensions.');
  const values = Array.from(output.data);
  if (values.some((value) => typeof value !== 'number' || !Number.isFinite(value))) throw new Error('Embedding model returned invalid numbers.');
  return texts.map((_, index) => values.slice(index * 384, (index + 1) * 384) as number[]);
}

async function updateNote(note: SemanticNote): Promise<void> {
  const previous = await db.chunks.where('[vaultId+noteId]').equals([note.vaultId, note.id]).toArray();
  const reusable = new Map<string, EmbeddedChunk[]>();
  for (const chunk of previous) if (chunk.embeddingVersion === SEMANTIC_EMBEDDING_VERSION) reusable.set(chunk.fingerprint, [...reusable.get(chunk.fingerprint) ?? [], chunk]);
  const fallbackVectors = new Map([...reusable].map(([fingerprint, chunks]) => [fingerprint, chunks[0]!.vector]));
  const draft = await Promise.all(chunkNote(note).map(async (chunk) => ({ chunk, fingerprint: await chunkFingerprint(chunk) })));
  const missing = new Map<string, string>();
  for (const item of draft) if (!reusable.has(item.fingerprint)) missing.set(item.fingerprint, `${item.chunk.heading ?? ''}\n${item.chunk.text}`);
  const newVectors = new Map<string, number[]>();
  const pending = [...missing.entries()];
  for (let start = 0; start < pending.length; start += 8) {
    const batch = pending.slice(start, start + 8);
    const vectors = await embed(batch.map(([, text]) => text), 'passage');
    batch.forEach(([fingerprint], index) => newVectors.set(fingerprint, vectors[index]!));
    worker.postMessage({ type: 'progress', message: `Embedding ${Math.min(start + 8, pending.length)} of ${pending.length} changed passages` });
  }
  const records = draft.map(({ chunk, fingerprint }): EmbeddedChunk => {
    const matches = reusable.get(fingerprint);
    const prior = matches?.shift();
    const vector = prior?.vector ?? fallbackVectors.get(fingerprint) ?? newVectors.get(fingerprint);
    if (!vector) throw new Error('A passage embedding is missing.');
    return { ...chunk, id: prior?.id ?? crypto.randomUUID(), fingerprint, embeddingVersion: SEMANTIC_EMBEDDING_VERSION, vector };
  });
  await db.transaction('rw', db.notes, db.chunks, async () => {
    await db.chunks.where('[vaultId+noteId]').equals([note.vaultId, note.id]).delete();
    if (records.length) await db.chunks.bulkPut(records);
    await db.notes.put({ key: `${note.vaultId}:${note.id}`, vaultId: note.vaultId, noteId: note.id, revision: note.revision, embeddingVersion: SEMANTIC_EMBEDDING_VERSION });
  });
  cachedChunks = null;
}

worker.onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data;
  try {
    if (request.kind === 'plan') {
      const indexed = await db.notes.where('vaultId').equals(request.vaultId).toArray();
      const byId = new Map(indexed.map((item) => [item.noteId, item]));
      const current = new Map(request.entries.map((entry) => [entry.id, entry.revision]));
      worker.postMessage({ id: request.id, type: 'plan', changed: request.entries.filter((entry) => { const old = byId.get(entry.id); return !old || old.revision !== entry.revision || old.embeddingVersion !== SEMANTIC_EMBEDDING_VERSION; }).map((entry) => entry.id), removed: indexed.filter((item) => !current.has(item.noteId)).map((item) => item.noteId) });
      return;
    }
    if (request.kind === 'update') {
      for (const noteId of request.removed) {
        await db.transaction('rw', db.notes, db.chunks, async () => { await db.chunks.where('[vaultId+noteId]').equals([request.vaultId, noteId]).delete(); await db.notes.delete(`${request.vaultId}:${noteId}`); });
      }
      for (const [index, note] of request.notes.entries()) {
        if (note.vaultId !== request.vaultId) throw new Error('Note belongs to another vault.');
        await updateNote(note);
        worker.postMessage({ type: 'progress', message: `Indexed ${index + 1} of ${request.notes.length} changed notes` });
      }
      cachedChunks = null;
      worker.postMessage({ id: request.id, type: 'done' });
      return;
    }
    if (request.query.length > 500 || !request.query.trim()) throw new Error('Enter a shorter semantic search query.');
    if (cachedVaultId !== request.vaultId || !cachedChunks) { cachedChunks = await db.chunks.where('vaultId').equals(request.vaultId).toArray(); cachedVaultId = request.vaultId; }
    let queryVector = queryCache.get(request.query);
    if (!queryVector) {
      queryVector = (await embed([request.query], 'query'))[0]!;
      queryCache.set(request.query, queryVector);
      if (queryCache.size > 20) queryCache.delete(queryCache.keys().next().value!);
    }
    worker.postMessage({ id: request.id, type: 'results', results: semanticResults(cachedChunks, queryVector, request.limit) });
  } catch (caught) { worker.postMessage({ id: request.id, type: 'error', error: caught instanceof Error ? caught.message : 'Semantic search failed.' }); }
};
