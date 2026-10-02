import type { SupabaseClient } from '@supabase/supabase-js';
import { notificationKindSchema, notificationSchema, type NoorNotification, type NotificationDestination } from '@noor-note/core';
import { z } from 'zod';

const cloudNotificationSchema = z.object({
  id: z.uuid(), recipient_id: z.uuid(), vault_id: z.uuid().nullable(),
  kind: z.enum(['collaboration_invite', 'mention', 'comment_reply', 'share_changed']),
  title: z.string(), body: z.string(), target_kind: z.enum(['settings', 'note', 'canvas', 'pdf']),
  target_id: z.uuid().nullable(), expires_at: z.iso.datetime({ offset: true }).nullable(), created_at: z.iso.datetime({ offset: true }),
  read_at: z.iso.datetime({ offset: true }).nullable(),
});

export function parseCloudNotifications(input: unknown, userId: string): NoorNotification[] {
  const recipient = z.uuid().parse(userId);
  const rows = z.array(cloudNotificationSchema).parse(input);
  if (rows.some((row) => row.recipient_id !== recipient)) throw new Error('Notification recipient mismatch');
  return rows.filter((row) =>
    row.kind !== 'collaboration_invite' || row.expires_at !== null && Date.parse(row.expires_at) > Date.now()).map((row) => {
    let destination: NotificationDestination = { kind: 'settings', section: row.kind === 'collaboration_invite' || row.kind === 'share_changed' ? 'collaboration' : 'sync' };
    if (row.vault_id && row.target_id) {
      if (row.target_kind === 'note') destination = { kind: 'note', vaultId: row.vault_id, noteId: row.target_id };
      if (row.target_kind === 'canvas') destination = { kind: 'canvas', vaultId: row.vault_id, canvasId: row.target_id };
      if (row.target_kind === 'pdf') destination = { kind: 'pdf', vaultId: row.vault_id, attachmentId: row.target_id };
    }
    return notificationSchema.parse({ id: row.id, kind: row.kind, title: row.title, body: row.body,
      vaultId: row.vault_id, destination, createdAt: row.created_at, readAt: row.read_at, origin: 'cloud' });
  });
}

export type NotificationFilter = 'all' | 'unread' | NoorNotification['kind'];
export const notificationPageSize = 50;

export async function loadCloudNotifications(client: SupabaseClient, userId: string, filter: NotificationFilter, offset = 0): Promise<{ items: NoorNotification[]; total: number }> {
  let query = client.from('noor_notifications')
    .select('id,recipient_id,vault_id,kind,title,body,target_kind,target_id,expires_at,created_at,read_at', { count: 'exact' })
    .eq('recipient_id', z.uuid().parse(userId))
    .or(`kind.neq.collaboration_invite,expires_at.gt.${new Date().toISOString()}`);
  if (filter === 'unread') query = query.is('read_at', null);
  else if (filter !== 'all') query = query.eq('kind', notificationKindSchema.parse(filter));
  const result = await query.order('created_at', { ascending: false }).order('id', { ascending: false })
    .range(offset, offset + notificationPageSize - 1);
  if (result.error) throw result.error;
  return { items: parseCloudNotifications(result.data, userId), total: result.count ?? 0 };
}

export async function countCloudUnread(client: SupabaseClient, userId: string): Promise<number> {
  const result = await client.from('noor_notifications').select('id', { count: 'exact', head: true })
    .eq('recipient_id', z.uuid().parse(userId)).is('read_at', null)
    .or(`kind.neq.collaboration_invite,expires_at.gt.${new Date().toISOString()}`);
  if (result.error) throw result.error;
  return result.count ?? 0;
}

export async function markCloudNotificationRead(client: SupabaseClient, userId: string, id: string): Promise<void> {
  const result = await client.from('noor_notifications').update({ read_at: new Date().toISOString() })
    .eq('recipient_id', z.uuid().parse(userId)).eq('id', z.uuid().parse(id));
  if (result.error) throw result.error;
}

export async function markCloudNotificationUnread(client: SupabaseClient, userId: string, id: string): Promise<void> {
  const result = await client.from('noor_notifications').update({ read_at: null })
    .eq('recipient_id', z.uuid().parse(userId)).eq('id', z.uuid().parse(id));
  if (result.error) throw result.error;
}

export async function markAllCloudNotificationsRead(client: SupabaseClient, userId: string): Promise<void> {
  const result = await client.from('noor_notifications').update({ read_at: new Date().toISOString() })
    .eq('recipient_id', z.uuid().parse(userId)).is('read_at', null);
  if (result.error) throw result.error;
}

export function notificationFilter(items: readonly NoorNotification[], filter: NotificationFilter): NoorNotification[] {
  if (filter === 'all') return [...items];
  if (filter === 'unread') return items.filter((item) => !item.readAt);
  return items.filter((item) => item.kind === filter);
}
