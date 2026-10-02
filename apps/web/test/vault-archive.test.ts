import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { BlobReader, BlobWriter, TextReader, TextWriter, ZipReader, ZipWriter } from '@zip.js/zip.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendCanvasNode, baseSchema, canvasSchema, createCanvasNode, metadataSchemaSchema, newBase, newCanvas, ocrRecordSchema, parsePdfReference, pdfAnnotationSchema, pdfReferenceLink, readBaseDefinition, readCanvasDocument, transcriptSchema, withCanvasDocument } from '@noor-note/core';
import { DexieVaultRepository, type AttachmentBytesStore } from '@noor-note/storage';
import { exportVaultZip, importVaultZip, verifyVaultZip } from '../src/lib/vault-archive';
import { defaultWorkspaceLayout, parseWorkspaceLayout, WorkspacesStore } from '../src/lib/workspace-layout';
import { BookmarksStore } from '../src/lib/bookmarks';
import { PdfAnnotationsStore } from '../src/lib/pdf-annotations';
import { OcrStore } from '../src/lib/ocr-store';
import { TranscriptStore } from '../src/lib/transcript-store';

describe('vault ZIP portability', () => {
  let repository: DexieVaultRepository;
  let databaseName: string;
  const blobs = new Map<string, Blob>();
  const bytes: AttachmentBytesStore = {
    async write(id, blob) { blobs.set(id, blob); return 'indexeddb'; },
    async read(item) { return blobs.get(item.id); },
    async remove(item) { blobs.delete(item.id); },
  };
  beforeEach(() => {
    vi.stubGlobal('window', {});
    databaseName = `noor-note-zip-test-${crypto.randomUUID()}`;
    repository = new DexieVaultRepository(databaseName, bytes);
    blobs.clear();
  });
  afterEach(async () => {
    repository.close();
    await Dexie.delete(databaseName);
    vi.unstubAllGlobals();
  });

  it('exports Markdown and attachments, then imports a separate vault with working relative paths', async () => {
    const vault = await repository.initialize();
    const folder = await repository.createFolder(vault.id, null, 'Research');
    const assets = await repository.createFolder(vault.id, folder.id, 'assets');
    await repository.createNote(vault.id, folder.id, 'Overview', 'See ![](assets/chart.png)');
    await repository.addAttachment(vault.id, assets.id, new Blob(['png bytes'], { type: 'image/png' }), 'chart.png');
    const zip = await exportVaultZip(repository, vault.id);
    expect(zip.size).toBeGreaterThan(0);
    expect(await verifyVaultZip(zip)).toMatchObject({ vaultName: vault.name, notes: 1, folders: 2, attachments: 1, version: 1 });
    expect((await repository.listVaults()).length).toBe(1);
    const importedId = await importVaultZip(repository, zip);
    expect(importedId).not.toBe(vault.id);
    const tree = await repository.listTree(importedId);
    expect(tree.notes.map((note) => note.path)).toEqual(['/Research/Overview.md']);
    expect(tree.attachments.map((attachment) => attachment.path)).toEqual(['/Research/assets/chart.png']);
    expect((await repository.getNote(tree.notes[0]!.id))?.markdown).toBe('See ![](assets/chart.png)');
    expect(await (await repository.getAttachmentBlob(tree.attachments[0]!.id))?.text()).toBe('png bytes');
  });

  it('rejects changed checksums and unsupported versions before creating a vault', async () => {
    const vault = await repository.initialize();
    await repository.createNote(vault.id, null, 'Source', 'Untouched content');
    const original = await exportVaultZip(repository, vault.id);
    const rewrite = async (change: (manifest: { version: number; notes: { checksum: string }[] }) => void) => {
      const reader = new ZipReader(new BlobReader(original));
      const writer = new ZipWriter(new BlobWriter('application/zip'));
      try {
        for (const entry of (await reader.getEntries()).filter((item) => !item.directory)) {
          if (entry.filename === 'noor-note.json') {
            const manifest = JSON.parse(await entry.getData(new TextWriter())) as { version: number; notes: { checksum: string }[] };
            change(manifest);
            await writer.add(entry.filename, new TextReader(JSON.stringify(manifest)));
          } else await writer.add(entry.filename, new BlobReader(await entry.getData(new BlobWriter())));
        }
        return writer.close();
      } finally { await reader.close(); }
    };
    await expect(verifyVaultZip(await rewrite((manifest) => { manifest.notes[0]!.checksum = '0'.repeat(64); }))).rejects.toThrow('checksum failed');
    await expect(verifyVaultZip(await rewrite((manifest) => { manifest.version = 99; }))).rejects.toThrow('version is not supported');
    expect((await repository.listVaults()).length).toBe(1);
  });

  it('round trips revision history with remapped note and revision IDs', async () => {
    const vault = await repository.initialize();
    const note = await repository.createNote(vault.id, null, 'Plan', 'First');
    await repository.saveNote(note.id, { markdown: 'Second', properties: { stage: 2 } }, true);
    const importedId = await importVaultZip(repository, await exportVaultZip(repository, vault.id));
    const imported = (await repository.listTree(importedId)).notes[0]!;
    const history = await repository.listRevisions(imported.id);
    expect(history.map((item) => item.markdown)).toContain('First');
    expect(history.map((item) => item.markdown)).toContain('Second');
    expect(history.every((item) => item.noteId === imported.id && item.vaultId === importedId)).toBe(true);
    const first = history.find((item) => item.markdown === 'First')!;
    expect(first.id).not.toBe((await repository.listRevisions(note.id)).find((item) => item.markdown === 'First')?.id);
    const current = (await repository.getNote(imported.id))!;
    expect((await repository.restoreRevision(imported.id, first.id, current.revision)).markdown).toBe('First');
  });

  it('rebases folder revision paths when exporting a folder ZIP', async () => {
    const vault = await repository.initialize();
    const folder = await repository.createFolder(vault.id, null, 'Research');
    const note = await repository.createNote(vault.id, folder.id, 'Plan', 'First');
    await repository.saveNote(note.id, { markdown: 'Second' }, true);
    const importedId = await importVaultZip(repository, await exportVaultZip(repository, vault.id, folder.path));
    const imported = (await repository.listTree(importedId)).notes[0]!;
    const source = (await repository.listRevisions(imported.id)).find((item) => item.markdown === 'First')!;
    expect(source.path).toBe('/Plan.md');
    const current = (await repository.getNote(imported.id))!;
    expect((await repository.restoreRevision(imported.id, source.id, current.revision)).path).toBe('/Plan.md');
  });

  it('preserves voice recording metadata and bytes in a vault ZIP', async () => {
    const vault = await repository.initialize();
    const recordedAt = '2026-09-24T10:00:00.000Z';
    await repository.addAttachment(vault.id, null, new Blob(['opus audio'], { type: 'audio/webm;codecs=opus' }), 'Voice.webm', { recordedAt, durationMs: 2400 });
    const importedId = await importVaultZip(repository, await exportVaultZip(repository, vault.id));
    const restored = (await repository.listTree(importedId)).attachments[0]!;
    expect(restored.recording).toEqual({ recordedAt, durationMs: 2400 });
    expect(await (await repository.getAttachmentBlob(restored.id))?.text()).toBe('opus audio');
  });

  it('stores PDF annotations beside immutable PDF bytes and remaps links on ZIP import', async () => {
    const vault = await repository.initialize();
    const originalBytes = '%PDF-1.4 original bytes';
    const attachment = await repository.addAttachment(vault.id, null, new Blob([originalBytes], { type: 'application/pdf' }), 'Source.pdf');
    const store = new PdfAnnotationsStore(repository, vault.id);
    const annotation = await store.create(attachment.id, { page: 2, kind: 'comment', quote: 'Selected passage', comment: 'Useful source', color: 'green', rects: [{ x: .1, y: .2, width: .4, height: .05 }] });
    const note = await repository.createNote(vault.id, null, 'Quote', (path) => pdfReferenceLink(path, attachment, 2, annotation.id));
    expect(await (await repository.getAttachmentBlob(attachment.id))?.text()).toBe(originalBytes);
    const changed = await store.update(annotation, 'Updated context', 'blue');
    expect(changed.comment).toBe('Updated context');
    await expect(store.update(annotation, 'Old edit', 'pink')).rejects.toThrow('changed');

    const importedId = await importVaultZip(repository, await exportVaultZip(repository, vault.id));
    const importedTree = await repository.listTree(importedId);
    const importedPdf = importedTree.attachments[0]!;
    const importedNote = await repository.getNote(importedTree.notes[0]!.id);
    const importedAnnotation = pdfAnnotationSchema.parse((await repository.listObjects('pdfAnnotation', importedId))[0]);
    const link = importedNote?.markdown.match(/\]\(([^)]+)\)/u)?.[1];
    expect(importedAnnotation).toMatchObject({ vaultId: importedId, attachmentId: importedPdf.id, page: 2, comment: 'Updated context', color: 'blue' });
    expect(importedAnnotation.id).not.toBe(annotation.id);
    expect(parsePdfReference(link ?? '')).toMatchObject({ page: 2, attachmentId: importedPdf.id, annotationId: importedAnnotation.id });
    expect(await (await repository.getAttachmentBlob(importedPdf.id))?.text()).toBe(originalBytes);
    expect((await repository.getNote(note.id))?.markdown).toContain(annotation.id);
  });

  it('remaps a page-only PDF link when importing a vault', async () => {
    const vault = await repository.initialize();
    const attachment = await repository.addAttachment(vault.id, null, new Blob(['PDF'], { type: 'application/pdf' }), 'Source.pdf');
    await repository.createNote(vault.id, null, 'Page', (path) => pdfReferenceLink(path, attachment, 8));
    const importedId = await importVaultZip(repository, await exportVaultZip(repository, vault.id));
    const tree = await repository.listTree(importedId);
    const note = await repository.getNote(tree.notes[0]!.id);
    const link = note?.markdown.match(/\]\(([^)]+)\)/u)?.[1];
    expect(parsePdfReference(link ?? '')?.attachmentId).toBe(tree.attachments[0]?.id);
  });

  it('keeps annotations through Trash restore and removes them with permanently deleted PDFs', async () => {
    const vault = await repository.initialize();
    const attachment = await repository.addAttachment(vault.id, null, new Blob(['PDF'], { type: 'application/pdf' }), 'Source.pdf');
    const store = new PdfAnnotationsStore(repository, vault.id);
    await store.create(attachment.id, { page: 1, kind: 'highlight', quote: 'Quote', comment: '', color: 'yellow', rects: [{ x: .2, y: .3, width: .4, height: .05 }] });
    await repository.deleteAttachment(attachment.id);
    await repository.restoreAttachment(attachment.id);
    expect(await store.list(attachment.id)).toHaveLength(1);
    await repository.deleteAttachment(attachment.id);
    await repository.permanentlyDeleteAttachment(attachment.id);
    expect(await store.list(attachment.id)).toHaveLength(0);
  });

  it('round trips corrected OCR text separately from the original image', async () => {
    const vault = await repository.initialize();
    const attachment = await repository.addAttachment(vault.id, null, new Blob(['original image'], { type: 'image/png' }), 'scan.png');
    const saved = await new OcrStore(repository, vault.id).save(attachment.id, 1, { providerId: 'tesseract-browser', languages: ['eng', 'swe'], detectedText: 'fakfura', text: 'faktura', confidence: 72 }, null);
    const importedId = await importVaultZip(repository, await exportVaultZip(repository, vault.id));
    const imported = (await repository.listTree(importedId)).attachments[0]!;
    const restored = ocrRecordSchema.parse((await repository.listObjects('ocrRecord', importedId))[0]);
    expect(restored).toMatchObject({ vaultId: importedId, attachmentId: imported.id, languages: ['eng', 'swe'], detectedText: 'fakfura', text: 'faktura' });
    expect(restored.id).not.toBe(saved.id);
    expect(await (await repository.getAttachmentBlob(imported.id))?.text()).toBe('original image');
  });

  it('round trips timestamped transcript sidecars with remapped attachment and segment IDs', async () => {
    const vault = await repository.initialize();
    const attachment = await repository.addAttachment(vault.id, null, new Blob(['original audio'], { type: 'audio/webm' }), 'voice.webm');
    await repository.createNote(vault.id, null, 'Source link', `[0:01](https://notes.example/#noor-transcript=${attachment.id}&t=1200)`);
    const segmentId = crypto.randomUUID();
    const saved = await new TranscriptStore(repository, vault.id).save(attachment.id, { providerId: 'whisper-browser', language: null, segments: [{ id: segmentId, startMs: 1200, endMs: 2800, text: 'corrected phrase', speaker: null, confidence: null }] }, null);
    const importedId = await importVaultZip(repository, await exportVaultZip(repository, vault.id));
    const imported = (await repository.listTree(importedId)).attachments[0]!;
    const restored = transcriptSchema.parse((await repository.listObjects('transcript', importedId))[0]);
    expect(restored).toMatchObject({ vaultId: importedId, attachmentId: imported.id, text: 'corrected phrase', segments: [{ startMs: 1200, endMs: 2800 }] });
    expect(restored.id).not.toBe(saved.id);
    expect(restored.segments[0]?.id).not.toBe(segmentId);
    expect(await (await repository.getAttachmentBlob(imported.id))?.text()).toBe('original audio');
    const linked = await repository.getNote((await repository.listTree(importedId)).notes[0]!.id);
    expect(linked?.markdown).toContain(`#noor-transcript=${imported.id}&t=1200`);
  });

  it('includes OCR sidecars only for attachments inside an exported folder', async () => {
    const vault = await repository.initialize();
    const folder = await repository.createFolder(vault.id, null, 'Scans');
    const inside = await repository.addAttachment(vault.id, folder.id, new Blob(['inside'], { type: 'image/png' }), 'inside.png');
    const outside = await repository.addAttachment(vault.id, null, new Blob(['outside'], { type: 'image/png' }), 'outside.png');
    const store = new OcrStore(repository, vault.id);
    for (const attachment of [inside, outside]) await store.save(attachment.id, 1, { providerId: 'tesseract-browser', languages: ['eng'], detectedText: attachment.name, text: attachment.name, confidence: null }, null);
    const importedId = await importVaultZip(repository, await exportVaultZip(repository, vault.id, folder.path));
    const tree = await repository.listTree(importedId);
    const restored = (await repository.listObjects('ocrRecord', importedId)).map((item) => ocrRecordSchema.parse(item));
    expect(tree.attachments.map((item) => item.name)).toEqual(['inside.png']);
    expect(restored).toMatchObject([{ attachmentId: tree.attachments[0]?.id, text: 'inside.png' }]);
  });

  it('exports a folder as a standalone ZIP rooted at that folder', async () => {
    const vault = await repository.initialize();
    const folder = await repository.createFolder(vault.id, null, 'Research');
    const nested = await repository.createFolder(vault.id, folder.id, 'Sources');
    await repository.createNote(vault.id, folder.id, 'Overview', 'Body');
    await repository.createNote(vault.id, nested.id, 'Citation', 'Source');
    const zip = await exportVaultZip(repository, vault.id, folder.path);
    const importedId = await importVaultZip(repository, zip);
    expect((await repository.listTree(importedId)).notes.map((note) => note.path).sort()).toEqual(['/Overview.md', '/Sources/Citation.md']);
  });

  it('round trips optional property schemas and remaps folder selectors', async () => {
    const vault = await repository.initialize();
    const folder = await repository.createFolder(vault.id, null, 'Research');
    const timestamp = new Date().toISOString();
    const schemaId = crypto.randomUUID();
    await repository.putObject('metadataSchema', { id: schemaId, vaultId: vault.id, name: 'Research fields', scope: 'folder', selector: folder.id, fields: [{ name: 'status', type: 'singleSelect', options: ['Draft', 'Done'], defaultValue: 'Draft' }], createdAt: timestamp, updatedAt: timestamp });
    const importedId = await importVaultZip(repository, await exportVaultZip(repository, vault.id));
    const importedFolder = (await repository.listTree(importedId)).folders.find((item) => item.path === '/Research');
    const schemas = (await repository.listObjects('metadataSchema', importedId)).map((item) => metadataSchemaSchema.parse(item));
    expect(schemas).toMatchObject([{ vaultId: importedId, name: 'Research fields', scope: 'folder', selector: importedFolder?.id, fields: [{ name: 'status', defaultValue: 'Draft' }] }]);
    expect(schemas[0]?.id).not.toBe(schemaId);
  });

  it('round trips saved Bases and remaps their folder query to imported notes', async () => {
    const vault = await repository.initialize();
    const folder = await repository.createFolder(vault.id, null, 'Research');
    await repository.createNote(vault.id, folder.id, 'Draft', 'Body');
    const base = newBase(vault.id, 'Research board', []);
    const definition = readBaseDefinition(base);
    const formulaId = crypto.randomUUID();
    await repository.putObject('base', { ...base, definition: { ...definition, query: { ...definition.query, folderId: folder.id }, formulas: [{ id: formulaId, name: 'Score', expression: 'price * quantity' }], views: [{ ...definition.views[0]!, kind: 'kanban', groupBy: 'property:status', aggregates: [{ id: crypto.randomUUID(), operation: 'sum', field: `formula:${formulaId}`, label: 'Total' }] }] } });
    const importedId = await importVaultZip(repository, await exportVaultZip(repository, vault.id));
    const importedFolder = (await repository.listTree(importedId)).folders[0]!;
    const importedBase = baseSchema.parse((await repository.listObjects('base', importedId))[0]);
    expect(importedBase.id).not.toBe(base.id);
    expect(readBaseDefinition(importedBase).query.folderId).toBe(importedFolder.id);
    expect(readBaseDefinition(importedBase).views[0]?.kind).toBe('kanban');
    expect(readBaseDefinition(importedBase).formulas[0]?.expression).toBe('price * quantity');
    expect(readBaseDefinition(importedBase).views[0]?.aggregates[0]?.field).toBe(`formula:${formulaId}`);
  });

  it('round trips Canvases with note and attachment references remapped to the new vault', async () => {
    const vault = await repository.initialize();
    const note = await repository.createNote(vault.id, null, 'Source', '# Source');
    const attachment = await repository.addAttachment(vault.id, null, new Blob(['image'], { type: 'image/png' }), 'photo.png');
    const canvas = newCanvas(vault.id, 'Research map', []);
    const document = appendCanvasNode(appendCanvasNode(readCanvasDocument(canvas), createCanvasNode('note', 0, 0, { noteId: note.id, filePath: note.path })), createCanvasNode('image', 300, 0, { attachmentId: attachment.id, filePath: attachment.path }));
    await repository.putObject('canvas', withCanvasDocument(canvas, document));
    const importedId = await importVaultZip(repository, await exportVaultZip(repository, vault.id));
    const importedCanvas = canvasSchema.parse((await repository.listObjects('canvas', importedId))[0]);
    const importedDocument = readCanvasDocument(importedCanvas);
    const tree = await repository.listTree(importedId);
    expect(importedDocument.nodes.find((node) => node.kind === 'note')?.noteId).toBe(tree.notes[0]?.id);
    expect(importedDocument.nodes.find((node) => node.kind === 'image')?.attachmentId).toBe(tree.attachments[0]?.id);
    expect(importedDocument.nodes.find((node) => node.kind === 'note')?.noteId).not.toBe(note.id);
  });

  it('exports saved workspaces and remaps open note tabs in imported vaults', async () => {
    const vault = await repository.initialize();
    const note = await repository.createNote(vault.id, null, 'Source', '# Source');
    await new WorkspacesStore(repository, vault.id).create('Research', defaultWorkspaceLayout(note.id));
    const importedId = await importVaultZip(repository, await exportVaultZip(repository, vault.id));
    const imported = (await new WorkspacesStore(repository, importedId).list())[0];
    const importedNote = (await repository.listTree(importedId)).notes[0];
    expect(imported?.name).toBe('Research');
    expect(imported?.id).not.toBe(note.id);
    expect(parseWorkspaceLayout(imported?.layout).editor.selectedNoteId).toBe(importedNote?.id);
  });

  it('exports nested bookmarks and remaps note, Base, and Canvas targets', async () => {
    const vault = await repository.initialize();
    const note = await repository.createNote(vault.id, null, 'Source', '# Heading');
    const base = newBase(vault.id, 'Sources', []), canvas = newCanvas(vault.id, 'Board', []);
    await repository.putObject('base', base); await repository.putObject('canvas', canvas);
    const store = new BookmarksStore(repository, vault.id);
    const group = await store.create({ kind: 'group', title: 'Research', parentId: null });
    await store.create({ kind: 'note', title: 'Source', parentId: group.id, noteId: note.id, favorite: true, pinned: true });
    await store.create({ kind: 'heading', title: 'Heading', parentId: group.id, noteId: note.id, fragment: 'heading' });
    await store.create({ kind: 'base', title: 'Sources', parentId: null, resourceId: base.id });
    await store.create({ kind: 'canvas', title: 'Board', parentId: null, resourceId: canvas.id });
    const importedId = await importVaultZip(repository, await exportVaultZip(repository, vault.id));
    const imported = await new BookmarksStore(repository, importedId).list();
    const importedGroup = imported.find((item) => item.kind === 'group')!;
    const importedNote = (await repository.listTree(importedId)).notes[0]!;
    expect(imported.find((item) => item.kind === 'note')).toMatchObject({ parentId: importedGroup.id, noteId: importedNote.id, favorite: true, pinned: true });
    expect(imported.find((item) => item.kind === 'heading')?.noteId).toBe(importedNote.id);
    expect(imported.find((item) => item.kind === 'base')?.resourceId).toBe((await repository.listObjects('base', importedId))[0]?.id);
    expect(imported.find((item) => item.kind === 'canvas')?.resourceId).toBe((await repository.listObjects('canvas', importedId))[0]?.id);
  });

  it('remaps template folder, template note, and Base rules in full-vault ZIPs', async () => {
    const vault = await repository.initialize();
    const templateFolder = await repository.createFolder(vault.id, null, 'Templates');
    const destination = await repository.createFolder(vault.id, null, 'Projects');
    const template = await repository.createNote(vault.id, templateFolder.id, 'Project template', '---\nstatus: Open\n---\n# {{title}}');
    const base = newBase(vault.id, 'Projects', []);
    await repository.putObject('base', base);
    const taskViewId = crypto.randomUUID();
    const now = new Date().toISOString();
    await repository.updateVaultSettings(vault.id, { taskViews: [{ id: taskViewId, name: 'Focus', query: 'status:open priority:high', createdAt: now, updatedAt: now }], periodNotes: {
      ...vault.settings.periodNotes,
      weekly: { ...vault.settings.periodNotes.weekly, folderId: destination.id, templateId: template.id, autoCreate: true },
    }, templates: {
      folderId: templateFolder.id, defaultTemplateId: template.id, dailyTemplateId: template.id,
      folderTemplates: { [destination.id]: template.id }, baseTemplates: { [base.id]: template.id },
    } });
    const importedId = await importVaultZip(repository, await exportVaultZip(repository, vault.id));
    const tree = await repository.listTree(importedId);
    const importedTemplate = tree.notes.find((note) => note.title === 'Project template')!;
    const importedTemplateFolder = tree.folders.find((folder) => folder.name === 'Templates')!;
    const importedDestination = tree.folders.find((folder) => folder.name === 'Projects')!;
    const importedBase = baseSchema.parse((await repository.listObjects('base', importedId))[0]);
    const settings = tree.vault.settings.templates;
    expect(settings.folderId).toBe(importedTemplateFolder.id);
    expect(settings.defaultTemplateId).toBe(importedTemplate.id);
    expect(settings.dailyTemplateId).toBe(importedTemplate.id);
    expect(settings.folderTemplates[importedDestination.id]).toBe(importedTemplate.id);
    expect(settings.baseTemplates[importedBase.id]).toBe(importedTemplate.id);
    expect(tree.vault.settings.periodNotes.weekly.folderId).toBe(importedDestination.id);
    expect(tree.vault.settings.periodNotes.weekly.templateId).toBe(importedTemplate.id);
    expect(tree.vault.settings.periodNotes.weekly.autoCreate).toBe(true);
    expect(tree.vault.settings.taskViews).toEqual([{ id: taskViewId, name: 'Focus', query: 'status:open priority:high', createdAt: now, updatedAt: now }]);
  });

  it('exports a folder with schemas for its children without dangling root selectors', async () => {
    const vault = await repository.initialize();
    const folder = await repository.createFolder(vault.id, null, 'Research');
    const child = await repository.createFolder(vault.id, folder.id, 'Sources');
    const timestamp = new Date().toISOString();
    for (const target of [folder, child]) await repository.putObject('metadataSchema', { id: crypto.randomUUID(), vaultId: vault.id, name: target.name, scope: 'folder', selector: target.id, fields: [{ name: 'owner', type: 'text', options: [] }], createdAt: timestamp, updatedAt: timestamp });
    const importedId = await importVaultZip(repository, await exportVaultZip(repository, vault.id, folder.path));
    const schemas = (await repository.listObjects('metadataSchema', importedId)).map((item) => metadataSchemaSchema.parse(item));
    expect(schemas.map((item) => item.name)).toEqual(['Sources']);
    expect(schemas[0]?.selector).toBe((await repository.listTree(importedId)).folders[0]?.id);
  });

  it('rejects an archive without a valid Noor Note manifest without creating a vault', async () => {
    const vault = await repository.initialize();
    await expect(importVaultZip(repository, new Blob(['not a ZIP']))).rejects.toThrow();
    expect((await repository.listVaults()).map((item) => item.id)).toEqual([vault.id]);
  });
});
