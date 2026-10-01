import type { Attachment, VaultNote } from '@noor-note/core';
import type { NoteEntry, VaultRepository } from '@noor-note/storage';
import type { GraphPositions, KnowledgeGraph } from './knowledge-graph';

type Request = { id: number; kind: 'reset' } | { id: number; kind: 'update'; notes: { id: string; markdown: string }[]; removed: string[] } | { id: number; kind: 'build'; notes: NoteEntry[]; attachments: Attachment[] };
type Response = { id: number; graph?: KnowledgeGraph; positions?: GraphPositions; error?: string };

/** Maintains parsed links in a worker and fetches only changed note bodies. */
export class GraphClient {
  private worker: Worker | null = null;
  private pending = new Map<number, { resolve: (result: Response) => void; reject: (error: Error) => void }>();
  private nextId = 1;
  private vaultId: string | null = null;
  private revisions = new Map<string, string>();
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;

  private ensureWorker(): Worker {
    if (this.closed) throw new Error('Graph closed');
    if (this.worker) return this.worker;
    if (typeof Worker === 'undefined') throw new Error('This browser does not support graph workers.');
    const worker = new Worker('/graph-worker.js');
    worker.onmessage = (event: MessageEvent<Response>) => {
      const pending = this.pending.get(event.data.id);
      if (!pending) return;
      this.pending.delete(event.data.id);
      if (event.data.error) pending.reject(new Error(event.data.error)); else pending.resolve(event.data);
    };
    worker.onerror = () => {
      for (const pending of this.pending.values()) pending.reject(new Error('Graph worker stopped. Reopen the graph to retry.'));
      this.pending.clear(); worker.terminate(); this.worker = null; this.vaultId = null; this.revisions.clear();
    };
    this.worker = worker;
    return worker;
  }

  private dispatch(request: Request): Promise<Response> {
    return new Promise((resolve, reject) => {
      try { this.pending.set(request.id, { resolve, reject }); this.ensureWorker().postMessage(request); }
      catch (error) { this.pending.delete(request.id); reject(error); }
    });
  }

  load(repository: VaultRepository, vaultId: string, notes: NoteEntry[], attachments: Attachment[], selectedNote?: VaultNote | null): Promise<{ graph: KnowledgeGraph; positions: GraphPositions }> {
    const operation = this.queue.then(async () => {
      if (vaultId !== this.vaultId) { await this.dispatch({ id: this.nextId++, kind: 'reset' }); this.revisions.clear(); this.vaultId = vaultId; }
      const current = new Set(notes.map((note) => note.id));
      const removed = [...this.revisions.keys()].filter((id) => !current.has(id));
      for (const id of removed) this.revisions.delete(id);
      if (removed.length) await this.dispatch({ id: this.nextId++, kind: 'update', notes: [], removed });
      const changed = notes.filter((note) => this.revisions.get(note.id) !== `${note.revision}:${note.checksum}` || selectedNote?.id === note.id);
      for (let offset = 0; offset < changed.length; offset += 80) {
        const batch = changed.slice(offset, offset + 80);
        const ids = batch.map((entry) => entry.id);
        const loaded = repository.getNotes ? await repository.getNotes(ids) : (await Promise.all(ids.map((id) => repository.getNote(id)))).filter((note): note is VaultNote => Boolean(note));
        const valid = loaded.map((note) => selectedNote?.id === note.id && selectedNote.revision === note.revision ? selectedNote : note);
        await this.dispatch({ id: this.nextId++, kind: 'update', notes: valid.map((note) => ({ id: note.id, markdown: note.markdown })), removed: [] });
        for (const note of valid) this.revisions.set(note.id, `${note.revision}:${note.checksum}`);
      }
      const result = await this.dispatch({ id: this.nextId++, kind: 'build', notes, attachments });
      return { graph: result.graph ?? { nodes: [], edges: [] }, positions: result.positions ?? {} };
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  close(): void {
    this.closed = true;
    this.worker?.terminate(); this.worker = null;
    for (const pending of this.pending.values()) pending.reject(new Error('Graph closed'));
    this.pending.clear(); this.vaultId = null; this.revisions.clear();
  }
}
