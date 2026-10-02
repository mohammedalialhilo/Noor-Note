interface PickerWindow extends Window {
  showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite'; id?: string }) => Promise<FileSystemDirectoryHandle>;
}

export function canOpenDirectory(): boolean {
  return typeof window !== 'undefined' && typeof (window as PickerWindow).showDirectoryPicker === 'function';
}

function validateSegment(name: string): void {
  if (!name || name === '.' || name === '..' || /[/\\\u0000-\u001f\u007f]/u.test(name)) throw new Error('The selected folder has an unsafe file name.');
}

/** Collect File handles without reading bytes. The Import Center does the preview and validation. */
export async function filesFromDirectory(root: FileSystemDirectoryHandle, limit = 5_000): Promise<File[]> {
  const files: File[] = [];
  const walk = async (directory: FileSystemDirectoryHandle, prefix: string, depth: number): Promise<void> => {
    if (depth > 24) throw new Error('The selected folder is nested too deeply.');
    if (typeof directory.values !== 'function') throw new Error('This browser cannot read the selected folder. Use Import Markdown vault instead.');
    for await (const handle of directory.values()) {
      validateSegment(handle.name);
      const path = prefix ? `${prefix}/${handle.name}` : handle.name;
      if (handle.kind === 'directory') await walk(handle as FileSystemDirectoryHandle, path, depth + 1);
      else {
        if (files.length >= limit) throw new Error(`The selected folder has more than ${limit} files. Import a smaller folder or ZIP.`);
        const file = await (handle as FileSystemFileHandle).getFile();
        Object.defineProperty(file, 'noorRelativePath', { value: path });
        files.push(file);
      }
    }
  };
  await walk(root, '', 0);
  if (!files.length) throw new Error('The selected folder has no files to import.');
  return files;
}

export async function pickDirectoryFiles(): Promise<File[] | null> {
  const picker = (window as PickerWindow).showDirectoryPicker;
  if (!picker) throw new Error('Folder access is unavailable in this browser. Use Import Markdown vault instead.');
  let root: FileSystemDirectoryHandle;
  try { root = await picker({ mode: 'read', id: 'noor-note-vault-import' }); }
  catch (error) { if (error instanceof DOMException && error.name === 'AbortError') return null; throw error; }
  return filesFromDirectory(root);
}
