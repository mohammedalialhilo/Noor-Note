import { baseSchema, isTemplateNote, joinVaultPath, readBaseDefinition, renderBaseFormFilename, renderBaseFormNote, safeFileStem, validateBaseForm, type VaultNote } from '@noor-note/core';
import type { VaultRepository } from '@noor-note/storage';

export async function submitBaseForm(repository: VaultRepository, vaultId: string, baseId: string, values: Readonly<Record<string, unknown>>, files: Readonly<Record<string, readonly File[]>> = {}): Promise<VaultNote> {
  const record = (await repository.listObjects('base', vaultId)).find((item) => item.id === baseId);
  if (!record) throw new Error('This Base is no longer available.');
  const base = baseSchema.parse(record);
  if (base.deletedAt) throw new Error('This Base is in Trash.');
  const form = readBaseDefinition(base).form;
  const tree = await repository.listTree(vaultId);
  const folder = form.targetFolderId ? tree.folders.find((item) => item.id === form.targetFolderId && !item.deletedAt) : null;
  if (form.targetFolderId && !folder) throw new Error('The form destination folder is unavailable.');
  const folderPath = folder?.path ?? '/';
  const templateEntry = form.noteTemplateId ? tree.notes.find((item) => item.id === form.noteTemplateId && !item.deletedAt) : null;
  if (form.noteTemplateId && (!templateEntry || !isTemplateNote(templateEntry, tree.folders, tree.vault.settings.templates.folderId))) throw new Error('The form note template is unavailable.');
  const template = templateEntry ? await repository.getNote(templateEntry.id) : null;
  if (templateEntry && !template) throw new Error('The form note template is unavailable.');
  const input = { ...values };
  const fileFields = form.fields.filter((field) => field.kind === 'fileAttachment');
  for (const field of fileFields) {
    const selected = files[field.id] ?? [];
    if (selected.some((file) => !(file instanceof Blob) || !file.name || file.size > 100 * 1024 * 1024)) throw new Error(`${field.label} contains an invalid file or a file over 100 MiB.`);
    input[field.id] = selected.map((file) => file.name);
  }
  if (Object.keys(files).some((id) => !fileFields.some((field) => field.id === id))) throw new Error('The form has an unexpected attachment field.');
  const validated = validateBaseForm(form, input, tree.notes.filter((note) => !note.deletedAt));
  const now = new Date();
  const title = renderBaseFormFilename(form, validated, folderPath, now);
  const occupied = new Set([...tree.notes, ...tree.attachments].filter((item) => !item.deletedAt).map((item) => item.path.toLocaleLowerCase()));
  const created: { id: string; fieldId: string; name: string; path: string }[] = [];
  try {
    for (const field of fileFields) for (const file of files[field.id] ?? []) {
      const original = safeFileStem(file.name);
      const dot = original.lastIndexOf('.');
      const stem = dot > 0 ? original.slice(0, dot) : original;
      const extension = dot > 0 ? original.slice(dot) : '';
      let name = original, suffix = 2;
      while (occupied.has(joinVaultPath(folderPath, name).toLocaleLowerCase())) name = `${stem} (${suffix++})${extension}`;
      const attachment = await repository.addAttachment(vaultId, form.targetFolderId, file, name);
      occupied.add(attachment.path.toLocaleLowerCase());
      created.push({ id: attachment.id, fieldId: field.id, name: attachment.name, path: attachment.path });
    }
    return await repository.createNote(vaultId, form.targetFolderId, title, (path) => renderBaseFormNote(form, validated, template?.markdown ?? '# {{title}}\n', folderPath, path, created, now).markdown);
  } catch (error) {
    const failures = await Promise.allSettled(created.map(async (item) => { await repository.deleteAttachment(item.id); await repository.permanentlyDeleteAttachment(item.id); }));
    if (failures.some((result) => result.status === 'rejected')) throw new Error('Form submission failed. Some new attachments could not be removed; check the destination folder.', { cause: error });
    throw error;
  }
}
