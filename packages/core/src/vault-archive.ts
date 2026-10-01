import { z } from 'zod';
import { baseSchema, bookmarkSchema, canvasSchema, dashboardSchema, metadataSchemaSchema, ocrRecordSchema, pdfAnnotationSchema, recordingMetadataSchema, studyCardSchema, transcriptSchema, workspaceSchema, vaultSettingsSchema, type PeriodKind } from './vault-domain';
import { validatePeriodRule } from './period-notes';
import { compileTaskQuery } from './task-query';

const id = z.uuid();
const timestamp = z.iso.datetime({ offset: true });
const safeArchivePath = z.string().startsWith('/').refine((value) => !value.split('/').some((part) => part === '.' || part === '..' || part.includes('\\')), 'Unsafe archive path');

export const vaultArchiveManifestSchema = z.object({
  format: z.literal('noor-note-vault'),
  version: z.literal(1),
  exportedAt: timestamp,
  vault: z.object({ id, name: z.string().min(1).max(200), settings: vaultSettingsSchema }).strict(),
  folders: z.array(z.object({ id, parentId: id.nullable(), name: z.string().min(1).max(200), path: safeArchivePath, createdAt: timestamp, updatedAt: timestamp }).strict()),
  notes: z.array(z.object({ id, folderId: id.nullable(), path: safeArchivePath, title: z.string().max(200), createdAt: timestamp, updatedAt: timestamp, aliases: z.array(z.string()), properties: z.record(z.string(), z.json()), checksum: z.string().regex(/^[a-f0-9]{64}$/) }).strict()),
  attachments: z.array(z.object({ id, folderId: id.nullable(), path: safeArchivePath, name: z.string().min(1).max(200), mime: z.string(), size: z.number().int().nonnegative(), createdAt: timestamp, updatedAt: timestamp, recording: recordingMetadataSchema.optional() }).strict()),
  metadataSchemas: z.array(metadataSchemaSchema).optional(),
  bases: z.array(baseSchema).optional(),
  canvases: z.array(canvasSchema).optional(),
  workspaces: z.array(workspaceSchema).optional(),
  dashboards: z.array(dashboardSchema).optional(),
  studyCards: z.array(studyCardSchema).optional(),
  bookmarks: z.array(bookmarkSchema).optional(),
  pdfAnnotations: z.array(pdfAnnotationSchema).optional(),
  ocrRecords: z.array(ocrRecordSchema).optional(),
  transcripts: z.array(transcriptSchema).optional(),
  revisions: z.array(z.object({ id, noteId: id, entry: z.string().regex(/^\.noor-history\/[0-9a-f-]{36}\.json$/u) }).strict()).optional(),
}).strict().superRefine((manifest, context) => {
  const revisionIds = new Set<string>();
  for (const [index, revision] of (manifest.revisions ?? []).entries()) {
    if (revisionIds.has(revision.id)) context.addIssue({ code: 'custom', path: ['revisions', index], message: 'Duplicate revision ID' });
    if (!manifest.notes.some((note) => note.id === revision.noteId)) context.addIssue({ code: 'custom', path: ['revisions', index], message: 'Revision note is missing' });
    revisionIds.add(revision.id);
  }
  const transcriptAttachments = new Set<string>();
  for (const [index, transcript] of (manifest.transcripts ?? []).entries()) {
    if (transcriptAttachments.has(transcript.attachmentId)) context.addIssue({ code: 'custom', path: ['transcripts', index], message: 'Duplicate attachment transcript' });
    transcriptAttachments.add(transcript.attachmentId);
  }
  const ocrPages = new Set<string>();
  for (const [index, record] of (manifest.ocrRecords ?? []).entries()) {
    const key = `${record.attachmentId}:${record.page}`;
    if (ocrPages.has(key)) context.addIssue({ code: 'custom', path: ['ocrRecords', index], message: 'Duplicate OCR page' });
    ocrPages.add(key);
  }
  for (const kind of ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'] as PeriodKind[]) {
    try { validatePeriodRule(kind, manifest.vault.settings.periodNotes[kind]); }
    catch { context.addIssue({ code: 'custom', path: ['vault', 'settings', 'periodNotes', kind], message: 'Invalid period note format' }); }
  }
  for (const [index, view] of manifest.vault.settings.taskViews.entries()) {
    try { compileTaskQuery(view.query); }
    catch { context.addIssue({ code: 'custom', path: ['vault', 'settings', 'taskViews', index, 'query'], message: 'Invalid saved task query' }); }
  }
});

export type VaultArchiveManifest = z.infer<typeof vaultArchiveManifestSchema>;
