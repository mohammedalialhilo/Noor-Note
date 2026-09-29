import Dexie, { type Table } from 'dexie';
import { z } from 'zod';
import { syncFingerprint, syncRecordSchema, type SyncKind, type SyncRecord } from './cloud-sync-types';

export interface SyncQueueItem {
  id: string;
  ownerId: string;
  vaultId: string;
  kind: SyncKind;
  itemId: string;
  revisionId: string;
  fingerprint: string;
  record: SyncRecord;
  attempts: number;
  nextAttemptAt: number;
  error: string | null;
  createdAt: number;
}
interface SyncLedger { key: string; ownerId: string; vaultId: string; kind: SyncKind; itemId: string; version: number; fingerprint: string }
interface SyncCursor { key: string; sequence: number }
interface SyncPreference { key: string; enabled: boolean; attachments: boolean }
interface DeviceRecord { key: string; id: string }
interface AttachmentDigest { key: string; signature: string; checksum: string }
const preferenceSchema = z.object({ key: z.string(), enabled: z.boolean(), attachments: z.boolean() }).strict();
const syncQueueSchema = z.object({
  id: z.uuid(), ownerId: z.uuid(), vaultId: z.uuid(), kind: z.enum(['vault', 'folder', 'note', 'attachment']),
  itemId: z.uuid(), revisionId: z.uuid(), fingerprint: z.string(), record: syncRecordSchema,
  attempts: z.number().int().nonnegative(), nextAttemptAt: z.number().int().nonnegative(),
  error: z.string().nullable(), createdAt: z.number().int().nonnegative(),
}).strict();

class SyncDatabase extends Dexie {
  queue!: Table<SyncQueueItem, string>;
  ledger!: Table<SyncLedger, string>;
  cursors!: Table<SyncCursor, string>;
  preferences!: Table<SyncPreference, string>;
  devices!: Table<DeviceRecord, string>;
  attachmentDigests!: Table<AttachmentDigest, string>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({
      queue: 'id, [ownerId+vaultId], [ownerId+vaultId+kind+itemId], nextAttemptAt',
      ledger: 'key, [ownerId+vaultId]',
      cursors: 'key', preferences: 'key', devices: 'key',
    });
    this.version(2).stores({ attachmentDigests: 'key' });
  }
}

export class CloudSyncStore {
  private readonly db: SyncDatabase;
  constructor(name = 'noor-note-sync') { this.db = new SyncDatabase(name); }
  static key(ownerId: string, vaultId: string): string { return `${ownerId}:${vaultId}`; }
  static itemKey(ownerId: string, vaultId: string, kind: SyncKind, itemId: string): string { return `${ownerId}:${vaultId}:${kind}:${itemId}`; }
  async deviceId(): Promise<string> {
    return this.db.transaction('rw', this.db.devices, async () => {
      const current = await this.db.devices.get('device');
      if (current) return z.uuid().parse(current.id);
      const id = crypto.randomUUID();
      await this.db.devices.put({ key: 'device', id });
      return id;
    });
  }
  async preference(ownerId: string, vaultId: string): Promise<SyncPreference> {
    const key = CloudSyncStore.key(ownerId, vaultId);
    const stored = await this.db.preferences.get(key);
    const parsed = preferenceSchema.safeParse(stored);
    return parsed.success && parsed.data.key === key ? parsed.data : { key, enabled: false, attachments: true };
  }
  async setPreference(ownerId: string, vaultId: string, preference: Pick<SyncPreference, 'enabled' | 'attachments'>): Promise<void> {
    await this.db.preferences.put({ key: CloudSyncStore.key(ownerId, vaultId), ...preference });
  }
  async cursor(ownerId: string, vaultId: string): Promise<number> {
    return (await this.db.cursors.get(CloudSyncStore.key(ownerId, vaultId)))?.sequence ?? 0;
  }
  async advanceCursor(ownerId: string, vaultId: string, sequence: number): Promise<void> {
    const key = CloudSyncStore.key(ownerId, vaultId);
    await this.db.transaction('rw', this.db.cursors, async () => {
      const current = await this.db.cursors.get(key);
      if (!current || sequence > current.sequence) await this.db.cursors.put({ key, sequence });
    });
  }
  async resetCursor(ownerId: string, vaultId: string): Promise<void> {
    await this.db.cursors.put({ key: CloudSyncStore.key(ownerId, vaultId), sequence: 0 });
  }
  async ledger(ownerId: string, vaultId: string, kind: SyncKind, itemId: string): Promise<SyncLedger | undefined> {
    return this.db.ledger.get(CloudSyncStore.itemKey(ownerId, vaultId, kind, itemId));
  }
  async hasPending(ownerId: string, vaultId: string, kind: SyncKind, itemId: string): Promise<boolean> {
    return (await this.db.queue.where('[ownerId+vaultId+kind+itemId]').equals([ownerId, vaultId, kind, itemId]).count()) > 0;
  }
  async needsRecord(ownerId: string, vaultId: string, kind: SyncKind, itemId: string, fingerprint: string): Promise<boolean> {
    const key = CloudSyncStore.itemKey(ownerId, vaultId, kind, itemId);
    const [ledger, pending] = await Promise.all([
      this.db.ledger.get(key),
      this.db.queue.where('[ownerId+vaultId+kind+itemId]').equals([ownerId, vaultId, kind, itemId]).first(),
    ]);
    return ledger?.fingerprint !== fingerprint && pending?.fingerprint !== fingerprint;
  }
  async knownFingerprints(ownerId: string, vaultId: string): Promise<Map<string, { ledger: string | null; pending: string | null }>> {
    const [ledgers, pending] = await Promise.all([
      this.db.ledger.where('[ownerId+vaultId]').equals([ownerId, vaultId]).toArray(),
      this.db.queue.where('[ownerId+vaultId]').equals([ownerId, vaultId]).toArray(),
    ]);
    const known = new Map<string, { ledger: string | null; pending: string | null }>();
    for (const entry of ledgers) known.set(entry.key, { ledger: entry.fingerprint, pending: null });
    for (const entry of pending) {
      const key = CloudSyncStore.itemKey(ownerId, vaultId, entry.kind, entry.itemId);
      const current = known.get(key);
      known.set(key, { ledger: current?.ledger ?? null, pending: entry.fingerprint });
    }
    return known;
  }
  async enqueue(ownerId: string, vaultId: string, record: SyncRecord): Promise<boolean> {
    const parsed = syncRecordSchema.parse(record);
    const kind = parsed.kind;
    const itemId = parsed.item.id;
    const fingerprint = syncFingerprint(parsed);
    const key = CloudSyncStore.itemKey(ownerId, vaultId, kind, itemId);
    return this.db.transaction('rw', this.db.queue, this.db.ledger, async () => {
      const ledger = await this.db.ledger.get(key);
      const pending = await this.db.queue.where('[ownerId+vaultId+kind+itemId]').equals([ownerId, vaultId, kind, itemId]).first();
      if (ledger?.fingerprint === fingerprint) {
        if (pending) await this.db.queue.delete(pending.id);
        return false;
      }
      if (pending?.fingerprint === fingerprint) return false;
      if (pending) await this.db.queue.delete(pending.id);
      await this.db.queue.add({ id: crypto.randomUUID(), ownerId, vaultId, kind, itemId, revisionId: crypto.randomUUID(), fingerprint, record: parsed, attempts: 0, nextAttemptAt: 0, error: null, createdAt: Date.now() });
      return true;
    });
  }
  async due(ownerId: string, vaultId: string, now = Date.now()): Promise<SyncQueueItem[]> {
    const items = await this.db.queue.where('[ownerId+vaultId]').equals([ownerId, vaultId]).toArray();
    const rank: Record<SyncKind, number> = { vault: 0, folder: 1, note: 2, attachment: 3 };
    return items.filter((item) => item.nextAttemptAt <= now).map((item) => syncQueueSchema.parse(item))
      .sort((a, b) => rank[a.kind] - rank[b.kind] || a.createdAt - b.createdAt);
  }
  async pendingCount(ownerId: string, vaultId: string): Promise<number> {
    return this.db.queue.where('[ownerId+vaultId]').equals([ownerId, vaultId]).count();
  }
  async hasEverSynced(ownerId: string, vaultId: string): Promise<boolean> {
    return (await this.db.ledger.where('[ownerId+vaultId]').equals([ownerId, vaultId]).count()) > 0;
  }
  async errors(ownerId: string, vaultId: string): Promise<string[]> {
    return (await this.db.queue.where('[ownerId+vaultId]').equals([ownerId, vaultId]).toArray()).flatMap((item) => item.error ? [item.error] : []);
  }
  async fail(item: SyncQueueItem, message: string, nextAttemptAt: number): Promise<void> {
    await this.db.transaction('rw', this.db.queue, async () => {
      const current = await this.db.queue.get(item.id);
      if (current) await this.db.queue.put({ ...current, attempts: current.attempts + 1, nextAttemptAt, error: message.slice(0, 300) });
    });
  }
  async acknowledge(item: SyncQueueItem, version: number): Promise<void> {
    await this.db.transaction('rw', this.db.queue, this.db.ledger, async () => {
      const current = await this.db.queue.get(item.id);
      const key = CloudSyncStore.itemKey(item.ownerId, item.vaultId, item.kind, item.itemId);
      const previous = await this.db.ledger.get(key);
      if (!previous || previous.version < version) await this.db.ledger.put({ key, ownerId: item.ownerId, vaultId: item.vaultId, kind: item.kind, itemId: item.itemId, version, fingerprint: item.fingerprint });
      if (current) await this.db.queue.delete(item.id);
    });
  }
  async discard(item: SyncQueueItem): Promise<void> { await this.db.queue.delete(item.id); }
  async attachmentDigest(itemId: string, signature: string): Promise<string | null> {
    const cached = await this.db.attachmentDigests.get(itemId);
    return cached?.signature === signature ? cached.checksum : null;
  }
  async saveAttachmentDigest(itemId: string, signature: string, checksum: string): Promise<void> {
    await this.db.attachmentDigests.put({ key: itemId, signature, checksum });
  }
  async acceptRemote(ownerId: string, vaultId: string, record: SyncRecord, version: number): Promise<void> {
    const key = CloudSyncStore.itemKey(ownerId, vaultId, record.kind, record.item.id);
    await this.db.transaction('rw', this.db.ledger, async () => {
      const previous = await this.db.ledger.get(key);
      if (!previous || previous.version < version) await this.db.ledger.put({ key, ownerId, vaultId, kind: record.kind, itemId: record.item.id, version, fingerprint: syncFingerprint(record) });
    });
  }
  async close(): Promise<void> { this.db.close(); }
}
