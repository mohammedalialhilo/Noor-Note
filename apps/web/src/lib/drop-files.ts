export type RelativeFile = File & { noorRelativePath?: string };

interface LegacyEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  file?: (success: (file: File) => void, failure: (error: DOMException) => void) => void;
  createReader?: () => { readEntries: (success: (entries: LegacyEntry[]) => void, failure: (error: DOMException) => void) => void };
}

function fileFromEntry(entry: LegacyEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    if (!entry.file) { reject(new Error('Dropped file is unavailable')); return; }
    entry.file(resolve, reject);
  });
}

async function entriesFromDirectory(entry: LegacyEntry): Promise<LegacyEntry[]> {
  if (!entry.createReader) return [];
  const reader = entry.createReader();
  const all: LegacyEntry[] = [];
  while (true) {
    const batch = await new Promise<LegacyEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) return all;
    all.push(...batch);
    if (all.length > 5_000) throw new Error('Dropped folder contains too many files');
  }
}

async function walk(entry: LegacyEntry, prefix: string, output: RelativeFile[]): Promise<void> {
  const path = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (entry.isFile) {
    const file = await fileFromEntry(entry) as RelativeFile;
    Object.defineProperty(file, 'noorRelativePath', { value: path, configurable: true });
    output.push(file);
  } else if (entry.isDirectory) {
    for (const child of await entriesFromDirectory(entry)) await walk(child, path, output);
  }
  if (output.length > 5_000) throw new Error('Dropped folder contains too many files');
}

export async function collectDroppedFiles(dataTransfer: DataTransfer): Promise<RelativeFile[]> {
  const entries: LegacyEntry[] = [];
  for (const item of Array.from(dataTransfer.items)) {
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry as unknown as LegacyEntry);
  }
  if (!entries.length) return Array.from(dataTransfer.files);
  const output: RelativeFile[] = [];
  for (const entry of entries) await walk(entry, '', output);
  return output;
}
