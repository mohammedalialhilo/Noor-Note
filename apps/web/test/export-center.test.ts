// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { BlobReader, TextWriter, ZipReader } from '@zip.js/zip.js';
import { appendCanvasNode, createCanvasNode, readBaseDefinition, readCanvasDocument } from '@noor-note/core';
import { DexieVaultRepository, type AttachmentBytesStore } from '@noor-note/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BasesStore } from '../src/lib/bases';
import { CanvasesStore } from '../src/lib/canvases';
import { createExport, loadExportInventory, portabilityReport, type ExportFormat } from '../src/lib/export-center';

describe('Export Center artifacts', () => {
  let repository: DexieVaultRepository;
  let databaseName: string;
  const blobs = new Map<string, Blob>();
  const bytes: AttachmentBytesStore = {
    async write(id, blob) { blobs.set(id, blob); return 'indexeddb'; },
    async read(item) { return blobs.get(item.id); },
    async remove(item) { blobs.delete(item.id); },
  };
  beforeEach(() => {
    databaseName = `noor-export-${crypto.randomUUID()}`;
    repository = new DexieVaultRepository(databaseName, bytes);
    blobs.clear();
  });
  afterEach(async () => { repository.close(); await Dexie.delete(databaseName); });

  async function zipEntries(blob: Blob): Promise<Map<string, string>> {
    const reader = new ZipReader(new BlobReader(blob));
    try {
      const result = new Map<string, string>();
      for (const entry of await reader.getEntries()) result.set(entry.filename, entry.directory || !entry.getData ? '' : await entry.getData(new TextWriter()));
      return result;
    } finally { await reader.close(); }
  }

  it('exports exact Markdown, attachments, empty folders, Canvas, and scoped folder paths', async () => {
    const vault = await repository.initialize();
    const folder = await repository.createFolder(vault.id, null, 'Research');
    await repository.createFolder(vault.id, folder.id, 'Empty');
    const note = await repository.createNote(vault.id, folder.id, 'Plan', '---\nstatus: Draft\n---\n# Plan\n![[plot.png]]');
    await repository.addAttachment(vault.id, folder.id, new Blob(['image bytes'], { type: 'image/png' }), 'plot.png');
    await repository.createNote(vault.id, null, 'Outside', 'Outside');
    const canvas = await new CanvasesStore(repository, vault.id).create('Map');
    const inventory = await loadExportInventory(repository, vault.id);
    const full = await createExport(repository, { format: 'markdown-zip', vaultId: vault.id }, inventory);
    const entries = await zipEntries(full.blob);
    expect(entries.get('Research/Plan.md')).toBe(note.markdown);
    expect(entries.get('Research/plot.png')).toBe('image bytes');
    expect(entries.has('Research/Empty/')).toBe(true);
    expect(entries.has('noor-note.json')).toBe(false);
    expect(JSON.parse(entries.get(canvas.path.slice(1)) ?? '{}')).toHaveProperty('nodes');
    const scoped = await createExport(repository, { format: 'folder-zip', vaultId: vault.id, folderId: folder.id }, inventory);
    const scopedEntries = await zipEntries(scoped.blob);
    expect(scopedEntries.has('Research/Plan.md')).toBe(true);
    expect(scopedEntries.has('Outside.md')).toBe(false);
    expect(scoped.report.limitations.join(' ')).toContain('Revision history');
    const single = await createExport(repository, { format: 'note-md', vaultId: vault.id, noteId: note.id }, inventory);
    expect(await single.blob.text()).toBe(note.markdown);
    expect(single.filename).toBe('Plan.md');
  });

  it('creates inert HTML with embedded wiki images and offers a browser print view for PDF', async () => {
    const vault = await repository.initialize();
    const image = await repository.addAttachment(vault.id, null, new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }), 'plot.png');
    const note = await repository.createNote(vault.id, null, 'Page', '# Page\n![[plot.png|Diagram]]\n<script>alert(1)</script>');
    const inventory = await loadExportInventory(repository, vault.id);
    const html = await createExport(repository, { format: 'note-html', vaultId: vault.id, noteId: note.id }, inventory);
    const document = await html.blob.text();
    expect(document).toContain('data:image/png;base64,');
    expect(document).toContain('Original Markdown source');
    expect(document).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(document).not.toContain('<script>alert(1)</script>');
    expect(html.report.limitations.join(' ')).toContain('Mermaid');
    const pdf = await createExport(repository, { format: 'note-pdf', vaultId: vault.id, noteId: note.id }, inventory);
    expect(pdf.delivery).toBe('print');
    expect(await pdf.blob.text()).toContain('choose Save as PDF');
    expect(pdf.report.limitations.join(' ')).toContain('browser print dialog');
    expect(image.id).toBeTruthy();
  });

  it('exports a self-contained JSON archive with revisions and attachment bytes', async () => {
    const vault = await repository.initialize();
    const note = await repository.createNote(vault.id, null, 'History', 'First');
    await repository.saveNote(note.id, { markdown: 'Second' }, true);
    await repository.addAttachment(vault.id, null, new Blob(['binary']), 'file.bin');
    const artifact = await createExport(repository, { format: 'json-archive', vaultId: vault.id });
    const archive = JSON.parse(await artifact.blob.text());
    expect(archive).toMatchObject({ format: 'noor-note-json-archive', version: 1 });
    expect(archive.notes[0].markdown).toBe('Second');
    expect(archive.attachments[0].contentBase64).toBe(btoa('binary'));
    expect(archive.revisions.length).toBeGreaterThan(0);
    expect(artifact.report.limitations.join(' ')).toContain('not currently a Noor Note import format');
  });

  it('fails visibly when a required attachment has no local bytes', async () => {
    const vault = await repository.initialize();
    const attachment = await repository.addAttachment(vault.id, null, new Blob(['data']), 'lost.bin');
    blobs.delete(attachment.id);
    await expect(createExport(repository, { format: 'markdown-zip', vaultId: vault.id })).rejects.toThrow('Attachment bytes are missing');
    await expect(createExport(repository, { format: 'json-archive', vaultId: vault.id })).rejects.toThrow('Attachment bytes are missing');
  });

  it('exports the active Base view to CSV and escapes spreadsheet formula cells', async () => {
    const vault = await repository.initialize();
    await repository.createNote(vault.id, null, 'Keep', '---\nstatus: Doing\nprice: 4\nquantity: 2\npayload: "=1+1"\n---\n# Keep');
    await repository.createNote(vault.id, null, 'Exclude', '---\nstatus: Done\n---\n# Exclude');
    const store = new BasesStore(repository, vault.id);
    const base = await store.create('Projects');
    const definition = readBaseDefinition(base);
    const formula = { id: crypto.randomUUID(), name: 'Total', expression: 'price * quantity' };
    const updated = await store.save(base, {
      ...definition,
      query: { ...definition.query, property: { field: 'property:status', operator: 'equals', value: 'Doing' } },
      formulas: [formula],
      views: definition.views.map((view) => ({ ...view, visibleFields: ['title', 'property:status', `formula:${formula.id}`, 'property:payload'], columnOrder: ['title', 'property:status', `formula:${formula.id}`, 'property:payload'] })),
    });
    const artifact = await createExport(repository, { format: 'base-csv', vaultId: vault.id, baseId: updated.id });
    const csv = await artifact.blob.text();
    expect(csv).toContain('id,path,title,property:status');
    expect(csv).toContain('/Keep.md,Keep,Doing,8,\'=1+1');
    expect(csv).not.toContain('Exclude');
    expect(artifact.report.itemCount).toBe(1);
  });

  it('exports Canvas JSON and reports path-only references', async () => {
    const vault = await repository.initialize();
    const store = new CanvasesStore(repository, vault.id);
    const canvas = await store.create('Ideas');
    await store.save(canvas, appendCanvasNode(readCanvasDocument(canvas), createCanvasNode('text', 10, 10, { text: 'Hello' })));
    const inventory = await loadExportInventory(repository, vault.id);
    const selection = { format: 'canvas-json' as ExportFormat, vaultId: vault.id, canvasId: canvas.id };
    expect(portabilityReport(selection, inventory).limitations.join(' ')).toContain('not bundled');
    const result = await createExport(repository, selection, inventory);
    expect(result.filename).toBe('Ideas.canvas');
    expect(JSON.parse(await result.blob.text()).nodes[0].text).toBe('Hello');
  });
});
