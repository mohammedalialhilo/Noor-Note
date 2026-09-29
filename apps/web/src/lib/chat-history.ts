import Dexie, { type EntityTable } from 'dexie';
import { z } from 'zod';
import { chatSourceSchema } from '@noor-note/ai';

const messageSchema = z.discriminatedUnion('role', [
  z.object({ id: z.uuid(), role: z.literal('user'), text: z.string().trim().min(1).max(500), createdAt: z.iso.datetime({ offset: true }) }).strict(),
  z.object({ id: z.uuid(), role: z.literal('assistant'), text: z.string().trim().min(1).max(20_000), sources: z.array(chatSourceSchema).max(4), createdAt: z.iso.datetime({ offset: true }) }).strict(),
]);
export type ChatMessage = z.infer<typeof messageSchema>;
export const chatSessionSchema = z.object({
  id: z.uuid(), vaultId: z.uuid(), title: z.string().trim().min(1).max(100),
  createdAt: z.iso.datetime({ offset: true }), updatedAt: z.iso.datetime({ offset: true }),
  messages: z.array(messageSchema).max(100),
}).strict().superRefine((session, context) => {
  if (session.messages.some((message) => message.role === 'assistant' && message.sources.some((source) => source.vaultId !== session.vaultId))) context.addIssue({ code: 'custom', path: ['messages'], message: 'Chat source belongs to another vault' });
});
export type ChatSession = z.infer<typeof chatSessionSchema>;

class ChatDatabase extends Dexie {
  sessions!: EntityTable<ChatSession, 'id'>;
  constructor() { super('noor-note-chats'); this.version(1).stores({ sessions: '&id, vaultId, updatedAt' }); }
}

/** Opt-in browser-only history. This database is separate from vault ZIP data. */
export class ChatHistoryStore {
  private readonly db = new ChatDatabase();
  async list(vaultId: string): Promise<ChatSession[]> {
    z.uuid().parse(vaultId);
    const records = await this.db.sessions.where('vaultId').equals(vaultId).toArray();
    return records.map((item) => chatSessionSchema.parse(item)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async save(session: ChatSession): Promise<void> { await this.db.sessions.put(chatSessionSchema.parse(session)); }
  async remove(vaultId: string, id: string): Promise<void> {
    z.uuid().parse(vaultId); z.uuid().parse(id);
    const record = await this.db.sessions.get(id);
    if (record?.vaultId === vaultId) await this.db.sessions.delete(id);
  }
  async clear(vaultId: string): Promise<void> { z.uuid().parse(vaultId); await this.db.sessions.where('vaultId').equals(vaultId).delete(); }
  close(): void { this.db.close(); }
}
