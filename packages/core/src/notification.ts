import { z } from 'zod';

export const notificationKindSchema = z.enum([
  'sync_issue', 'collaboration_invite', 'mention', 'comment_reply',
  'share_changed', 'backup_failure', 'app_update',
]);
export type NotificationKind = z.infer<typeof notificationKindSchema>;

export const notificationDestinationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('note'), vaultId: z.uuid(), noteId: z.uuid() }).strict(),
  z.object({ kind: z.literal('canvas'), vaultId: z.uuid(), canvasId: z.uuid() }).strict(),
  z.object({ kind: z.literal('pdf'), vaultId: z.uuid(), attachmentId: z.uuid() }).strict(),
  z.object({ kind: z.literal('settings'), section: z.enum(['sync', 'collaboration']) }).strict(),
  z.object({ kind: z.literal('backup'), vaultId: z.uuid() }).strict(),
  z.object({ kind: z.literal('update') }).strict(),
]);
export type NotificationDestination = z.infer<typeof notificationDestinationSchema>;

export const notificationSchema = z.object({
  id: z.uuid(),
  kind: notificationKindSchema,
  title: z.string().trim().min(1).max(160),
  body: z.string().max(500),
  vaultId: z.uuid().nullable(),
  destination: notificationDestinationSchema,
  createdAt: z.iso.datetime({ offset: true }),
  readAt: z.iso.datetime({ offset: true }).nullable(),
  origin: z.enum(['local', 'cloud']),
}).strict();
export type NoorNotification = z.infer<typeof notificationSchema>;
