import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { z } from 'zod';
import type { CollabConnectionState, CollabPage, CollabPeer, CollabTransport } from './collaboration';

const documentSchema = z.object({ note_id: z.uuid(), vault_id: z.uuid(), initial_update: z.string().min(1).max(4_000_000) });
const updateSchema = z.object({ sequence: z.number().int().positive(), update_id: z.uuid(), update_base64: z.string().min(1).max(4_000_000) });
const peerSchema = z.object({ sessionId: z.uuid(), userId: z.uuid(), name: z.string().min(1).max(80) });

export class SupabaseCollabTransport implements CollabTransport {
  private channel: RealtimeChannel | null = null;
  private initialUpdate: string | null = null;
  private readonly sessionId = crypto.randomUUID();
  constructor(private readonly client: SupabaseClient, private readonly vaultId: string, private readonly userId: string, private readonly name: string) {
    z.uuid().parse(vaultId); z.uuid().parse(userId);
  }
  async fetch(noteId: string, after: number): Promise<CollabPage> {
    if (!this.initialUpdate) {
      const document = await this.client.from('noor_collab_documents').select('note_id,vault_id,initial_update').eq('note_id', noteId).maybeSingle();
      if (document.error) throw document.error;
      if (!document.data) throw new Error('This note is not enabled for collaboration');
      const parsed = documentSchema.parse(document.data);
      if (parsed.vault_id !== this.vaultId) throw new Error('Collaboration vault identity mismatch');
      this.initialUpdate = parsed.initial_update;
    }
    const rows = await this.client.from('noor_collab_updates').select('sequence,update_id,update_base64').eq('note_id', noteId).gt('sequence', after).order('sequence').limit(100);
    if (rows.error) throw rows.error;
    return { initial: this.initialUpdate, updates: z.array(updateSchema).parse(rows.data).map((row) => ({ sequence: row.sequence, updateId: row.update_id, base64: row.update_base64 })) };
  }
  async append(noteId: string, updateId: string, base64: string): Promise<void> {
    const result = await this.client.rpc('noor_append_collab_update', { p_note_id: noteId, p_update_id: updateId, p_update_base64: base64 });
    if (result.error) throw result.error;
  }
  async connect(noteId: string, callbacks: { signal(): void; status(state: CollabConnectionState): void; awareness(base64: string): void; peers(peers: CollabPeer[]): void }): Promise<() => void> {
    await this.client.realtime.setAuth();
    const channel = this.client.channel(`noor:note:${z.uuid().parse(noteId)}`, { config: { private: true, presence: { key: this.sessionId } } });
    this.channel = channel;
    channel.on('broadcast', { event: 'update' }, () => callbacks.signal());
    channel.on('broadcast', { event: 'awareness' }, ({ payload }) => {
      const result = z.object({ base64: z.string().min(1).max(100_000) }).safeParse(payload);
      if (result.success) callbacks.awareness(result.data.base64);
    });
    channel.on('presence', { event: 'sync' }, () => {
      const peers: CollabPeer[] = [];
      for (const entries of Object.values(channel.presenceState())) for (const entry of entries) {
        const parsed = peerSchema.safeParse(entry);
        if (parsed.success && parsed.data.sessionId !== this.sessionId) peers.push(parsed.data);
      }
      callbacks.peers(peers);
    });
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        callbacks.status('connected');
        void channel.track({ sessionId: this.sessionId, userId: this.userId, name: this.name.slice(0, 80) }).catch(() => callbacks.status('offline'));
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') callbacks.status('offline');
    });
    return () => { if (this.channel === channel) this.channel = null; void this.client.removeChannel(channel); };
  }
  async sendAwareness(noteId: string, base64: string): Promise<void> {
    if (!this.channel || this.channel.topic !== `realtime:noor:note:${noteId}`) return;
    const result = await this.channel.send({ type: 'broadcast', event: 'awareness', payload: { base64 } });
    if (result !== 'ok') throw new Error('Could not share cursor state');
  }
}
