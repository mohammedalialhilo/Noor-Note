import { safeFileStem } from '@noor-note/core';
import type { VaultRepository } from '@noor-note/storage';

interface PickerWindow extends Window {
  showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite'; id?: string }) => Promise<FileSystemDirectoryHandle>;
}

export function canConnectDirectory(): boolean {
  return typeof window !== 'undefined' && typeof (window as PickerWindow).showDirectoryPicker === 'function';
}

export async function pickDirectory(): Promise<FileSystemDirectoryHandle> {
  const picker = (window as PickerWindow).showDirectoryPicker;
  if (!picker) throw new Error('This browser does not support connected folders. Use ZIP export instead.');
  return picker({ mode: 'readwrite', id: 'noor-note-vault-export' });
}

async function childDirectory(root: FileSystemDirectoryHandle, parts: string[]): Promise<FileSystemDirectoryHandle> {
  let current = root;
  for (const part of parts) current = await current.getDirectoryHandle(part, { create: true });
  return current;
}

export async function writeVaultToDirectory(repository: VaultRepository, vaultId: string, selected: FileSystemDirectoryHandle): Promise<number> {
  const tree = await repository.listTree(vaultId);
  const destination = await selected.getDirectoryHandle(`${safeFileStem(tree.vault.name)}--${tree.vault.id}`, { create: true });
  for (const folder of [...tree.folders].sort((a, b) => a.path.length - b.path.length)) await childDirectory(destination, folder.path.split('/').filter(Boolean));
  let count = 0;
  for (const entry of tree.notes) {
    const note = await repository.getNote(entry.id);
    if (!note) throw new Error('A note disappeared while writing files');
    const parts = note.path.split('/').filter(Boolean);
    const parent = await childDirectory(destination, parts.slice(0, -1));
    const file = await parent.getFileHandle(parts.at(-1)!, { create: true });
    const writable = await file.createWritable();
    await writable.write(note.markdown);
    await writable.close();
    count += 1;
  }
  for (const attachment of tree.attachments) {
    const blob = await repository.getAttachmentBlob(attachment.id);
    if (!blob) throw new Error(`Attachment is missing: ${attachment.path}`);
    const parts = attachment.path.split('/').filter(Boolean);
    const parent = await childDirectory(destination, parts.slice(0, -1));
    const file = await parent.getFileHandle(parts.at(-1)!, { create: true });
    const writable = await file.createWritable();
    await blob.stream().pipeTo(writable);
    count += 1;
  }
  return count;
}
