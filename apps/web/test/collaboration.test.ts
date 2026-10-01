import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import * as Y from 'yjs';
import { afterEach, describe, expect, it } from 'vitest';
import { CollabStore } from '../src/lib/collab-store';
import { CollaborationSession, encodeUpdate, type CollabConnectionState, type CollabPage, type CollabPeer, type CollabTransport } from '../src/lib/collaboration';

const active: Array<{ session: CollaborationSession; store: CollabStore; name: string }> = [];
afterEach(async () => {
  for (const item of active.splice(0)) { await item.session.stop(); item.store.close(); await Dexie.delete(item.name); }
});

class SharedServer {
  readonly noteId = crypto.randomUUID();
  readonly initial: string;
  readonly updates: Array<{ sequence: number; updateId: string; base64: string }> = [];
  private clients = new Set<MemoryTransport>();
  constructor(markdown: string) {
    const doc = new Y.Doc(); doc.getText('markdown').insert(0, markdown);
    this.initial = encodeUpdate(Y.encodeStateAsUpdate(doc)); doc.destroy();
  }
  transport(): MemoryTransport { const transport = new MemoryTransport(this); this.clients.add(transport); return transport; }
  signal(): void { for (const client of this.clients) client.signal(); }
  awareness(sender: MemoryTransport, base64: string): void { for (const client of this.clients) if (client !== sender) client.receiveAwareness(base64); }
}
class MemoryTransport implements CollabTransport {
  online = true;
  private callbacks: { signal(): void; status(state: CollabConnectionState): void; awareness(base64: string): void; peers(peers: CollabPeer[]): void } | null = null;
  constructor(private readonly server: SharedServer) {}
  async fetch(_noteId: string, after: number): Promise<CollabPage> {
    if (!this.online) throw new Error('offline');
    return { initial: this.server.initial, updates: this.server.updates.filter((item) => item.sequence > after).slice(0, 100) };
  }
  async append(_noteId: string, updateId: string, base64: string): Promise<void> {
    if (!this.online) throw new Error('offline');
    if (!this.server.updates.some((item) => item.updateId === updateId)) {
      this.server.updates.push({ sequence: this.server.updates.length + 1, updateId, base64 });
      this.server.signal();
    }
  }
  async connect(_noteId: string, callbacks: NonNullable<MemoryTransport['callbacks']>): Promise<() => void> {
    this.callbacks = callbacks; callbacks.status(this.online ? 'connected' : 'offline');
    return () => { this.callbacks = null; };
  }
  async sendAwareness(_noteId: string, base64: string): Promise<void> { this.server.awareness(this, base64); }
  receiveAwareness(base64: string): void { if (this.online) this.callbacks?.awareness(base64); }
  signal(): void { if (this.online) this.callbacks?.signal(); }
  setOnline(value: boolean): void { this.online = value; this.callbacks?.status(value ? 'connected' : 'offline'); }
}
async function client(server: SharedServer, transport = server.transport()) {
  const name = crypto.randomUUID(), store = new CollabStore(name);
  const session = new CollaborationSession(server.noteId, store, transport, { name: 'Editor' }, () => undefined, () => undefined);
  active.push({ session, store, name });
  await session.start();
  return { session, store, transport };
}
async function converge(a: CollaborationSession, b: CollaborationSession): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await Promise.all([a.flush(), b.flush(), a.refresh(), b.refresh()]);
    if (a.text.toString() === b.text.toString()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Clients did not converge: ${a.text.toString()} / ${b.text.toString()}`);
}

describe('two-client Yjs collaboration', () => {
  it('shares awareness identity for remote cursor rendering', async () => {
    const server = new SharedServer('shared'), a = await client(server), b = await client(server);
    a.session.awareness.setLocalStateField('selection', { anchor: 2, head: 4 });
    for (let attempt = 0; attempt < 30 && !b.session.awareness.getStates().has(a.session.doc.clientID); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(b.session.awareness.getStates().get(a.session.doc.clientID)).toMatchObject({ user: { name: 'Editor' }, selection: { anchor: 2, head: 4 } });
  });
  it('merges simultaneous inserts at the same position', async () => {
    const server = new SharedServer('ab'), a = await client(server), b = await client(server);
    a.session.text.insert(1, 'X'); b.session.text.insert(1, 'Y');
    await converge(a.session, b.session);
    expect(a.session.text.toString()).toMatch(/^a[XY]{2}b$/u);
    expect(new Set(a.session.text.toString().slice(1, 3))).toEqual(new Set(['X', 'Y']));
  });

  it('merges a deletion with an edit from another client', async () => {
    const server = new SharedServer('abc'), a = await client(server), b = await client(server);
    a.transport.setOnline(false); b.transport.setOnline(false);
    a.session.text.delete(1, 1); b.session.text.insert(2, 'Z');
    a.transport.setOnline(true); b.transport.setOnline(true);
    await converge(a.session, b.session);
    expect(a.session.text.toString()).not.toContain('b');
    expect(a.session.text.toString()).toContain('Z');
  });

  it('keeps offline edits in IndexedDB and merges them on reconnection', async () => {
    const server = new SharedServer('hello'), a = await client(server), b = await client(server);
    b.transport.setOnline(false);
    b.session.text.insert(0, 'offline ');
    await b.session.stop();
    const resumed = new CollaborationSession(server.noteId, b.store, b.transport, { name: 'Editor' }, () => undefined, () => undefined);
    active.find((item) => item.session === b.session)!.session = resumed;
    await resumed.start();
    expect(resumed.text.toString()).toContain('offline ');
    a.session.text.insert(5, ' online');
    await a.session.flush();
    b.transport.setOnline(true);
    await converge(a.session, resumed);
    expect(a.session.text.toString()).toContain('offline ');
    expect(a.session.text.toString()).toContain(' online');
    expect(await b.store.pending(server.noteId)).toHaveLength(0);
  });

  it('synchronizes a large Markdown note without replacing the whole document', async () => {
    const server = new SharedServer('paragraph\n'.repeat(12_000)), a = await client(server), b = await client(server);
    a.session.text.insert(0, '# Shared\n');
    b.session.text.insert(b.session.text.length, '\nFinal line');
    await converge(a.session, b.session);
    expect(a.session.text.length).toBeGreaterThan(120_000);
    expect(a.session.text.toString()).toContain('# Shared');
    expect(a.session.text.toString()).toContain('Final line');
  }, 20_000);
});
