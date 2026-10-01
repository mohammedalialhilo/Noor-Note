import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { z } from 'zod';
import { CollabStore } from './collab-store';

const base64Schema = z.string().min(1).max(4_000_000).regex(/^[A-Za-z0-9+/]+={0,2}$/u);
export function encodeUpdate(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  return btoa(parts.join(''));
}
export function decodeUpdate(value: string): Uint8Array {
  const binary = atob(base64Schema.parse(value));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export interface CollabRemoteUpdate { sequence: number; updateId: string; base64: string }
export interface CollabPage { initial: string; updates: CollabRemoteUpdate[] }
export interface CollabPeer { sessionId: string; userId: string; name: string }
export type CollabConnectionState = 'connecting' | 'connected' | 'offline' | 'error';
export interface CollabTransport {
  fetch(noteId: string, after: number): Promise<CollabPage>;
  append(noteId: string, updateId: string, base64: string): Promise<void>;
  connect(noteId: string, callbacks: { signal(): void; status(state: CollabConnectionState): void; awareness(base64: string): void; peers(peers: CollabPeer[]): void }): Promise<() => void>;
  sendAwareness(noteId: string, base64: string): Promise<void>;
}

const remoteOrigin = Symbol('noor-note-remote-yjs');
export class CollaborationSession {
  readonly doc = new Y.Doc();
  readonly text = this.doc.getText('markdown');
  readonly awareness = new Awareness(this.doc);
  private unsubscribe: (() => void) | null = null;
  private active = false;
  private connected = false;
  private sending = false;
  private fetching: Promise<void> | null = null;
  private connecting: Promise<void> | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private awarenessTimer: ReturnType<typeof setTimeout> | null = null;
  private state: CollabConnectionState = 'connecting';
  private peers: CollabPeer[] = [];
  constructor(
    readonly noteId: string,
    private readonly store: CollabStore,
    private readonly transport: CollabTransport,
    identity: { name: string },
    private readonly onChange: (markdown: string) => void,
    private readonly onStatus: (state: CollabConnectionState, peers: CollabPeer[]) => void,
  ) {
    z.uuid().parse(noteId);
    this.awareness.setLocalStateField('user', { name: identity.name.slice(0, 80), color: 'var(--nn-accent)', colorLight: 'var(--nn-editor-selection)' });
  }
  private publish(state: CollabConnectionState): void { this.state = state; this.onStatus(state, this.peers); }
  private localUpdate = (update: Uint8Array, origin: unknown): void => {
    if (!this.active || origin === remoteOrigin) return;
    const item = { id: crypto.randomUUID(), noteId: this.noteId, base64: encodeUpdate(update), pending: true, sequence: null };
    this.writeChain = this.writeChain.catch(() => undefined).then(() => this.store.put(item));
    void this.writeChain.then(() => this.flush()).catch(() => this.publish('error'));
  };
  private awarenessUpdate = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown): void => {
    if (!this.active || origin === remoteOrigin || !this.connected) return;
    if (this.awarenessTimer) clearTimeout(this.awarenessTimer);
    this.awarenessTimer = setTimeout(() => {
      const clients = [...added, ...updated, ...removed];
      if (clients.length) void this.transport.sendAwareness(this.noteId, encodeUpdate(encodeAwarenessUpdate(this.awareness, clients))).catch(() => this.publish('offline'));
    }, 80);
  };
  async start(): Promise<void> {
    if (this.active) return;
    const stored = await this.store.updates(this.noteId);
    if (!stored.some((item) => item.id === `initial:${this.noteId}`)) {
      const page = await this.transport.fetch(this.noteId, 0);
      const initial = { id: `initial:${this.noteId}`, noteId: this.noteId, base64: page.initial, pending: false, sequence: 0 };
      Y.applyUpdate(this.doc, decodeUpdate(initial.base64), remoteOrigin);
      await this.store.put(initial);
      for (const item of stored) Y.applyUpdate(this.doc, decodeUpdate(item.base64), remoteOrigin);
      for (const update of page.updates) await this.accept(update);
    } else {
      for (const item of stored.sort((a, b) => Number(b.id === `initial:${this.noteId}`) - Number(a.id === `initial:${this.noteId}`))) Y.applyUpdate(this.doc, decodeUpdate(item.base64), remoteOrigin);
    }
    this.active = true;
    this.text.observe(() => this.onChange(this.text.toString()));
    this.doc.on('update', this.localUpdate);
    this.awareness.on('update', this.awarenessUpdate);
    this.onChange(this.text.toString());
    await this.reconnect();
  }
  async reconnect(): Promise<void> {
    if (!this.active || this.unsubscribe || this.connecting) return this.connecting ?? undefined;
    this.connecting = (async () => {
      try {
        const disconnect = await this.transport.connect(this.noteId, {
        signal: () => { void this.refresh(); },
        status: (state) => {
          this.connected = state === 'connected';
          this.publish(state);
          if (this.connected) { void this.refresh(); void this.flush(); this.awareness.setLocalStateField('online', true); }
        },
        awareness: (base64) => { try { applyAwarenessUpdate(this.awareness, decodeUpdate(base64), remoteOrigin); } catch { /* Ignore malformed ephemeral presence. */ } },
        peers: (peers) => { this.peers = peers; this.publish(this.state); },
        });
        if (this.active) this.unsubscribe = disconnect;
        else disconnect();
      } catch { this.publish('offline'); }
      finally { this.connecting = null; }
    })();
    return this.connecting;
  }
  private async accept(update: CollabRemoteUpdate): Promise<void> {
    const item = { id: `remote:${this.noteId}:${update.sequence}`, noteId: this.noteId, base64: update.base64, pending: false, sequence: update.sequence };
    Y.applyUpdate(this.doc, decodeUpdate(update.base64), remoteOrigin);
    await this.store.acceptRemote(item, update.sequence);
  }
  async refresh(): Promise<void> {
    if (!this.active || this.fetching) return this.fetching ?? undefined;
    this.fetching = (async () => {
      try {
        for (let pageIndex = 0; pageIndex < 100; pageIndex += 1) {
          const cursor = await this.store.cursor(this.noteId);
          const page = await this.transport.fetch(this.noteId, cursor);
          for (const update of page.updates) await this.accept(update);
          if (page.updates.length < 100) break;
        }
      } catch { this.publish('offline'); }
      finally { this.fetching = null; }
    })();
    return this.fetching;
  }
  async flush(): Promise<void> {
    if (!this.active || !this.connected || this.sending) return;
    this.sending = true;
    try {
      await this.writeChain;
      for (const item of await this.store.pending(this.noteId)) {
        await this.transport.append(this.noteId, item.id, item.base64);
        await this.store.acknowledge(item.id);
      }
    } catch { this.connected = false; this.publish('offline'); }
    finally {
      this.sending = false;
      if (this.connected && (await this.store.pending(this.noteId)).length) queueMicrotask(() => { void this.flush(); });
    }
  }
  async stop(): Promise<void> {
    this.active = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.awarenessTimer) clearTimeout(this.awarenessTimer);
    await this.writeChain.catch(() => undefined);
    this.awareness.destroy();
    this.doc.destroy();
  }
}
