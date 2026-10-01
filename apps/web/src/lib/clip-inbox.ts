import Dexie, { type Table } from 'dexie';
import { webClipSchema, type WebClip } from '@noor-note/core';
import { z } from 'zod';

export interface PendingWebClip { ticket: string; clip: WebClip; receivedAt: number }
const pendingSchema = z.object({ ticket: z.uuid(), clip: webClipSchema, receivedAt: z.number().int().nonnegative() }).strict();
class ClipDatabase extends Dexie {
  clips!: Table<PendingWebClip, string>;
  constructor(name: string) { super(name); this.version(1).stores({ clips: 'ticket, receivedAt' }); }
}
export class ClipInbox {
  private db: ClipDatabase;
  constructor(name = 'noor-note-clip-inbox') { this.db = new ClipDatabase(name); }
  async receive(ticket: string, clip: unknown): Promise<PendingWebClip> {
    const item = pendingSchema.parse({ ticket, clip, receivedAt: Date.now() });
    await this.db.clips.put(item);
    return item;
  }
  async get(ticket: string): Promise<PendingWebClip | undefined> {
    const item = await this.db.clips.get(z.uuid().parse(ticket));
    return item ? pendingSchema.parse(item) : undefined;
  }
  async latest(): Promise<PendingWebClip | undefined> {
    const item = await this.db.clips.orderBy('receivedAt').last();
    return item ? pendingSchema.parse(item) : undefined;
  }
  async remove(ticket: string): Promise<void> { await this.db.clips.delete(z.uuid().parse(ticket)); }
  close(): void { this.db.close(); }
}
