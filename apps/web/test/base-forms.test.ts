import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newBaseFormField, readBaseDefinition } from '@noor-note/core';
import { DexieVaultRepository, type AttachmentBytesStore } from '@noor-note/storage';
import { BasesStore } from '../src/lib/bases';
import { submitBaseForm } from '../src/lib/base-forms';
import { exportVaultZip, importVaultZip } from '../src/lib/vault-archive';

describe('Base form submission', () => {
  let repository: DexieVaultRepository;
  let name: string;
  const blobs = new Map<string, Blob>();
  const bytes: AttachmentBytesStore = { async write(id, blob) { blobs.set(id, blob); return 'indexeddb'; }, async read(item) { return blobs.get(item.id); }, async remove(item) { blobs.delete(item.id); } };
  beforeEach(() => { vi.stubGlobal('window', {}); name = `noor-note-forms-${crypto.randomUUID()}`; repository = new DexieVaultRepository(name, bytes); blobs.clear(); });
  afterEach(async () => { repository.close(); await Dexie.delete(name); vi.unstubAllGlobals(); });

  it('creates a Markdown note in the selected folder, stores attachments, and remaps form references in ZIP', async () => {
    const vault = await repository.initialize();
    const target = await repository.createFolder(vault.id, null, 'Intake');
    const templates = await repository.createFolder(vault.id, null, 'Templates');
    await repository.updateVaultSettings(vault.id, { templates: { ...vault.settings.templates, folderId: templates.id } });
    const template = await repository.createNote(vault.id, templates.id, 'Form template', '---\nexisting: yes\n---\n# {{title}}');
    const store = new BasesStore(repository, vault.id);
    const base = await store.create('Requests');
    const definition = readBaseDefinition(base);
    const title = definition.form.fields[0]!;
    const fileField = newBaseFormField('fileAttachment', 'documents');
    const updated = await store.save(base, { ...definition, form: { ...definition.form, targetFolderId: target.id, noteTemplateId: template.id, defaultProperties: { status: 'New' }, fields: [title, fileField] } });
    const file = new File(['document bytes'], 'report.pdf', { type: 'application/pdf' });
    const created = await submitBaseForm(repository, vault.id, updated.id, { [title.id]: 'My request' }, { [fileField.id]: [file] });
    expect(created.path).toBe('/Intake/My request.md');
    expect(created.markdown).toContain('status: New');
    expect(created.markdown).toContain('[report.pdf](report.pdf)');
    const attachment = (await repository.listTree(vault.id)).attachments[0]!;
    expect(await (await repository.getAttachmentBlob(attachment.id))?.text()).toBe('document bytes');
    const importedId = await importVaultZip(repository, await exportVaultZip(repository, vault.id));
    const imported = (await new BasesStore(repository, importedId).list())[0]!;
    const importedTree = await repository.listTree(importedId);
    expect(readBaseDefinition(imported).form.targetFolderId).toBe(importedTree.folders.find((item) => item.path === '/Intake')?.id);
    expect(readBaseDefinition(imported).form.noteTemplateId).toBe(importedTree.notes.find((item) => item.path === '/Templates/Form template.md')?.id);
  });

  it('rejects invalid submissions before writing a note or attachment', async () => {
    const vault = await repository.initialize();
    const base = await new BasesStore(repository, vault.id).create('Requests');
    await expect(submitBaseForm(repository, vault.id, base.id, {})).rejects.toThrow('Title is required');
    expect((await repository.listTree(vault.id)).notes).toHaveLength(0);
  });

  it('removes newly uploaded files when note creation fails', async () => {
    const vault = await repository.initialize();
    const store = new BasesStore(repository, vault.id);
    const base = await store.create('Requests');
    const definition = readBaseDefinition(base);
    const fileField = newBaseFormField('fileAttachment', 'documents');
    await store.save(base, { ...definition, form: { ...definition.form, fields: [...definition.form.fields, fileField] } });
    const create = vi.spyOn(repository, 'createNote').mockRejectedValueOnce(new Error('Storage unavailable'));
    await expect(submitBaseForm(repository, vault.id, base.id, { [definition.form.fields[0]!.id]: 'Request' }, { [fileField.id]: [new File(['bytes'], 'report.pdf')] })).rejects.toThrow('Storage unavailable');
    create.mockRestore();
    expect((await repository.listTree(vault.id)).attachments).toHaveLength(0);
    expect(blobs.size).toBe(0);
  });
});
