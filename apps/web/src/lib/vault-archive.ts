import { baseSchema, canvasDocumentSchema, canvasSchema, checksumMarkdown, dashboardSchema, metadataSchemaSchema, newCanvas, ocrRecordSchema, pdfAnnotationSchema, readBaseDefinition, readCanvasDocument, revisionSchema, studyCardSchema, transcriptSchema, vaultArchiveManifestSchema, type Canvas, type PeriodKind, type PeriodNotesSettings, type Revision, type VaultArchiveManifest } from '@noor-note/core';
import type { VaultRepository } from '@noor-note/storage';
import { parseWorkspaceLayout, remapWorkspaceLayout, WorkspacesStore } from './workspace-layout';
import { BookmarksStore } from './bookmarks';
import { readBoundedZipBlob, readBoundedZipText, verifyBoundedZipEntry } from './zip-safety';

const MANIFEST_NAME = 'noor-note.json';
const MAX_ENTRIES = 10_000;
const MAX_NOTE_BYTES = 8 * 1024 * 1024;
const MAX_REVISION_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 50_000_000;

function zipName(path: string): string { return path.replace(/^\//u, ''); }
function assertZipName(name: string): void {
  if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').some((part) => part === '' || part === '.' || part === '..')) throw new Error('Unsafe ZIP entry path');
}

export interface VaultBackupPreview {
  vaultName: string;
  exportedAt: string;
  version: 1;
  notes: number;
  folders: number;
  attachments: number;
  revisions: number;
  archiveBytes: number;
}

/** Read and authenticate every archive entry before offering a restore. */
export async function verifyVaultZip(archive: Blob): Promise<VaultBackupPreview> {
  if (archive.size > MAX_TOTAL_BYTES) throw new Error('Backup exceeds the supported archive size');
  const { BlobReader, ZipReader } = await import('@zip.js/zip.js');
  const reader = new ZipReader(new BlobReader(archive));
  try {
    const entries = (await reader.getEntries()).filter((entry) => !entry.directory);
    if (entries.length > MAX_ENTRIES) throw new Error('Backup contains too many files');
    const byName = new Map<string, typeof entries[number]>();
    let total = 0;
    for (const entry of entries) {
      assertZipName(entry.filename);
      if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0) throw new Error('Backup entry size is invalid');
      if (byName.has(entry.filename)) throw new Error('Backup contains duplicate paths');
      byName.set(entry.filename, entry);
      total += entry.uncompressedSize;
      if (total > MAX_TOTAL_BYTES) throw new Error('Backup contents exceed the size limit');
    }
    const manifestEntry = byName.get(MANIFEST_NAME);
    if (!manifestEntry || manifestEntry.uncompressedSize > MAX_MANIFEST_BYTES) throw new Error('Noor Note backup manifest is missing or too large');
    const raw: unknown = JSON.parse(await readBoundedZipText(manifestEntry, MAX_MANIFEST_BYTES));
    if (!raw || typeof raw !== 'object' || !('format' in raw) || raw.format !== 'noor-note-vault') throw new Error('This is not a Noor Note vault backup');
    if (!('version' in raw) || raw.version !== 1) throw new Error('This backup version is not supported by this Noor Note release');
    const manifest = vaultArchiveManifestSchema.parse(raw);
    const expected = new Set([MANIFEST_NAME, ...manifest.notes.map((item) => zipName(item.path)), ...manifest.attachments.map((item) => zipName(item.path)), ...(manifest.revisions ?? []).map((item) => item.entry)]);
    if (expected.size !== entries.length || [...expected].some((name) => !byName.has(name))) throw new Error('Backup files do not match its manifest');
    for (const note of manifest.notes) {
      const entry = byName.get(zipName(note.path))!;
      if (entry.uncompressedSize > MAX_NOTE_BYTES) throw new Error('Backup note is too large');
      const markdown = await readBoundedZipText(entry, MAX_NOTE_BYTES);
      if (await checksumMarkdown(markdown) !== note.checksum) throw new Error(`Backup note checksum failed: ${note.path}`);
    }
    for (const attachment of manifest.attachments) {
      const entry = byName.get(zipName(attachment.path))!;
      if (entry.uncompressedSize !== attachment.size) throw new Error(`Backup attachment size failed: ${attachment.path}`);
      await verifyBoundedZipEntry(entry, attachment.size);
    }
    for (const descriptor of manifest.revisions ?? []) {
      const entry = byName.get(descriptor.entry)!;
      if (entry.uncompressedSize > MAX_REVISION_BYTES) throw new Error('Backup revision is too large');
      const revision = revisionSchema.parse(JSON.parse(await readBoundedZipText(entry, MAX_REVISION_BYTES)));
      if (revision.id !== descriptor.id || revision.noteId !== descriptor.noteId || await checksumMarkdown(revision.markdown) !== revision.checksum) throw new Error('Backup revision checksum failed');
    }
    return { vaultName: manifest.vault.name, exportedAt: manifest.exportedAt, version: 1, notes: manifest.notes.length, folders: manifest.folders.length, attachments: manifest.attachments.length, revisions: manifest.revisions?.length ?? 0, archiveBytes: archive.size };
  } finally { await reader.close(); }
}

export async function exportVaultZip(repository: VaultRepository, vaultId: string, folderPath?: string): Promise<Blob> {
  const { BlobReader, BlobWriter, TextReader, ZipWriter } = await import('@zip.js/zip.js');
  const tree = await repository.listTree(vaultId);
  const selected = (path: string) => !folderPath || path === folderPath || path.startsWith(`${folderPath}/`);
  const rebase = (path: string) => folderPath ? `/${path.slice(folderPath.length).replace(/^\//u, '')}` : path;
  const folders = tree.folders.filter((item) => selected(item.path));
  const notes = tree.notes.filter((item) => selected(item.path));
  const attachments = tree.attachments.filter((item) => selected(item.path));
  const schemas = (await repository.listObjects('metadataSchema', vaultId)).flatMap((item) => { const parsed = metadataSchemaSchema.safeParse(item); return parsed.success ? [parsed.data] : []; })
    .filter((schema) => schema.scope === 'base' ? !folderPath : schema.scope !== 'folder' || folders.some((folder) => folder.id === schema.selector && (!folderPath || folder.path !== folderPath)));
  const bases = folderPath ? [] : (await repository.listObjects('base', vaultId)).map((item) => baseSchema.parse(item));
  for (const base of bases) readBaseDefinition(base);
  const canvases = folderPath ? [] : (await repository.listObjects('canvas', vaultId)).map((item) => canvasSchema.parse(item));
  for (const canvas of canvases) readCanvasDocument(canvas);
  const workspaces = folderPath ? [] : await new WorkspacesStore(repository, vaultId).list();
  const dashboards = folderPath ? [] : (await repository.listObjects('dashboard', vaultId)).map((item) => dashboardSchema.parse(item));
  const studyCards = (await repository.listObjects('studyCard', vaultId)).map((item) => studyCardSchema.parse(item)).filter((card) => notes.some((note) => note.id === card.sourceNoteId));
  const bookmarks = folderPath ? [] : await new BookmarksStore(repository, vaultId).list();
  const pdfAnnotations = (await repository.listObjects('pdfAnnotation', vaultId)).map((item) => pdfAnnotationSchema.parse(item)).filter((item) => attachments.some((attachment) => attachment.id === item.attachmentId));
  const ocrRecords = (await repository.listObjects('ocrRecord', vaultId)).map((item) => ocrRecordSchema.parse(item)).filter((item) => attachments.some((attachment) => attachment.id === item.attachmentId));
  const transcripts = (await repository.listObjects('transcript', vaultId)).map((item) => transcriptSchema.parse(item)).filter((item) => attachments.some((attachment) => attachment.id === item.attachmentId));
  const revisions: Revision[] = [];
  for (const note of notes) revisions.push(...await repository.listRevisions(note.id));
  if (notes.length + attachments.length + revisions.length + 1 > MAX_ENTRIES) throw new Error('Vault has too many files and revisions for one ZIP');
  const exportedRevisions = revisions.map((item) => revisionSchema.parse({
    ...item, path: folderPath && selected(item.path) ? rebase(item.path) : item.path,
    ...(item.metadata ? { metadata: folders.some((folder) => folder.id === item.metadata?.folderId) || item.metadata.folderId === null ? { ...item.metadata, folderId: folderPath && item.metadata.folderId === folders.find((folder) => folder.path === folderPath)?.id ? null : item.metadata.folderId } : undefined } : {}),
  }));
  const manifest: VaultArchiveManifest = vaultArchiveManifestSchema.parse({
    format: 'noor-note-vault', version: 1, exportedAt: new Date().toISOString(),
    vault: { id: tree.vault.id, name: folderPath ? `${tree.vault.name} — ${folderPath.split('/').at(-1)}` : tree.vault.name, settings: tree.vault.settings },
    folders: folders.map((item) => ({ id: item.id, parentId: folderPath && item.parentId === folders.find((folder) => folder.path === folderPath)?.id ? null : item.parentId, name: item.name, path: rebase(item.path), createdAt: item.createdAt, updatedAt: item.updatedAt })).filter((item) => item.path !== '/'),
    notes: notes.map((item) => ({ id: item.id, folderId: folderPath && item.path.startsWith(`${folderPath}/`) && item.folderId === folders.find((folder) => folder.path === folderPath)?.id ? null : item.folderId, path: rebase(item.path), title: item.title, createdAt: item.createdAt, updatedAt: item.updatedAt, aliases: item.aliases, properties: item.properties, checksum: item.checksum })),
    attachments: attachments.map((item) => ({ id: item.id, folderId: folderPath && item.folderId === folders.find((folder) => folder.path === folderPath)?.id ? null : item.folderId, path: rebase(item.path), name: item.name, mime: item.mime, size: item.size, createdAt: item.createdAt, updatedAt: item.updatedAt, ...(item.recording ? { recording: item.recording } : {}) })),
    metadataSchemas: schemas,
    bases,
    canvases,
    workspaces,
    dashboards,
    studyCards,
    bookmarks,
    pdfAnnotations,
    ocrRecords,
    transcripts,
    revisions: exportedRevisions.map((item) => ({ id: item.id, noteId: item.noteId, entry: `.noor-history/${item.id}.json` })),
  });
  const writer = new ZipWriter(new BlobWriter('application/zip'));
  try {
    await writer.add(MANIFEST_NAME, new TextReader(JSON.stringify(manifest, null, 2)));
    for (const note of notes) {
      const full = await repository.getNote(note.id);
      if (!full) throw new Error('A note disappeared during export');
      await writer.add(zipName(rebase(note.path)), new TextReader(full.markdown));
    }
    for (const revision of exportedRevisions) await writer.add(`.noor-history/${revision.id}.json`, new TextReader(JSON.stringify(revision)));
    for (const attachment of attachments) {
      const blob = await repository.getAttachmentBlob(attachment.id);
      if (!blob) throw new Error(`Attachment is missing: ${attachment.path}`);
      await writer.add(zipName(rebase(attachment.path)), new BlobReader(blob));
    }
    return await writer.close();
  } catch (error) { await writer.close().catch(() => undefined); throw error; }
}

export async function importVaultZip(repository: VaultRepository, archive: Blob): Promise<string> {
  const { BlobReader, ZipReader } = await import('@zip.js/zip.js');
  const reader = new ZipReader(new BlobReader(archive));
  const previous = await repository.getActiveVault();
  let importedVaultId: string | null = null;
  try {
    const entries = (await reader.getEntries()).filter((entry) => !entry.directory);
    if (entries.length > MAX_ENTRIES) throw new Error('ZIP contains too many files');
    const names = new Set<string>();
    let total = 0;
    for (const entry of entries) {
      assertZipName(entry.filename);
      if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0) throw new Error('ZIP entry size is invalid');
      if (names.has(entry.filename)) throw new Error('ZIP contains duplicate paths');
      names.add(entry.filename);
      total += entry.uncompressedSize;
      if (total > MAX_TOTAL_BYTES) throw new Error('ZIP is too large to import');
    }
    const byName = new Map(entries.map((entry) => [entry.filename, entry]));
    const manifestEntry = byName.get(MANIFEST_NAME);
    if (!manifestEntry || !manifestEntry.getData || manifestEntry.uncompressedSize > MAX_MANIFEST_BYTES) throw new Error('Noor Note ZIP manifest is missing or too large');
    const manifestText = await readBoundedZipText(manifestEntry, MAX_MANIFEST_BYTES);
    const manifest = vaultArchiveManifestSchema.parse(JSON.parse(manifestText));
    const required = [...manifest.notes.map((item) => zipName(item.path)), ...manifest.attachments.map((item) => zipName(item.path)), ...(manifest.revisions ?? []).map((item) => item.entry)];
    for (const name of required) if (!byName.has(name)) throw new Error(`ZIP file is missing: ${name}`);
    const vault = await repository.createVault(manifest.vault.name);
    importedVaultId = vault.id;
    const folderIds = new Map<string, string>();
    for (const folder of [...manifest.folders].sort((a, b) => a.path.split('/').length - b.path.split('/').length)) {
      const parentId = folder.parentId ? folderIds.get(folder.parentId) : null;
      if (folder.parentId && !parentId) throw new Error('ZIP folder parent is missing');
      const created = await repository.createFolder(vault.id, parentId ?? null, folder.name);
      if (created.path !== folder.path) throw new Error('ZIP folder path is inconsistent');
      folderIds.set(folder.id, created.id);
    }
    const baseIds = new Map<string, string>();
    for (const base of manifest.bases ?? []) {
      const definition = readBaseDefinition(base);
      const folderId = definition.query.folderId ? folderIds.get(definition.query.folderId) : null;
      if (definition.query.folderId && !folderId) throw new Error('Base query folder is missing');
      const formFolderId = definition.form.targetFolderId ? folderIds.get(definition.form.targetFolderId) : null;
      if (definition.form.targetFolderId && !formFolderId) throw new Error('Base form destination folder is missing');
      const id = crypto.randomUUID();
      baseIds.set(base.id, id);
      await repository.putObject('base', { ...base, id, vaultId: vault.id, definition: { ...definition, query: { ...definition.query, folderId }, form: { ...definition.form, targetFolderId: formFolderId, noteTemplateId: null } } });
    }
    for (const schema of manifest.metadataSchemas ?? []) {
      const selector = schema.scope === 'folder' ? folderIds.get(schema.selector) : schema.scope === 'base' ? baseIds.get(schema.selector) : schema.selector;
      if (!selector) throw new Error('Metadata schema folder is missing');
      await repository.putObject('metadataSchema', { ...schema, id: crypto.randomUUID(), vaultId: vault.id, selector });
    }
    const noteIds = new Map<string, string>();
    for (const note of manifest.notes) {
      const entry = byName.get(zipName(note.path));
      if (!entry?.getData || entry.uncompressedSize > MAX_NOTE_BYTES) throw new Error('ZIP note is missing or too large');
      const markdown = await readBoundedZipText(entry, MAX_NOTE_BYTES);
      if (await checksumMarkdown(markdown) !== note.checksum) throw new Error(`ZIP note checksum failed: ${note.path}`);
      const folderId = note.folderId ? folderIds.get(note.folderId) : null;
      if (note.folderId && !folderId) throw new Error('ZIP note folder is missing');
      const created = await repository.importNote(vault.id, folderId ?? null, { ...note, markdown });
      noteIds.set(note.id, created.id);
    }
    for (const source of manifest.bases ?? []) {
      const templateId = readBaseDefinition(source).form.noteTemplateId;
      if (!templateId) continue;
      const mapped = noteIds.get(templateId);
      if (!mapped) throw new Error('Base form note template is missing');
      const imported = (await repository.listObjects('base', vault.id)).find((item) => item.id === baseIds.get(source.id));
      if (!imported) throw new Error('Imported Base is unavailable');
      const definition = readBaseDefinition(baseSchema.parse(imported));
      await repository.putObject('base', { ...imported, definition: { ...definition, form: { ...definition.form, noteTemplateId: mapped } } });
    }
    const attachmentIds = new Map<string, string>();
    for (const attachment of manifest.attachments) {
      const entry = byName.get(zipName(attachment.path));
      if (!entry?.getData || entry.uncompressedSize !== attachment.size) throw new Error('ZIP attachment is missing or has the wrong size');
      const folderId = attachment.folderId ? folderIds.get(attachment.folderId) : null;
      if (attachment.folderId && !folderId) throw new Error('ZIP attachment folder is missing');
      const blob = await readBoundedZipBlob(entry, attachment.size, attachment.mime);
      if (blob.size !== attachment.size) throw new Error('ZIP attachment has the wrong size');
      const created = await repository.addAttachment(vault.id, folderId ?? null, blob, attachment.name, attachment.recording);
      if (created.path !== attachment.path) throw new Error('ZIP attachment path is inconsistent');
      attachmentIds.set(attachment.id, created.id);
    }
    const annotationIds = new Map<string, string>();
    for (const source of manifest.pdfAnnotations ?? []) {
      const attachmentId = attachmentIds.get(source.attachmentId);
      if (!attachmentId) throw new Error('PDF annotation attachment is missing');
      const id = crypto.randomUUID();
      annotationIds.set(source.id, id);
      await repository.putObject('pdfAnnotation', pdfAnnotationSchema.parse({ ...source, id, vaultId: vault.id, attachmentId }));
    }
    for (const source of manifest.ocrRecords ?? []) {
      const attachmentId = attachmentIds.get(source.attachmentId);
      if (!attachmentId) throw new Error('OCR source attachment is missing');
      await repository.putObject('ocrRecord', ocrRecordSchema.parse({ ...source, id: crypto.randomUUID(), vaultId: vault.id, attachmentId }));
    }
    for (const source of manifest.transcripts ?? []) {
      const attachmentId = attachmentIds.get(source.attachmentId);
      if (!attachmentId) throw new Error('Transcript source attachment is missing');
      await repository.putObject('transcript', transcriptSchema.parse({ ...source, id: crypto.randomUUID(), vaultId: vault.id, attachmentId, segments: source.segments.map((segment) => ({ ...segment, id: crypto.randomUUID() })) }));
    }
    if (attachmentIds.size) for (const importedId of noteIds.values()) {
      const note = await repository.getNote(importedId);
      if (!note) continue;
      const markdown = note.markdown.replace(/([&#]noor-pdf=|[&#]noor-transcript=|[&#]annotation=)([0-9a-f-]{36})/giu, (raw, key: string, id: string) => {
        const mapped = key.includes('noor-pdf') || key.includes('noor-transcript') ? attachmentIds.get(id) : annotationIds.get(id);
        return mapped ? `${key}${mapped}` : raw;
      });
      if (markdown !== note.markdown) await repository.saveNote(importedId, { markdown }, true);
    }
    const revisionIds = new Map((manifest.revisions ?? []).map((item) => [item.id, crypto.randomUUID()]));
    const historyByNote = new Map<string, Revision[]>();
    for (const descriptor of manifest.revisions ?? []) {
      const entry = byName.get(descriptor.entry);
      if (!entry?.getData || entry.uncompressedSize > MAX_REVISION_BYTES) throw new Error('ZIP revision is missing or too large');
      const source = revisionSchema.parse(JSON.parse(await readBoundedZipText(entry, MAX_REVISION_BYTES)));
      if (source.id !== descriptor.id || source.noteId !== descriptor.noteId || await checksumMarkdown(source.markdown) !== source.checksum) throw new Error('ZIP revision failed validation');
      const noteId = noteIds.get(source.noteId);
      if (!noteId) throw new Error('ZIP revision note is missing');
      const mappedFolderId = source.metadata?.folderId ? folderIds.get(source.metadata.folderId) : null;
      const metadata = source.metadata && (!source.metadata.folderId || mappedFolderId) ? { ...source.metadata, folderId: mappedFolderId ?? null } : undefined;
      const mapped = revisionSchema.parse({ ...source, id: revisionIds.get(source.id), vaultId: vault.id, noteId,
        ...(metadata ? { metadata } : { metadata: undefined }),
        ...(source.restoredFromId ? { restoredFromId: revisionIds.get(source.restoredFromId) } : {}),
      });
      historyByNote.set(noteId, [...(historyByNote.get(noteId) ?? []), mapped]);
    }
    for (const [noteId, history] of historyByNote) await repository.importRevisionHistory(noteId, history);
    const importedCanvases: Canvas[] = [];
    const canvasIds = new Map<string, string>();
    for (const canvas of manifest.canvases ?? []) {
      const source = readCanvasDocument(canvas);
      const document = canvasDocumentSchema.parse({ ...source, nodes: source.nodes.map((node) => ({ ...node, noteId: node.noteId ? noteIds.get(node.noteId) ?? null : null, attachmentId: node.attachmentId ? attachmentIds.get(node.attachmentId) ?? null : null })) });
      const created = newCanvas(vault.id, canvas.title, importedCanvases, document);
      if (created.path !== canvas.path) throw new Error('ZIP Canvas path is inconsistent');
      const imported = canvasSchema.parse({ ...created, createdAt: canvas.createdAt, updatedAt: canvas.updatedAt, deletedAt: canvas.deletedAt });
      await repository.putObject('canvas', imported);
      importedCanvases.push(imported);
      canvasIds.set(canvas.id, imported.id);
    }
    const bookmarkStore = new BookmarksStore(repository, vault.id);
    const groupIds = new Map<string, string>();
    for (const item of manifest.bookmarks ?? []) if (item.kind === 'group') {
      const created = await bookmarkStore.create({ kind: 'group', title: item.title, parentId: null });
      groupIds.set(item.id, created.id);
    }
    for (const item of manifest.bookmarks ?? []) if (item.kind === 'group' && item.parentId && groupIds.has(item.parentId)) {
      const created = (await bookmarkStore.list()).find((entry) => entry.id === groupIds.get(item.id));
      if (created) await bookmarkStore.update(created, { parentId: groupIds.get(item.parentId) });
    }
    for (const item of manifest.bookmarks ?? []) if (item.kind !== 'group') {
      const noteId = item.noteId ? noteIds.get(item.noteId) : undefined;
      const resourceId = item.resourceId ? (item.kind === 'base' ? baseIds.get(item.resourceId) : item.kind === 'canvas' ? canvasIds.get(item.resourceId) : undefined) : undefined;
      if (item.noteId && !noteId || item.resourceId && !resourceId) continue;
      await bookmarkStore.create({ kind: item.kind, title: item.title, parentId: item.parentId ? groupIds.get(item.parentId) ?? null : null, noteId, resourceId, fragment: item.fragment, query: item.query, url: item.url, favorite: item.favorite, pinned: item.pinned });
    }
    const workspaceStore = new WorkspacesStore(repository, vault.id);
    for (const saved of manifest.workspaces ?? []) {
      const layout = remapWorkspaceLayout(parseWorkspaceLayout(saved.layout), noteIds, canvasIds, baseIds, folderIds);
      await workspaceStore.create(saved.name, layout);
    }
    for (const saved of manifest.dashboards ?? []) {
      await repository.putObject('dashboard', dashboardSchema.parse({ ...saved, id: crypto.randomUUID(), vaultId: vault.id, widgets: saved.widgets.map((widget) => ({ ...widget, id: crypto.randomUUID(), baseId: widget.baseId ? baseIds.get(widget.baseId) ?? null : null })) }));
    }
    for (const saved of manifest.studyCards ?? []) {
      const sourceNoteId = noteIds.get(saved.sourceNoteId);
      if (!sourceNoteId) throw new Error('Study card source note is missing');
      await repository.putObject('studyCard', studyCardSchema.parse({ ...saved, id: crypto.randomUUID(), vaultId: vault.id, sourceNoteId }));
    }
    const sourceTemplates = manifest.vault.settings.templates;
    const folderTemplates = Object.fromEntries(Object.entries(sourceTemplates.folderTemplates).flatMap(([folderId, templateId]) => {
      const mappedFolder = folderIds.get(folderId), mappedTemplate = noteIds.get(templateId);
      return mappedFolder && mappedTemplate ? [[mappedFolder, mappedTemplate]] : [];
    }));
    const baseTemplates = Object.fromEntries(Object.entries(sourceTemplates.baseTemplates).flatMap(([baseId, templateId]) => {
      const mappedBase = baseIds.get(baseId), mappedTemplate = noteIds.get(templateId);
      return mappedBase && mappedTemplate ? [[mappedBase, mappedTemplate]] : [];
    }));
    const periodNotes = Object.fromEntries((['daily', 'weekly', 'monthly', 'quarterly', 'yearly'] as PeriodKind[]).map((kind) => {
      const rule = manifest.vault.settings.periodNotes[kind];
      return [kind, { ...rule, folderId: rule.folderId ? folderIds.get(rule.folderId) ?? null : null, templateId: rule.templateId ? noteIds.get(rule.templateId) ?? null : null }];
    })) as PeriodNotesSettings;
    await repository.updateVaultSettings(vault.id, { ...manifest.vault.settings, periodNotes, templates: {
      folderId: sourceTemplates.folderId ? folderIds.get(sourceTemplates.folderId) ?? null : null,
      defaultTemplateId: sourceTemplates.defaultTemplateId ? noteIds.get(sourceTemplates.defaultTemplateId) ?? null : null,
      dailyTemplateId: sourceTemplates.dailyTemplateId ? noteIds.get(sourceTemplates.dailyTemplateId) ?? null : null,
      folderTemplates, baseTemplates,
    } });
    return vault.id;
  } catch (error) {
    if (importedVaultId) { await repository.purgeVault(importedVaultId).catch(() => undefined); await repository.setActiveVault(previous.id).catch(() => undefined); }
    throw error;
  } finally { await reader.close(); }
}
