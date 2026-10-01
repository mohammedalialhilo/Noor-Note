import { z } from 'zod';

const id = z.uuid();
const timestamp = z.iso.datetime({ offset: true });
const hasControl = (value: string) => Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
const name = z.string().trim().min(1).max(200).refine((value) => !value.includes('/') && !value.includes('\\') && !hasControl(value), 'Name cannot contain a slash or control character');
const path = z.string().startsWith('/').refine((value) => value === '/' || (!value.endsWith('/') && !value.split('/').some((part) => part === '.' || part === '..' || part.includes('\\'))), 'Invalid vault path');
const deletedAt = timestamp.nullable();
export type PropertyValue = string | number | boolean | null | PropertyValue[] | { [key: string]: PropertyValue };
export const propertyValueSchema: z.ZodType<PropertyValue> = z.lazy(() => z.union([
  z.string(), z.number().finite(), z.boolean(), z.null(), z.array(propertyValueSchema), z.record(z.string(), propertyValueSchema),
]));
export const propertyTypeSchema = z.enum(['text', 'number', 'boolean', 'date', 'datetime', 'url', 'email', 'singleSelect', 'multiSelect', 'tag', 'noteReference', 'list', 'location', 'color', 'rating']);
export type PropertyType = z.infer<typeof propertyTypeSchema>;
export const propertyFieldSchema = z.object({ name: z.string().trim().min(1).max(100), type: propertyTypeSchema, options: z.array(z.string().trim().min(1).max(100)).max(100).default([]), defaultValue: propertyValueSchema.optional() }).strict();
export type PropertyField = z.infer<typeof propertyFieldSchema>;
export const metadataSchemaSchema = z.object({
  id, vaultId: id, name: z.string().trim().min(1).max(100),
  scope: z.enum(['folder', 'noteType', 'template', 'base']), selector: z.string().trim().min(1).max(200),
  fields: z.array(propertyFieldSchema).min(1).max(100), createdAt: timestamp, updatedAt: timestamp,
}).strict();
export type MetadataSchema = z.infer<typeof metadataSchemaSchema>;

export const templateSettingsSchema = z.object({
  folderId: id.nullable().default(null), defaultTemplateId: id.nullable().default(null), dailyTemplateId: id.nullable().default(null),
  folderTemplates: z.record(id, id).default({}), baseTemplates: z.record(id, id).default({}),
}).strict();
export type TemplateSettings = z.infer<typeof templateSettingsSchema>;
export const periodKindSchema = z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']);
export type PeriodKind = z.infer<typeof periodKindSchema>;
export const periodNoteRuleSchema = z.object({
  folderId: id.nullable().default(null),
  filenameFormat: z.string().trim().min(1).max(80),
  dateFormat: z.string().trim().min(1).max(80),
  templateId: id.nullable().default(null),
  autoCreate: z.boolean().default(false),
}).strict();
export type PeriodNoteRule = z.infer<typeof periodNoteRuleSchema>;
export const periodNotesSettingsSchema = z.object({
  daily: periodNoteRuleSchema.default({ folderId: null, filenameFormat: 'yyyy-MM-dd', dateFormat: 'EEEE, MMMM d, yyyy', templateId: null, autoCreate: false }),
  weekly: periodNoteRuleSchema.default({ folderId: null, filenameFormat: 'GGGG-[W]WW', dateFormat: '[Week] WW, GGGG', templateId: null, autoCreate: false }),
  monthly: periodNoteRuleSchema.default({ folderId: null, filenameFormat: 'yyyy-MM', dateFormat: 'MMMM yyyy', templateId: null, autoCreate: false }),
  quarterly: periodNoteRuleSchema.default({ folderId: null, filenameFormat: 'yyyy-[Q]Q', dateFormat: '[Quarter] Q, yyyy', templateId: null, autoCreate: false }),
  yearly: periodNoteRuleSchema.default({ folderId: null, filenameFormat: 'yyyy', dateFormat: 'yyyy', templateId: null, autoCreate: false }),
}).strict();
export type PeriodNotesSettings = z.infer<typeof periodNotesSettingsSchema>;
export const savedTaskViewSchema = z.object({
  id, name: z.string().trim().min(1).max(80), query: z.string().trim().min(1).max(300),
  createdAt: timestamp, updatedAt: timestamp,
}).strict();
export type SavedTaskView = z.infer<typeof savedTaskViewSchema>;
export const vaultSettingsSchema = z.object({
  syncEncryptionMode: z.enum(['none', 'e2ee']).default('none'),
  sortBy: z.enum(['name', 'updatedAt']).default('name'),
  sortDirection: z.enum(['asc', 'desc']).default('asc'),
  templates: templateSettingsSchema.default({ folderId: null, defaultTemplateId: null, dailyTemplateId: null, folderTemplates: {}, baseTemplates: {} }),
  periodNotes: periodNotesSettingsSchema.default(() => periodNotesSettingsSchema.parse({})),
  taskViews: z.array(savedTaskViewSchema).max(100).default([]),
}).strict();
export const vaultSchema = z.object({ id, name, createdAt: timestamp, updatedAt: timestamp, deletedAt, settings: vaultSettingsSchema }).strict();
export const folderSchema = z.object({ id, vaultId: id, parentId: id.nullable(), name, path, createdAt: timestamp, updatedAt: timestamp, deletedAt, trashGroupId: id.nullable() }).strict();
export const vaultNoteSchema = z.object({
  id, vaultId: id, folderId: id.nullable(), path, title: z.string().trim().max(200), markdown: z.string(),
  createdAt: timestamp, updatedAt: timestamp, deletedAt, trashGroupId: id.nullable(), aliases: z.array(z.string().trim().min(1).max(200)),
  properties: z.record(z.string().min(1), propertyValueSchema), revision: z.number().int().positive(), checksum: z.string().regex(/^[a-f0-9]{64}$/),
  collaborative: z.boolean().default(false),
}).strict().refine((note) => Date.parse(note.updatedAt) >= Date.parse(note.createdAt), { path: ['updatedAt'], message: 'Updated time precedes creation' });
export const recordingMetadataSchema = z.object({ recordedAt: timestamp, durationMs: z.number().int().nonnegative().max(86_400_000) }).strict();
export const attachmentSchema = z.object({
  id, vaultId: id, folderId: id.nullable(), path, name, mime: z.string().max(255), size: z.number().int().nonnegative(),
  storage: z.enum(['opfs', 'indexeddb']), createdAt: timestamp, updatedAt: timestamp, deletedAt, trashGroupId: id.nullable(),
  recording: recordingMetadataSchema.optional(),
}).strict();
export const pdfRectSchema = z.object({ x: z.number().finite().min(0).max(1), y: z.number().finite().min(0).max(1), width: z.number().finite().positive().max(1), height: z.number().finite().positive().max(1) }).strict().refine((rect) => rect.x + rect.width <= 1.001 && rect.y + rect.height <= 1.001, 'Rectangle extends beyond page');
export const pdfAnnotationSchema = z.object({
  id, vaultId: id, attachmentId: id, page: z.number().int().positive().max(100_000), kind: z.enum(['highlight', 'comment']),
  quote: z.string().trim().min(1).max(10_000), comment: z.string().max(20_000), color: z.enum(['yellow', 'green', 'blue', 'pink']),
  rects: z.array(pdfRectSchema).min(1).max(100), createdAt: timestamp, updatedAt: timestamp,
}).strict();
export const ocrRecordSchema = z.object({
  id, vaultId: id, attachmentId: id, page: z.number().int().positive().max(100_000),
  providerId: z.string().trim().min(1).max(80), languages: z.array(z.string().regex(/^[a-z]{3}(?:_[a-z]{3})?$/u)).min(1).max(10),
  detectedText: z.string().max(100_000), text: z.string().max(100_000), confidence: z.number().min(0).max(100).nullable(),
  createdAt: timestamp, updatedAt: timestamp,
}).strict();
export const transcriptSegmentSchema = z.object({
  id, startMs: z.number().int().nonnegative(), endMs: z.number().int().positive(),
  text: z.string().max(20_000), speaker: z.string().trim().min(1).max(100).nullable(),
  confidence: z.number().min(0).max(1).nullable(),
}).strict().refine((segment) => segment.endMs > segment.startMs, 'Segment end must follow its start');
export const transcriptSchema = z.object({
  id, vaultId: id, attachmentId: id, providerId: z.string().trim().min(1).max(80),
  language: z.string().trim().min(2).max(32).nullable(), text: z.string().max(1_000_000),
  segments: z.array(transcriptSegmentSchema).max(20_000), createdAt: timestamp, updatedAt: timestamp,
}).strict().superRefine((transcript, context) => {
  const ids = new Set<string>();
  transcript.segments.forEach((segment, index) => {
    if (ids.has(segment.id)) context.addIssue({ code: 'custom', path: ['segments', index, 'id'], message: 'Duplicate segment ID' });
    ids.add(segment.id);
  });
});
export const tagSchema = z.object({ id, vaultId: id, name, createdAt: timestamp, updatedAt: timestamp }).strict();
export const propertySchema = z.object({ id, vaultId: id, name, value: propertyValueSchema, createdAt: timestamp, updatedAt: timestamp }).strict();
export const linkSchema = z.object({ id, vaultId: id, sourceNoteId: id, targetNoteId: id.nullable(), target: z.string().min(1), createdAt: timestamp }).strict();
export const taskSchema = z.object({ id, vaultId: id, noteId: id, line: z.number().int().positive(), text: z.string(), completed: z.boolean(), createdAt: timestamp, updatedAt: timestamp }).strict();
export const canvasSchema = z.object({ id, vaultId: id, path, title: name, document: z.record(z.string(), z.unknown()), createdAt: timestamp, updatedAt: timestamp, deletedAt }).strict();
export const baseSchema = z.object({ id, vaultId: id, path, title: name, definition: z.record(z.string(), z.unknown()), createdAt: timestamp, updatedAt: timestamp, deletedAt }).strict();
export const templateSchema = z.object({ id, vaultId: id, path, title: name, markdown: z.string(), createdAt: timestamp, updatedAt: timestamp, deletedAt }).strict();
export const bookmarkKindSchema = z.enum(['group', 'note', 'heading', 'block', 'search', 'base', 'canvas', 'url']);
export const bookmarkSchema = z.object({
  id, vaultId: id, kind: bookmarkKindSchema.default('url'), title: name, parentId: id.nullable().default(null),
  noteId: id.optional(), resourceId: id.optional(), fragment: z.string().trim().min(1).max(200).optional(),
  query: z.string().trim().min(1).max(1000).optional(),
  url: z.url().refine((value) => /^https?:\/\//iu.test(value), 'Use an HTTP or HTTPS URL').optional(),
  favorite: z.boolean().default(false), pinned: z.boolean().default(false),
  createdAt: timestamp, updatedAt: timestamp, deletedAt,
}).strict().superRefine((item, context) => {
  const required = item.kind === 'note' || item.kind === 'heading' || item.kind === 'block' ? 'noteId' : item.kind === 'base' || item.kind === 'canvas' ? 'resourceId' : item.kind === 'search' ? 'query' : item.kind === 'url' ? 'url' : null;
  if (required && !item[required]) context.addIssue({ code: 'custom', path: [required], message: `A ${item.kind} bookmark needs ${required}` });
  if ((item.kind === 'heading' || item.kind === 'block') && !item.fragment) context.addIssue({ code: 'custom', path: ['fragment'], message: 'A heading or block bookmark needs a target' });
  if (item.noteId && !['note', 'heading', 'block'].includes(item.kind)) context.addIssue({ code: 'custom', path: ['noteId'], message: 'This bookmark type cannot target a note' });
  if (item.resourceId && item.kind !== 'base' && item.kind !== 'canvas') context.addIssue({ code: 'custom', path: ['resourceId'], message: 'This bookmark type cannot target a resource' });
  if (item.fragment && item.kind !== 'heading' && item.kind !== 'block') context.addIssue({ code: 'custom', path: ['fragment'], message: 'This bookmark type cannot target a fragment' });
  if (item.query && item.kind !== 'search') context.addIssue({ code: 'custom', path: ['query'], message: 'This bookmark type cannot target a search' });
  if (item.url && item.kind !== 'url') context.addIssue({ code: 'custom', path: ['url'], message: 'This bookmark type cannot target a URL' });
  if (item.kind === 'group' && (item.favorite || item.pinned)) context.addIssue({ code: 'custom', path: ['kind'], message: 'Groups cannot be favorites or pinned notes' });
  if (item.pinned && item.kind !== 'note') context.addIssue({ code: 'custom', path: ['pinned'], message: 'Only notes can be pinned' });
});
export const workspaceSchema = z.object({ id, vaultId: id, name, layout: z.record(z.string(), z.unknown()), createdAt: timestamp, updatedAt: timestamp }).strict();
export const dashboardWidgetKindSchema = z.enum(['recentNotes', 'recentlyModified', 'tasks', 'calendar', 'favorites', 'bookmarks', 'unlinkedMentions', 'graphSummary', 'writingStatistics', 'baseView', 'aiSuggestions', 'recentActivity']);
export const dashboardWidgetSchema = z.object({ id, kind: dashboardWidgetKindSchema, width: z.number().int().min(1).max(2), height: z.number().int().min(1).max(2), hidden: z.boolean(), limit: z.number().int().min(1).max(20), baseId: id.nullable() }).strict();
export const dashboardSchema = z.object({ id, vaultId: id, name: name, template: z.enum(['Home', 'Productivity', 'Research', 'Writing', 'Study']).nullable(), widgets: z.array(dashboardWidgetSchema).max(40), createdAt: timestamp, updatedAt: timestamp }).strict().refine((value) => new Set(value.widgets.map((widget) => widget.id)).size === value.widgets.length, 'Duplicate widget ID');
export const studyRatingSchema = z.enum(['again', 'hard', 'good', 'easy']);
export const studyReviewSchema = z.object({ at: timestamp, rating: studyRatingSchema, previousIntervalDays: z.number().nonnegative(), nextIntervalDays: z.number().positive(), previousEase: z.number().min(1.3).max(3), nextEase: z.number().min(1.3).max(3) }).strict();
export const studyCardSchema = z.object({
  id, vaultId: id, sourceNoteId: id, sourceLine: z.number().int().positive().nullable(),
  sourceKind: z.enum(['markdown', 'heading', 'callout', 'selection', 'ai']), sourceKey: z.string().min(1).max(12_000),
  kind: z.enum(['frontBack', 'questionAnswer', 'cloze']), front: z.string().trim().min(1).max(5_000), back: z.string().trim().min(1).max(5_000),
  dueAt: timestamp, intervalDays: z.number().nonnegative().max(36_500), ease: z.number().min(1.3).max(3), repetitions: z.number().int().nonnegative(),
  lastReviewedAt: timestamp.nullable(), history: z.array(studyReviewSchema).max(100_000), createdAt: timestamp, updatedAt: timestamp, deletedAt,
}).strict();
export const revisionSchema = z.object({
  id, vaultId: id, noteId: id, number: z.number().int().positive(), title: z.string(), path,
  markdown: z.string(), checksum: z.string().regex(/^[a-f0-9]{64}$/), createdAt: timestamp,
  kind: z.enum(['autosave', 'manual', 'move', 'restore']),
  // Optional so checkpoints written before version history remain readable.
  metadata: z.object({
    folderId: id.nullable(), aliases: z.array(z.string()),
    properties: z.record(z.string().min(1), propertyValueSchema),
  }).strict().optional(),
  origin: z.enum(['local', 'cloud']).optional(),
  deviceId: id.optional(),
  remoteVersion: z.number().int().positive().optional(),
  restoredFromId: id.optional(),
}).strict();
export const commentSchema = z.object({ id, vaultId: id, noteId: id, authorId: id.nullable(), body: z.string().min(1), createdAt: timestamp, updatedAt: timestamp, deletedAt }).strict();
export const userPreferenceSchema = z.object({ id, key: z.string().min(1), value: propertyValueSchema, updatedAt: timestamp }).strict();

export type Vault = z.infer<typeof vaultSchema>;
export type Folder = z.infer<typeof folderSchema>;
export type VaultNote = z.infer<typeof vaultNoteSchema>;
export type Attachment = z.infer<typeof attachmentSchema>;
export type PdfRect = z.infer<typeof pdfRectSchema>;
export type PdfAnnotation = z.infer<typeof pdfAnnotationSchema>;
export type OcrRecord = z.infer<typeof ocrRecordSchema>;
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;
export type Transcript = z.infer<typeof transcriptSchema>;
export type Tag = z.infer<typeof tagSchema>;
export type Property = z.infer<typeof propertySchema>;
export type Link = z.infer<typeof linkSchema>;
export type Task = z.infer<typeof taskSchema>;
export type Canvas = z.infer<typeof canvasSchema>;
export type Base = z.infer<typeof baseSchema>;
export type Template = z.infer<typeof templateSchema>;
export type Bookmark = z.infer<typeof bookmarkSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
export type Dashboard = z.infer<typeof dashboardSchema>;
export type DashboardWidget = z.infer<typeof dashboardWidgetSchema>;
export type DashboardWidgetKind = z.infer<typeof dashboardWidgetKindSchema>;
export type StudyCard = z.infer<typeof studyCardSchema>;
export type StudyRating = z.infer<typeof studyRatingSchema>;
export type Revision = z.infer<typeof revisionSchema>;
export type Comment = z.infer<typeof commentSchema>;
export type UserPreference = z.infer<typeof userPreferenceSchema>;

export type VaultObject = Tag | Property | Link | Task | Canvas | Base | Template | Bookmark | Workspace | Dashboard | StudyCard | Comment | UserPreference | MetadataSchema | PdfAnnotation | OcrRecord | Transcript;
export type VaultObjectKind = 'tag' | 'property' | 'link' | 'task' | 'canvas' | 'base' | 'template' | 'bookmark' | 'workspace' | 'dashboard' | 'studyCard' | 'comment' | 'userPreference' | 'metadataSchema' | 'pdfAnnotation' | 'ocrRecord' | 'transcript';
export const vaultObjectSchemas = {
  tag: tagSchema, property: propertySchema, link: linkSchema, task: taskSchema, canvas: canvasSchema,
  base: baseSchema, template: templateSchema, bookmark: bookmarkSchema, workspace: workspaceSchema,
  dashboard: dashboardSchema, studyCard: studyCardSchema, comment: commentSchema, userPreference: userPreferenceSchema, metadataSchema: metadataSchemaSchema, pdfAnnotation: pdfAnnotationSchema, ocrRecord: ocrRecordSchema, transcript: transcriptSchema,
} as const;

export function normalizeVaultPath(input: string): string {
  const parts = input.replaceAll('\\', '/').split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..' || hasControl(part))) throw new Error('Invalid vault path');
  return `/${parts.join('/')}`;
}

export function joinVaultPath(parent: string, child: string): string {
  name.parse(child);
  return normalizeVaultPath(`${parent}/${child}`);
}

export function pathKey(pathname: string): string {
  return normalizeVaultPath(pathname).normalize('NFKC').toLocaleLowerCase();
}

export function safeFileStem(input: string): string {
  return Array.from(input.normalize('NFKC'), (character) => hasControl(character) || '<>:"/\\|?*'.includes(character) ? '-' : character).join('').replace(/[. ]+$/gu, '').trim().slice(0, 180) || 'Untitled';
}
