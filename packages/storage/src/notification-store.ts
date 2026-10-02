import { notificationDestinationSchema, notificationKindSchema, notificationSchema, type NoorNotification } from '@noor-note/core';
import Dexie, { type Table } from 'dexie';

interface StoredNotification extends NoorNotification { sourceKey: string; ownerKey: string }
export interface LocalNotificationInput {
  sourceKey: string;
  ownerKey: string;
  kind: Extract<NoorNotification['kind'], 'sync_issue' | 'backup_failure' | 'app_update'>;
  title: string;
  body: string;
  vaultId: string | null;
  destination: NoorNotification['destination'];
}

class NotificationDatabase extends Dexie {
  notifications!: Table<StoredNotification, string>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({ notifications: 'id, &sourceKey, ownerKey, createdAt' });
  }
}

function visible(row: StoredNotification): NoorNotification {
  const { sourceKey: _sourceKey, ownerKey: _ownerKey, ...notification } = row;
  void _sourceKey; void _ownerKey;
  return notificationSchema.parse(notification);
}

export class DexieNotificationStore {
  private readonly db: NotificationDatabase;
  constructor(name = 'noor-note-notifications') {
    if (typeof indexedDB === 'undefined') throw new Error('Notifications require IndexedDB');
    this.db = new NotificationDatabase(name);
  }

  async list(ownerKey: string, vaultId: string | null): Promise<NoorNotification[]> {
    const rows = await this.db.notifications.where('ownerKey').equals(ownerKey).toArray();
    return rows.filter((row) => row.vaultId === null || row.vaultId === vaultId)
      .map(visible)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  }

  async record(input: LocalNotificationInput, rearm = false): Promise<NoorNotification> {
    const sourceKey = input.sourceKey.trim();
    const ownerKey = input.ownerKey.trim();
    if (!sourceKey || sourceKey.length > 200 || !ownerKey || ownerKey.length > 100) throw new Error('Invalid notification key');
    notificationKindSchema.parse(input.kind);
    notificationDestinationSchema.parse(input.destination);
    const key = `${ownerKey}:${sourceKey}`;
    return this.db.transaction('rw', this.db.notifications, async () => {
      const previous = await this.db.notifications.where('sourceKey').equals(key).first();
      if (previous && !rearm) return visible(previous);
      const now = new Date().toISOString();
      const next: StoredNotification = {
        id: previous?.id ?? crypto.randomUUID(), sourceKey: key, ownerKey,
        kind: input.kind, title: input.title, body: input.body,
        vaultId: input.vaultId, destination: input.destination,
        createdAt: now, readAt: null, origin: 'local',
      };
      visible(next);
      await this.db.notifications.put(next);
      return visible(next);
    });
  }

  async markRead(ownerKey: string, id: string): Promise<void> {
    const row = await this.db.notifications.get(id);
    if (row?.ownerKey !== ownerKey || row.readAt) return;
    await this.db.notifications.update(id, { readAt: new Date().toISOString() });
  }

  async markUnread(ownerKey: string, id: string): Promise<void> {
    const row = await this.db.notifications.get(id);
    if (row?.ownerKey !== ownerKey || !row.readAt) return;
    await this.db.notifications.update(id, { readAt: null });
  }

  async markAllRead(ownerKey: string, vaultId: string | null): Promise<void> {
    const rows = await this.db.notifications.where('ownerKey').equals(ownerKey).toArray();
    const now = new Date().toISOString();
    await this.db.notifications.bulkPut(rows.filter((row) => !row.readAt && (row.vaultId === null || row.vaultId === vaultId)).map((row) => ({ ...row, readAt: now })));
  }

  close(): void { this.db.close(); }
}
