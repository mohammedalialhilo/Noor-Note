import Dexie, { type Table } from 'dexie';
import { z } from 'zod';

const updateSchema = z.object({ id: z.string(), noteId: z.uuid(), base64: z.string().min(1).max(4_000_000), pending: z.boolean(), sequence: z.number().int().nonnegative().nullable() }).strict();
export type StoredCollabUpdate = z.infer<typeof updateSchema>;
const cursorSchema = z.object({ noteId: z.uuid(), sequence: z.number().int().nonnegative() }).strict();

class CollaborationDatabase extends Dexie {
  updates!: Table<StoredCollabUpdate, string>;
  cursors!: Table<z.infer<typeof cursorSchema>, string>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({ updates: 'id, noteId', cursors: 'noteId' });
  }
}

/** Durable Yjs operations are stored before they are sent or acknowledged. */
export class CollabStore {
  private readonly db: CollaborationDatabase;
  constructor(name = 'noor-note-collaboration') { this.db = new CollaborationDatabase(name); }
  async updates(noteId: string): Promise<StoredCollabUpdate[]> {
    return (await this.db.updates.where('noteId').equals(z.uuid().parse(noteId)).toArray()).map((item) => updateSchema.parse(item));
  }
  async hasDocument(noteId: string): Promise<boolean> { return Boolean(await this.db.updates.get(`initial:${z.uuid().parse(noteId)}`)); }
  async pending(noteId: string): Promise<StoredCollabUpdate[]> {
    return (await this.updates(noteId)).filter((item) => item.pending);
  }
  async put(item: StoredCollabUpdate): Promise<void> { await this.db.updates.put(updateSchema.parse(item)); }
  async cursor(noteId: string): Promise<number> { return cursorSchema.parse((await this.db.cursors.get(noteId)) ?? { noteId, sequence: 0 }).sequence; }
  async acceptRemote(item: StoredCollabUpdate, sequence: number): Promise<void> {
    const update = updateSchema.parse({ ...item, pending: false, sequence });
    await this.db.transaction('rw', this.db.updates, this.db.cursors, async () => {
      await this.db.updates.put(update);
      const current = await this.cursor(update.noteId);
      if (sequence > current) await this.db.cursors.put({ noteId: update.noteId, sequence });
    });
  }
  async acknowledge(id: string): Promise<void> { await this.db.updates.update(id, { pending: false }); }
  close(): void { this.db.close(); }
}
