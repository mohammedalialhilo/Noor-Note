// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';
import { readCanvasDocument, type Canvas } from '@noor-note/core';
import { DexieVaultRepository, type AttachmentBytesStore } from '@noor-note/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commitImport, createImportReport, inspectImportFiles, planImport } from '../src/lib/import-center';

async function archive(entries: { name: string; text?: string }[]): Promise<File> {
  const writer = new ZipWriter(new BlobWriter('application/zip'));
  for (const entry of entries) await writer.add(entry.name, entry.text === undefined ? undefined : new TextReader(entry.text), entry.text === undefined ? { directory: true } : undefined);
  const blob = await writer.close();
  const file = new File([blob], 'obsidian-vault.zip', { type: 'application/zip' });
  Object.defineProperty(file, 'arrayBuffer', { value: () => blob.arrayBuffer() });
  return file;
}

describe('Obsidian-style vault import', () => {
  let repository: DexieVaultRepository;
  let databaseName: string;
  const blobs = new Map<string, Blob>();
  const bytes: AttachmentBytesStore = { async write(id, blob) { blobs.set(id, blob); return 'indexeddb'; }, async read(item) { return blobs.get(item.id); }, async remove(item) { blobs.delete(item.id); } };
  beforeEach(() => { databaseName = `obsidian-import-${crypto.randomUUID()}`; repository = new DexieVaultRepository(databaseName, bytes); blobs.clear(); });
  afterEach(async () => { repository.close(); await Dexie.delete(databaseName); });

  it('preserves Markdown, properties, tags, attachments, and compatible Canvas while reporting broken references', async () => {
    const vault = await repository.initialize();
    const alpha = `---\naliases:\n  - Start\ntags:\n  - research\nstatus: active\n---\n# Alpha\n\n#project/topic\n\n[[Beta]] [[Beta|Second]] [[Start]] [[Beta#Section]] [[Beta^block-1]] [beta](Beta.md)\n![[../assets/chart.png]]\n![Chart](../assets/chart.png)\n[[Missing]] [[Beta#Absent]]\n\n\`\`\`dataview\nTABLE status\n\`\`\`\n`;
    const canvas = JSON.stringify({ nodes: [
      { id: 'note', type: 'file', file: 'Research/Alpha.md', subpath: '#Alpha', x: 0, y: 0, width: 250, height: 160 },
      { id: 'image', type: 'file', file: 'assets/chart.png', x: 300, y: 0, width: 250, height: 160 },
      { id: 'text', type: 'text', text: 'Map', x: 0, y: 200, width: 250, height: 160 },
    ], edges: [] });
    const batch = await inspectImportFiles([await archive([
      { name: 'Vault/Research/Alpha.md', text: alpha },
      { name: 'Vault/Research/Beta.md', text: '# Beta\n\n## Section\n\nBlock text ^block-1' },
      { name: 'Vault/assets/chart.png', text: 'image bytes' },
      { name: 'Vault/Map.canvas', text: canvas },
      { name: 'Vault/Empty/' },
      { name: '.obsidian/app.json', text: '{}' },
    ])]);
    expect(batch.notes).toHaveLength(2);
    expect(batch.attachments).toHaveLength(1);
    expect(batch.canvases).toHaveLength(1);
    expect(batch.folders).toContain('Vault/Empty');
    const destination = await repository.createFolder(vault.id, null, 'Imported');
    const plan = await planImport(batch, repository, await repository.listTree(vault.id), destination.id, 'rename');
    const report = createImportReport(batch, plan);
    expect(report.successes).toHaveLength(5);
    expect(report.unsupportedSyntax).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Vault/Research/Alpha.md', reason: expect.stringContaining('dataview') })]));
    expect(report.unsupportedSyntax).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Vault/Map.canvas', reason: expect.stringContaining('subpath') })]));
    expect(report.brokenReferences.map((item) => item.reason)).toEqual(expect.arrayContaining(['Target missing from selected vault', 'Heading missing: Absent']));
    expect(report.brokenReferences).toHaveLength(2);
    expect(report.warnings.join(' ')).toContain('.obsidian');
    expect(await commitImport(batch, repository, vault.id, destination.id, 'rename', plan)).toEqual({ imported: 5, vaultId: vault.id });
    const tree = await repository.listTree(vault.id);
    expect(tree.folders.map((item) => item.path)).toContain('/Imported/Vault/Empty');
    const imported = tree.notes.find((item) => item.path === '/Imported/Vault/Research/Alpha.md');
    expect(imported && (await repository.getNote(imported.id))?.markdown).toBe(alpha);
    expect(imported?.aliases).toContain('Start');
    expect(imported?.properties.status).toBe('active');
    expect(imported?.tags).toContain('project/topic');
    const stored = (await repository.listObjects('canvas', vault.id))[0] as Canvas;
    expect(stored.path).toBe('/Imported/Vault/Map.canvas');
    const nodes = readCanvasDocument(stored).nodes;
    expect(nodes.find((node) => node.filePath === '/Imported/Vault/Research/Alpha.md')?.noteId).toBe(imported?.id);
    expect(nodes.find((node) => node.filePath === '/Imported/Vault/assets/chart.png')?.attachmentId).toBe(tree.attachments[0]?.id);
  });

  it('keeps an incompatible Canvas as an attachment and reports why', async () => {
    const batch = await inspectImportFiles([await archive([{ name: 'Vault/Broken.canvas', text: '{"nodes":[{"type":"unknown"}]}' }])]);
    expect(batch.canvases).toHaveLength(0);
    expect(batch.attachments).toHaveLength(1);
    expect(createImportReport(batch, null).warnings.join(' ')).toContain('Incompatible JSON Canvas');
  });
});
