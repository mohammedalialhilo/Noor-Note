// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';
import { createNote } from '@noor-note/core';
import { DexieVaultRepository, type AttachmentBytesStore } from '@noor-note/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commitImport, inspectImportFiles, planImport } from '../src/lib/import-center';
import { exportVaultZip } from '../src/lib/vault-archive';

const fixture = (name: string) => readFileSync(join(process.cwd(), 'test/fixtures/import-center', name), 'utf8');
function file(name: string, text: string, relative?: string): File {
  const value = new File([text], name, { type: 'text/plain' });
  Object.defineProperty(value, 'text', { value: async () => text });
  if (relative) Object.defineProperty(value, 'noorRelativePath', { value: relative });
  return value;
}
async function zip(entries: { name: string; text: string }[]): Promise<File> {
  const writer = new ZipWriter(new BlobWriter('application/zip'));
  for (const entry of entries) await writer.add(entry.name, new TextReader(entry.text));
  const archive = await writer.close();
  const value = new File([archive], 'export.zip', { type: 'application/zip' });
  Object.defineProperty(value, 'arrayBuffer', { value: () => archive.arrayBuffer() });
  return value;
}

describe('Import Center adapters and plans', () => {
  let repository: DexieVaultRepository;
  let databaseName: string;
  const blobs = new Map<string, Blob>();
  const bytes: AttachmentBytesStore = { async write(id, blob) { blobs.set(id, blob); return 'indexeddb'; }, async read(item) { return blobs.get(item.id); }, async remove(item) { blobs.delete(item.id); } };
  beforeEach(() => { databaseName = `noor-import-${crypto.randomUUID()}`; repository = new DexieVaultRepository(databaseName, bytes); blobs.clear(); });
  afterEach(async () => { repository.close(); await Dexie.delete(databaseName); });

  it('previews and imports portable Markdown, HTML, CSV, Keep JSON, and Evernote ENEX fixtures', async () => {
    const vault = await repository.initialize();
    const batch = await inspectImportFiles([
      file('plain.md', fixture('plain.md')),
      file('page.html', fixture('page.html')),
      file('table.csv', fixture('table.csv')),
      file('keep.json', fixture('keep.json')),
      file('evernote.enex', fixture('evernote.enex')),
    ]);
    expect(batch.notes).toHaveLength(5);
    expect(batch.notes.find((note) => note.path === 'page.md')?.markdown).toContain('**bold**');
    expect(batch.notes.find((note) => note.path === 'page.md')?.markdown).not.toContain('alert(');
    expect(batch.notes.find((note) => note.path === 'table.md')?.markdown).toContain('Alpha, Beta');
    expect(batch.notes.find((note) => note.path === 'keep.md')?.markdown).toContain('- [x] Make notes');
    expect(batch.notes.find((note) => note.path === 'Field log.md')?.markdown).toContain('**Observation**');
    const plan = await planImport(batch, repository, await repository.listTree(vault.id), null, 'rename');
    expect(plan.conflicts).toBe(0);
    expect(await commitImport(batch, repository, vault.id, null, 'rename', plan)).toEqual({ imported: 5, vaultId: vault.id });
    expect((await repository.listTree(vault.id)).notes).toHaveLength(5);
  });

  it('imports Obsidian-style and Notion Markdown ZIPs, plus Joplin, Logseq, Roam, and Apple HTML fixtures', async () => {
    const vault = await repository.initialize();
    const archive = await zip([
      { name: 'Vault/Ideas.md', text: fixture('plain.md') },
      { name: 'Vault/assets/plot.png', text: 'image bytes' },
      { name: '.obsidian/app.json', text: '{}' },
      { name: 'Notion/Project page.md', text: fixture('notion-page.md') },
      { name: 'Notion/Database.csv', text: fixture('table.csv') },
      { name: 'Notion/index.html', text: '<html>index</html>' },
    ]);
    const batch = await inspectImportFiles([archive]);
    expect(batch.notes).toHaveLength(3);
    expect(batch.attachments).toHaveLength(1);
    expect(batch.attachments[0]?.blob).toBeUndefined();
    expect(batch.attachments[0]?.archivePath).toBe('Vault/assets/plot.png');
    expect(batch.unsupported.join(' ')).toContain('.obsidian');
    const folder = await repository.createFolder(vault.id, null, 'Imported');
    const plan = await planImport(batch, repository, await repository.listTree(vault.id), folder.id, 'rename');
    await commitImport(batch, repository, vault.id, folder.id, 'rename', plan);
    const tree = await repository.listTree(vault.id);
    expect(tree.notes.map((note) => note.path)).toContain('/Imported/Vault/Ideas.md');
    expect(tree.attachments.map((item) => item.path)).toContain('/Imported/Vault/assets/plot.png');
    const importedAttachment = tree.attachments.find((item) => item.path === '/Imported/Vault/assets/plot.png');
    expect(importedAttachment && (await repository.getAttachmentBlob(importedAttachment.id))?.size).toBe(11);
    const more = await inspectImportFiles([
      file('joplin.md', fixture('joplin.md')),
      file('logseq.md', fixture('logseq.md')),
      file('roam.md', fixture('roam.md')),
      file('apple.html', fixture('apple.html')),
    ]);
    expect(more.notes).toHaveLength(4);
    expect(more.notes.find((note) => note.path === 'logseq.md')?.markdown).toContain('TODO');
    expect(more.notes.find((note) => note.path === 'roam.md')?.markdown).toContain('[[Research]]');
    expect(more.notes.find((note) => note.path === 'apple.md')?.markdown).toContain('# Apple Notes export');
  });

  it('plans rename, skip, safe merge, and explicit overwrite without silently losing source', async () => {
    const vault = await repository.initialize();
    const current = await repository.createNote(vault.id, null, 'Plan', '# Plan');
    const incoming = await inspectImportFiles([file('Plan.md', '# Plan\nNew detail')]);
    const tree = await repository.listTree(vault.id);
    const rename = await planImport(incoming, repository, tree, null, 'rename');
    expect(rename.conflicts).toBe(1);
    expect(rename.items[0]?.destinationPath).toBe('/Plan (imported 2).md');
    const skip = await planImport(incoming, repository, tree, null, 'skip');
    expect(skip.items[0]?.action).toBe('skip');
    const merge = await planImport(incoming, repository, tree, null, 'merge');
    expect(merge.items[0]?.action).toBe('merge');
    await commitImport(incoming, repository, vault.id, null, 'merge', merge);
    expect((await repository.getNote(current.id))?.markdown).toBe('# Plan\nNew detail');
    const incompatible = await inspectImportFiles([file('Plan.md', '# Different')]);
    expect((await planImport(incompatible, repository, await repository.listTree(vault.id), null, 'merge')).blocked).toHaveLength(1);
    const overwrite = await planImport(incompatible, repository, await repository.listTree(vault.id), null, 'overwrite');
    await commitImport(incompatible, repository, vault.id, null, 'overwrite', overwrite);
    expect((await repository.getNote(current.id))?.markdown).toBe('# Different');
    expect((await repository.listRevisions(current.id)).length).toBeGreaterThan(1);
    await expect(commitImport(incoming, repository, vault.id, null, 'rename', rename)).rejects.toThrow('vault changed');
  });

  it('previews a native Noor backup as a separate vault and rejects unsafe paths and unknown JSON', async () => {
    const vault = await repository.initialize();
    await repository.createNote(vault.id, null, 'Original', 'Body');
    const backup = await exportVaultZip(repository, vault.id);
    const native = new File([backup], 'backup.zip');
    Object.defineProperty(native, 'arrayBuffer', { value: () => backup.arrayBuffer() });
    const inspected = await inspectImportFiles([native]);
    expect(inspected.format).toBe('Noor Note backup');
    expect(inspected.notes).toHaveLength(1);
    const result = await commitImport(inspected, repository, vault.id, null, 'rename', { items: [], conflicts: 0, blocked: [], signature: 'native' });
    expect(result.vaultId).not.toBe(vault.id);
    await expect(inspectImportFiles([file('unknown.json', '{"other":true}')])).rejects.toThrow('Unsupported JSON schema');
    await expect(inspectImportFiles([file('bad.md', 'Text', '../bad.md')])).rejects.toThrow('Unsafe import path');
    await expect(inspectImportFiles([file('same.md', 'Markdown'), file('same.html', '<p>HTML</p>')])).rejects.toThrow('same destination path');
    const legacy = createNote('Legacy content', { title: 'Legacy' });
    expect((await inspectImportFiles([file('legacy.json', JSON.stringify({ notes: [legacy] }))])).notes[0]?.markdown).toBe('Legacy content');
  });
});
