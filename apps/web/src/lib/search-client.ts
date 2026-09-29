import { makeOcrSearchDocument, makeSearchDocument, makeTranscriptSearchDocuments, SearchEngine, type SearchDocument, type SearchResult } from '@noor-note/search';
import { ocrRecordSchema, transcriptSchema, type VaultNote } from '@noor-note/core';
import type { VaultRepository } from '@noor-note/storage';

type Request = { id: number; kind: 'reset' } | { id: number; kind: 'update'; documents: SearchDocument[]; removed: string[] } | { id: number; kind: 'search'; query: string; limit: number };
type Response = { id: number; results?: SearchResult[]; error?: string };

/** Keeps one vault index alive across queries and only fetches changed note bodies. */
export class SearchClient {
  private worker: Worker | null = null;
  private readonly fallback = new SearchEngine();
  private readonly pending = new Map<number, { resolve: (result: SearchResult[]) => void; reject: (error: Error) => void }>();
  private nextId = 1;
  private vaultId: string | null = null;
  private revisions = new Map<string, number>();
  private ocrRevisions = new Map<string, string>();
  private ocrLoaded = false;
  private ocrGeneration = 0;
  private transcriptRevisions = new Map<string, string>();
  private transcriptLoaded = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor() {
    if (typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker('/search-worker.js');
        this.worker.onmessage = (event: MessageEvent<Response>) => {
          const request = this.pending.get(event.data.id);
          if (!request) return;
          this.pending.delete(event.data.id);
          if (event.data.error) request.reject(new Error(event.data.error)); else request.resolve(event.data.results ?? []);
        };
        this.worker.onerror = () => {
          for (const request of this.pending.values()) request.reject(new Error('Search worker stopped'));
          this.pending.clear(); this.worker?.terminate(); this.worker = null; this.vaultId = null; this.revisions.clear(); this.ocrRevisions.clear(); this.ocrLoaded = false; this.transcriptRevisions.clear(); this.transcriptLoaded = false;
        };
      } catch { this.worker = null; }
    }
  }

  private dispatch(request: Request): Promise<SearchResult[]> {
    if (!this.worker) {
      if (request.kind === 'reset') this.fallback.clear();
      if (request.kind === 'update') { for (const id of request.removed) this.fallback.remove(id); for (const document of request.documents) this.fallback.upsert(document); }
      return Promise.resolve(request.kind === 'search' ? this.fallback.search(request.query, request.limit) : []);
    }
    return new Promise((resolve, reject) => { this.pending.set(request.id, { resolve, reject }); this.worker!.postMessage(request); });
  }

  invalidateOcr(): void { this.invalidateDerived(); }
  invalidateDerived(): void { this.ocrLoaded = false; this.transcriptLoaded = false; this.ocrGeneration += 1; }

  search(repository: VaultRepository, vaultId: string, query: string, limit = 500): Promise<SearchResult[]> {
    const operation = this.queue.then(async () => {
      if (this.vaultId !== vaultId) { await this.dispatch({ id: this.nextId++, kind: 'reset' }); this.revisions.clear(); this.ocrRevisions.clear(); this.ocrLoaded = false; this.transcriptRevisions.clear(); this.transcriptLoaded = false; this.vaultId = vaultId; }
      const tree = await repository.listTree(vaultId);
      const entries = tree.notes;
      const current = new Set(entries.map((entry) => entry.id));
      const removed = [...this.revisions.keys()].filter((id) => !current.has(id));
      for (const id of removed) this.revisions.delete(id);
      const changed = entries.filter((entry) => this.revisions.get(entry.id) !== entry.revision);
      if (removed.length) await this.dispatch({ id: this.nextId++, kind: 'update', documents: [], removed });
      for (let start = 0; start < changed.length; start += 100) {
        const notes = (await Promise.all(changed.slice(start, start + 100).map((entry) => repository.getNote(entry.id)))).filter((note): note is VaultNote => Boolean(note));
        await this.dispatch({ id: this.nextId++, kind: 'update', documents: notes.map(makeSearchDocument), removed: [] });
        for (const note of notes) this.revisions.set(note.id, note.revision);
      }
      if (!this.ocrLoaded) {
        const generation = this.ocrGeneration;
        const attachments = new Map(tree.attachments.map((attachment) => [attachment.id, attachment]));
        const records = (await repository.listObjects('ocrRecord', vaultId)).map((item) => ocrRecordSchema.parse(item)).filter((item) => attachments.has(item.attachmentId));
        const ids = new Set(records.map((record) => record.id));
        const removedOcr = [...this.ocrRevisions.keys()].filter((id) => !ids.has(id));
        for (const id of removedOcr) this.ocrRevisions.delete(id);
        const changedOcr = records.filter((record) => this.ocrRevisions.get(record.id) !== `${record.updatedAt}:${attachments.get(record.attachmentId)!.updatedAt}`);
        if (removedOcr.length) await this.dispatch({ id: this.nextId++, kind: 'update', documents: [], removed: removedOcr });
        for (let start = 0; start < changedOcr.length; start += 100) {
          const batch = changedOcr.slice(start, start + 100);
          await this.dispatch({ id: this.nextId++, kind: 'update', documents: batch.map((record) => makeOcrSearchDocument(record, attachments.get(record.attachmentId)!)), removed: [] });
          for (const record of batch) this.ocrRevisions.set(record.id, `${record.updatedAt}:${attachments.get(record.attachmentId)!.updatedAt}`);
        }
        this.ocrLoaded = generation === this.ocrGeneration;
      }
      if (!this.transcriptLoaded) {
        const generation = this.ocrGeneration;
        const attachments = new Map(tree.attachments.map((attachment) => [attachment.id, attachment]));
        const records = (await repository.listObjects('transcript', vaultId)).map((item) => transcriptSchema.parse(item)).filter((item) => attachments.has(item.attachmentId));
        const documents = records.flatMap((record) => makeTranscriptSearchDocuments(record, attachments.get(record.attachmentId)!));
        const ids = new Set(documents.map((document) => document.id));
        const removed = [...this.transcriptRevisions.keys()].filter((id) => !ids.has(id));
        for (const id of removed) this.transcriptRevisions.delete(id);
        const changed = documents.filter((document) => this.transcriptRevisions.get(document.id) !== `${document.revision}:${attachments.get(document.attachmentId!)!.updatedAt}`);
        if (removed.length) await this.dispatch({ id: this.nextId++, kind: 'update', documents: [], removed });
        for (let start = 0; start < changed.length; start += 100) {
          const batch = changed.slice(start, start + 100);
          await this.dispatch({ id: this.nextId++, kind: 'update', documents: batch, removed: [] });
          for (const document of batch) this.transcriptRevisions.set(document.id, `${document.revision}:${attachments.get(document.attachmentId!)!.updatedAt}`);
        }
        this.transcriptLoaded = generation === this.ocrGeneration;
      }
      return this.dispatch({ id: this.nextId++, kind: 'search', query, limit });
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  close(): void {
    this.worker?.terminate(); this.worker = null;
    for (const request of this.pending.values()) request.reject(new Error('Search closed'));
    this.pending.clear();
  }
}
