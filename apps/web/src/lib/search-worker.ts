/// <reference lib="webworker" />
import { SearchEngine, type SearchDocument, type SearchResult } from '@noor-note/search';

type Request = { id: number; kind: 'reset' } | { id: number; kind: 'update'; documents: SearchDocument[]; removed: string[] } | { id: number; kind: 'search'; query: string; limit: number };
type Response = { id: number; results?: SearchResult[]; error?: string };
const engine = new SearchEngine();
const worker = self as DedicatedWorkerGlobalScope;
worker.onmessage = (event: MessageEvent<Request>) => {
  const request = event.data;
  try {
    if (request.kind === 'reset') engine.clear();
    if (request.kind === 'update') { for (const id of request.removed) engine.remove(id); for (const document of request.documents) engine.upsert(document); }
    const response: Response = request.kind === 'search' ? { id: request.id, results: engine.search(request.query, request.limit) } : { id: request.id };
    worker.postMessage(response);
  } catch (error) { worker.postMessage({ id: request.id, error: error instanceof Error ? error.message : 'Search failed' } satisfies Response); }
};
