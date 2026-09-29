import { attachmentSchema, folderSchema, vaultNoteSchema, vaultSchema, type VaultNote } from '@noor-note/core';
import { z } from 'zod';
import { recoveryEnvelopeSchema, sealedBoxSchema } from '@noor-note/crypto';

export const syncKindSchema = z.enum(['vault', 'folder', 'note', 'attachment']);
export type SyncKind = z.infer<typeof syncKindSchema>;
export const syncRecordSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('vault'), item: vaultSchema }).strict(),
  z.object({ kind: z.literal('folder'), item: folderSchema, purged: z.literal(true).optional() }).strict(),
  z.object({ kind: z.literal('note'), item: vaultNoteSchema, purged: z.literal(true).optional() }).strict(),
  z.object({ kind: z.literal('attachment'), item: attachmentSchema, checksum: z.string().regex(/^[a-f0-9]{64}$/).nullable(), purged: z.literal(true).optional() }).strict(),
]);
export type SyncRecord = z.infer<typeof syncRecordSchema>;
export const encryptedSyncRecordSchema = z.object({
  kind: syncKindSchema,
  item: z.object({ id: z.uuid(), vaultId: z.uuid() }).strict(),
  sealed: sealedBoxSchema,
  blobChecksum: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  recovery: recoveryEnvelopeSchema.optional(),
}).strict().superRefine((record, context) => {
  if (record.kind === 'vault' && (!record.recovery || record.item.id !== record.item.vaultId)) context.addIssue({ code: 'custom', message: 'Encrypted vault needs a recovery envelope' });
  if (record.kind !== 'vault' && record.recovery) context.addIssue({ code: 'custom', message: 'Only a vault record carries recovery material' });
  if (record.kind !== 'attachment' && record.blobChecksum) context.addIssue({ code: 'custom', message: 'Only attachments have encrypted blobs' });
  if (record.recovery && (record.recovery.vaultId !== record.item.vaultId || record.recovery.epoch !== record.sealed.epoch)) context.addIssue({ code: 'custom', message: 'Key envelope identity mismatch' });
});
export type EncryptedSyncRecord = z.infer<typeof encryptedSyncRecordSchema>;
export const remotePayloadSchema = z.union([syncRecordSchema, encryptedSyncRecordSchema]);
export type RemotePayload = z.infer<typeof remotePayloadSchema>;
export const remoteRecordSchema = z.object({
  vault_id: z.uuid(), kind: syncKindSchema, item_id: z.uuid(), version: z.number().int().positive(),
  sequence: z.number().int().positive(), revision_id: z.uuid(), checksum: z.string().regex(/^[a-f0-9]{64}$/),
  payload: remotePayloadSchema, device_id: z.uuid(), updated_at: z.iso.datetime({ offset: true }),
}).strict();
export type RemoteRecord = z.infer<typeof remoteRecordSchema>;
export const pushResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('applied'), version: z.number().int().positive(), sequence: z.number().int().positive() }).strict(),
  z.object({ status: z.literal('conflict'), current: remoteRecordSchema }).strict(),
]);
export type PushResult = z.infer<typeof pushResultSchema>;

export function syncFingerprint(record: SyncRecord): string {
  if (record.kind === 'note') return noteFingerprint(record.item) + (record.purged ? ':purged' : '');
  if (record.kind === 'attachment') return JSON.stringify([record.item.updatedAt, record.item.path, record.item.deletedAt, record.item.size, record.checksum, Boolean(record.purged)]);
  if (record.kind === 'folder') return JSON.stringify([record.item.updatedAt, record.item.deletedAt, record.item, Boolean(record.purged)]);
  return JSON.stringify([record.item.updatedAt, record.item.deletedAt, record.item]);
}
export function noteFingerprint(note: Pick<VaultNote, 'revision' | 'checksum' | 'path' | 'deletedAt' | 'aliases' | 'properties'>): string {
  return JSON.stringify([note.revision, note.checksum, note.path, note.deletedAt, note.aliases, note.properties]);
}

export function nextRetryDelay(attempt: number, random = Math.random()): number {
  return Math.min(300_000, 1000 * 2 ** Math.min(attempt, 8)) + Math.floor(Math.max(0, Math.min(1, random)) * 500);
}

export function attachmentObjectPath(ownerId: string, vaultId: string, attachmentId: string, checksum: string): string {
  return [ownerId, vaultId, attachmentId, checksum].map((part) => z.uuid().safeParse(part).success || /^[a-f0-9]{64}$/.test(part) ? part : (() => { throw new Error('Invalid attachment path'); })()).join('/');
}
