import { canvasSchema, importJsonCanvas, joinVaultPath, parseCsvTable, parseImportedNotes, parsePortableMarkdown, pathKey, resolveVaultReference, serializeMarkdownTable, vaultArchiveManifestSchema, type Attachment, type Canvas } from '@noor-note/core';
import type { NoteEntry, VaultRepository, VaultTree } from '@noor-note/storage';
import { z } from 'zod';
import { importVaultZip } from './vault-archive';
import { readBoundedZipBlob, readBoundedZipText } from './zip-safety';
import { analyzeMarkdownVault, validateJsonCanvas, type VaultImportCanvas, type VaultImportReport } from './obsidian-vault';

export interface ImportNote { path: string; title: string; markdown: string }
export interface ImportAttachment { path: string; blob?: Blob; archivePath?: string }
export interface ImportBatch {
  format: string;
  folders: string[];
  notes: ImportNote[];
  attachments: ImportAttachment[];
  canvases: VaultImportCanvas[];
  unsupported: string[];
  archive?: Blob;
  nativeArchive?: Blob;
}
export type ConflictStrategy = 'skip' | 'rename' | 'merge' | 'overwrite';
export interface PlannedImportItem { kind: 'folder' | 'note' | 'attachment' | 'canvas'; sourcePath: string; destinationPath: string; action: 'create' | 'skip' | 'merge' | 'overwrite'; existingId?: string; existingRevision?: number; markdown?: string }
export interface ImportPlan { items: PlannedImportItem[]; conflicts: number; blocked: string[]; signature: string }

const keepSchema = z.object({ title: z.string().optional(), textContent: z.string().optional(), listContent: z.array(z.object({ text: z.string(), isChecked: z.boolean().optional() })).optional(), labels: z.array(z.object({ name: z.string() })).optional() }).passthrough();
const MAX_FILES = 5_000;
const MAX_TEXT_BYTES = 8 * 1024 * 1024;
const MAX_ASSET_BYTES = 64 * 1024 * 1024;
const MAX_ZIP_BYTES = 512 * 1024 * 1024;

function relativePath(input: string): string {
  const path = input.replaceAll('\\', '/').replace(/^\/+|\/+$/gu, '');
  const parts = path.split('/');
  if (!path || parts.some((part) => !part || part === '.' || part === '..' || /[\u0000-\u001f\u007f]/u.test(part))) throw new Error(`Unsafe import path: ${input}`);
  for (const part of parts) joinVaultPath('/', part);
  return path;
}

function titleFromPath(path: string): string { return path.split('/').at(-1)!.replace(/\.[^.]+$/u, ''); }
function cleanText(value: string): string { return value.replace(/\s+/gu, ' ').trim(); }

function htmlToMarkdown(source: string, unsupported: string[]): string {
  const document = new DOMParser().parseFromString(source, 'text/html');
  document.querySelectorAll('script,style,template,iframe,object,embed,form,nav,footer').forEach((node) => node.remove());
  if (document.querySelector('table')) unsupported.push('HTML tables were flattened to text.');
  const convert = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    if (!(node instanceof Element)) return '';
    const tag = node.tagName.toLowerCase();
    const inner = Array.from(node.childNodes, convert).join('');
    if (/^h[1-6]$/u.test(tag)) return `\n\n${'#'.repeat(Number(tag[1]))} ${cleanText(inner)}\n\n`;
    if (tag === 'br') return '\n';
    if (tag === 'p' || tag === 'div' || tag === 'section' || tag === 'article') return `\n\n${inner.trim()}\n\n`;
    if (tag === 'strong' || tag === 'b') return `**${inner}**`;
    if (tag === 'em' || tag === 'i') return `*${inner}*`;
    if (tag === 'del' || tag === 's') return `~~${inner}~~`;
    if (tag === 'code') return node.parentElement?.tagName.toLowerCase() === 'pre' ? inner : `\`${inner}\``;
    if (tag === 'pre') return `\n\n\`\`\`\n${node.textContent ?? ''}\n\`\`\`\n\n`;
    if (tag === 'blockquote') return `\n\n${inner.trim().split('\n').map((line) => `> ${line}`).join('\n')}\n\n`;
    if (tag === 'li') return `\n- ${inner.trim()}`;
    if (tag === 'ul' || tag === 'ol') return `\n${inner}\n`;
    if (tag === 'a') {
      const href = node.getAttribute('href') ?? '';
      return /^(https?:\/\/|\.?\.?\/|#)/iu.test(href) ? `[${cleanText(inner)}](${href.replaceAll(')', '%29')})` : inner;
    }
    if (tag === 'img') {
      const src = node.getAttribute('src') ?? '';
      if (/^(?![a-z][a-z\d+.-]*:|\/\/)[^?#]+$/iu.test(src)) return `![${node.getAttribute('alt') ?? ''}](${src})`;
      unsupported.push('Remote or embedded HTML images were not imported.');
      return node.getAttribute('alt') ?? '';
    }
    return inner;
  };
  return convert(document.body).replace(/\n{3,}/gu, '\n\n').trim();
}

function parseKeep(path: string, input: unknown): ImportNote | null {
  const parsed = keepSchema.safeParse(input);
  if (!parsed.success || !('textContent' in parsed.data || 'listContent' in parsed.data)) return null;
  const data = parsed.data;
  const title = data.title?.trim() || titleFromPath(path);
  const tasks = data.listContent?.map((item) => `- [${item.isChecked ? 'x' : ' '}] ${item.text}`) ?? [];
  const labels = data.labels?.map((item) => item.name).filter(Boolean) ?? [];
  const markdown = [`# ${title}`, data.textContent ?? '', ...tasks, labels.length ? `\nLabels: ${labels.join(', ')}` : ''].filter(Boolean).join('\n\n');
  return { path: path.replace(/\.json$/iu, '.md'), title, markdown };
}

function parseEnex(path: string, source: string, unsupported: string[]): ImportNote[] {
  const document = new DOMParser().parseFromString(source, 'application/xml');
  if (document.querySelector('parsererror') || document.documentElement.tagName !== 'en-export') throw new Error('Invalid Evernote ENEX file');
  const notes = Array.from(document.getElementsByTagName('note'));
  if (!notes.length) throw new Error('Evernote export contains no notes');
  const names = new Set<string>();
  return notes.map((node, index) => {
    const title = node.getElementsByTagName('title')[0]?.textContent?.trim() || `Evernote note ${index + 1}`;
    const sourceName = title.replace(/[\\/:*?"<>|]/gu, '-').slice(0, 150) || `Note ${index + 1}`;
    let name = sourceName;
    let suffix = 2;
    while (names.has(name.toLocaleLowerCase())) name = `${sourceName} (${suffix++})`;
    names.add(name.toLocaleLowerCase());
    const enml = node.getElementsByTagName('content')[0]?.textContent ?? '';
    const resources = node.getElementsByTagName('resource').length;
    if (resources) unsupported.push(`${resources} embedded Evernote resource${resources === 1 ? '' : 's'} in ${title} were not imported.`);
    const tags = Array.from(node.getElementsByTagName('tag'), (tag) => tag.textContent?.trim()).filter(Boolean);
    const markdown = [htmlToMarkdown(enml, unsupported), tags.length ? `Tags: ${tags.join(', ')}` : ''].filter(Boolean).join('\n\n');
    return { path: `${path.replace(/[^/]+$/u, '')}${name}.md`, title, markdown };
  });
}

export interface ImportAdapter { id: string; label: string; accepts: (path: string) => boolean; parse: (path: string, text: string, unsupported: string[]) => ImportNote[] }
export const importAdapters: ImportAdapter[] = [
  { id: 'markdown', label: 'Markdown', accepts: (path) => /\.(?:md|markdown)$/iu.test(path), parse: (path, text) => [{ path: path.replace(/\.markdown$/iu, '.md'), title: parsePortableMarkdown(text, titleFromPath(path)).title, markdown: text }] },
  { id: 'html', label: 'HTML', accepts: (path) => /\.html?$/iu.test(path), parse: (path, text, unsupported) => [{ path: path.replace(/\.html?$/iu, '.md'), title: titleFromPath(path), markdown: htmlToMarkdown(text, unsupported) }] },
  { id: 'csv', label: 'CSV', accepts: (path) => /\.csv$/iu.test(path), parse: (path, text) => [{ path: path.replace(/\.csv$/iu, '.md'), title: titleFromPath(path), markdown: `# ${titleFromPath(path)}\n\n${serializeMarkdownTable(parseCsvTable(text))}` }] },
  { id: 'enex', label: 'Evernote ENEX', accepts: (path) => /\.enex$/iu.test(path), parse: parseEnex },
  { id: 'json', label: 'JSON', accepts: (path) => /\.json$/iu.test(path), parse: (path, text, unsupported) => {
    const data: unknown = JSON.parse(text);
    const keep = parseKeep(path, data);
    if (keep) { if (keepSchema.parse(data).attachments) unsupported.push('Google Keep attachment references require separate file import.'); return [keep]; }
    try { return parseImportedNotes(data).map((note, index) => ({ path: `${path.replace(/[^/]+$/u, '')}${note.title || `Note ${index + 1}`}.md`, title: note.title, markdown: note.content })); }
    catch { throw new Error('Unsupported JSON schema. Select a Google Keep note or Noor Note legacy JSON backup.'); }
  } },
];

async function parseEntries(entries: { path: string; size: number; text?: () => Promise<string>; blob?: Blob; archivePath?: string }[], format: string, directoryEntries: string[] = []): Promise<ImportBatch> {
  if (entries.length > MAX_FILES) throw new Error('Import contains too many files');
  const notes: ImportNote[] = [], attachments: ImportAttachment[] = [], canvases: VaultImportCanvas[] = [], unsupported: string[] = [];
  const paths = new Set<string>();
  for (const entry of entries) {
    const path = relativePath(entry.path);
    const key = pathKey(`/${path}`);
    if (paths.has(key)) throw new Error(`Import contains duplicate paths: ${path}`);
    paths.add(key);
    if (/(^|\/)\.obsidian\/|(^|\/)\.git\/|(^|\/)\.DS_Store$/iu.test(path) || format.endsWith('ZIP') && /(^|\/)index\.html$/iu.test(path)) { unsupported.push(`Skipped application metadata: ${path}`); continue; }
    if (/\.(?:jex|note|one|onepkg|opml)$/iu.test(path)) { unsupported.push(`Unsupported export format: ${path}`); continue; }
    const adapter = importAdapters.find((item) => item.accepts(path));
    if (/\.canvas$/iu.test(path)) {
      if (entry.size > MAX_TEXT_BYTES) { unsupported.push(`Canvas exceeds 8 MiB and was skipped: ${path}`); continue; }
      if (!entry.text) throw new Error(`Cannot read Canvas: ${path}`);
      try { canvases.push(validateJsonCanvas(path, await entry.text())); }
      catch (cause) { unsupported.push(`Incompatible JSON Canvas ${path}: ${cause instanceof Error ? cause.message : 'invalid document'}. Original file will be kept as an attachment.`); attachments.push({ path, blob: entry.blob, archivePath: entry.archivePath }); }
    } else if (adapter) {
      if (entry.size > MAX_TEXT_BYTES) throw new Error(`Text file is too large: ${path}`);
      if (!entry.text) throw new Error(`Cannot read text file: ${path}`);
      notes.push(...adapter.parse(path, await entry.text(), unsupported));
    } else {
      if (entry.size > MAX_ASSET_BYTES) { unsupported.push(`Attachment exceeds 64 MiB: ${path}`); continue; }
      if (!entry.blob && !entry.archivePath) throw new Error(`Cannot read attachment: ${path}`);
      attachments.push({ path, blob: entry.blob, archivePath: entry.archivePath });
    }
  }
  if (notes.length > MAX_FILES) throw new Error('Import contains too many notes');
  const folders = [...new Set(directoryEntries.map(relativePath).filter((path) => !/(^|\/)\.obsidian(?:\/|$)|(^|\/)\.git(?:\/|$)/iu.test(path)))];
  if (!notes.length && !attachments.length && !canvases.length && !folders.length) throw new Error(unsupported.length ? `No importable content found. ${unsupported[0]}` : 'No importable content found');
  const convertedPaths = new Set<string>();
  for (const item of [...notes, ...attachments, ...canvases]) {
    const key = pathKey(`/${relativePath(item.path)}`);
    if (convertedPaths.has(key)) throw new Error(`Imported files convert to the same destination path: ${item.path}. Rename a source file and inspect again.`);
    convertedPaths.add(key);
  }
  return { format, folders, notes, attachments, canvases, unsupported: [...new Set(unsupported)] };
}

export async function inspectImportFiles(files: File[]): Promise<ImportBatch> {
  if (!files.length || files.length > MAX_FILES) throw new Error('Select between 1 and 5,000 files');
  const zipFiles = files.filter((file) => /\.zip$/iu.test(file.name));
  if (zipFiles.length) {
    if (files.length !== 1) throw new Error('Import one ZIP at a time');
    const file = zipFiles[0]!;
    const { BlobReader, ZipReader } = await import('@zip.js/zip.js');
    const reader = new ZipReader(new BlobReader(file));
    try {
      const allEntries = await reader.getEntries();
      const entries = allEntries.filter((entry) => !entry.directory);
      const native = entries.some((entry) => entry.filename === 'noor-note.json');
      if (allEntries.length > (native ? 10_000 : MAX_FILES)) throw new Error('ZIP contains too many entries');
      if (entries.length > (native ? 10_000 : MAX_FILES)) throw new Error('ZIP contains too many files');
      let total = 0;
      for (const entry of entries) { relativePath(entry.filename); if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0) throw new Error('ZIP entry size is invalid'); total += entry.uncompressedSize; if (total > (native ? 4 * 1024 * 1024 * 1024 : MAX_ZIP_BYTES)) throw new Error('ZIP contents exceed the import size limit'); }
      const manifest = entries.find((entry) => entry.filename === 'noor-note.json');
      if (manifest?.getData) {
        if (manifest.uncompressedSize > MAX_TEXT_BYTES) throw new Error('Noor Note manifest is too large');
        const data: unknown = JSON.parse(await readBoundedZipText(manifest, MAX_TEXT_BYTES));
        const parsed = vaultArchiveManifestSchema.parse(data);
        return { format: 'Noor Note backup', folders: parsed.folders.map((item) => item.path.slice(1)), notes: parsed.notes.map((note) => ({ path: note.path.slice(1), title: note.title, markdown: '' })), attachments: parsed.attachments.map((item) => ({ path: item.path.slice(1), blob: new Blob() })), canvases: parsed.canvases?.map((item) => ({ path: item.path.slice(1), document: item.document })) ?? [], unsupported: [], nativeArchive: file };
      }
      const batch = await parseEntries(entries.map((entry) => ({ path: entry.filename, size: entry.uncompressedSize, text: () => readBoundedZipText(entry, MAX_TEXT_BYTES), archivePath: entry.filename })), 'Markdown/CSV ZIP', allEntries.filter((entry) => entry.directory).map((entry) => entry.filename));
      return { ...batch, archive: file };
    } finally { await reader.close(); }
  }
  const entries = files.map((file) => ({ path: (file as File & { noorRelativePath?: string }).noorRelativePath || file.webkitRelativePath || file.name, size: file.size, text: () => file.text(), blob: file as Blob }));
  return parseEntries(entries, files.length === 1 ? importAdapters.find((item) => item.accepts(files[0]!.name))?.label ?? 'Files' : 'Files and folders');
}

function safeMerge(existing: string, incoming: string): string | null {
  if (existing === incoming || existing.startsWith(`${incoming}\n`)) return existing;
  if (incoming.startsWith(`${existing}\n`)) return incoming;
  return null;
}

function renamed(path: string, reserved: Set<string>): string {
  const stem = path.replace(/(\.[^./]+)?$/u, '');
  const extension = path.slice(stem.length);
  for (let number = 2; number < 10_000; number++) {
    const candidate = `${stem} (imported ${number})${extension}`;
    if (!reserved.has(pathKey(candidate))) return candidate;
  }
  throw new Error(`Could not find an available filename for ${path}`);
}

export async function planImport(batch: ImportBatch, repository: VaultRepository, tree: VaultTree, targetFolderId: string | null, strategy: ConflictStrategy): Promise<ImportPlan> {
  if (batch.nativeArchive) return { items: [], conflicts: 0, blocked: [], signature: 'native' };
  const folder = targetFolderId ? tree.folders.find((item) => item.id === targetFolderId) : null;
  if (targetFolderId && !folder) throw new Error('Destination folder is unavailable');
  const root = folder?.path ?? '/';
  const existing = new Map<string, { kind: 'note'; item: NoteEntry } | { kind: 'attachment'; item: Attachment } | { kind: 'canvas'; item: Canvas }>();
  for (const item of tree.notes) existing.set(pathKey(item.path), { kind: 'note', item });
  for (const item of tree.attachments) existing.set(pathKey(item.path), { kind: 'attachment', item });
  for (const item of await repository.listObjects('canvas', tree.vault.id)) {
    const canvas = canvasSchema.parse(item);
    if (!canvas.deletedAt) existing.set(pathKey(canvas.path), { kind: 'canvas', item: canvas });
  }
  const reserved = new Set([...existing.keys(), ...tree.folders.map((item) => pathKey(item.path))]);
  const existingFolders = new Set(tree.folders.map((item) => pathKey(item.path)));
  const plannedFiles = new Set<string>();
  const items: PlannedImportItem[] = [], blocked: string[] = [];
  let conflicts = 0;
  for (const sourcePath of batch.folders) {
    const destinationPath = relativePath(sourcePath).split('/').reduce((parent, part) => joinVaultPath(parent, part), root);
    const key = pathKey(destinationPath);
    if (existing.has(key) || plannedFiles.has(key)) blocked.push(`Cannot create folder ${destinationPath}: a file occupies that path.`);
    const parents = destinationPath.split('/').filter(Boolean).slice(0, -1);
    let parent = '';
    for (const part of parents) { parent += `/${part}`; if (existing.has(pathKey(parent))) blocked.push(`Cannot create folder ${destinationPath}: ${parent} is a file.`); }
    const action = existingFolders.has(key) ? 'skip' : 'create';
    reserved.add(key);
    items.push({ kind: 'folder', sourcePath, destinationPath, action });
  }
  for (const source of [...batch.notes.map((item) => ({ ...item, kind: 'note' as const })), ...batch.attachments.map((item) => ({ ...item, kind: 'attachment' as const })), ...batch.canvases.map((item) => ({ ...item, kind: 'canvas' as const }))]) {
    const path = relativePath(source.path);
    const destinationPath = path.split('/').reduce((parent, part) => joinVaultPath(parent, part), root);
    const parents = destinationPath.split('/').filter(Boolean).slice(0, -1);
    let parentPath = '';
    for (const part of parents) { parentPath += `/${part}`; if (existing.has(pathKey(parentPath)) || plannedFiles.has(pathKey(parentPath))) blocked.push(`Cannot create a folder at ${parentPath}: a file already occupies that path.`); }
    const prior = existing.get(pathKey(destinationPath));
    const collision = reserved.has(pathKey(destinationPath));
    if (collision) conflicts++;
    let action: PlannedImportItem['action'] = 'create';
    let target = destinationPath;
    let markdown: string | undefined;
    if (collision) {
      if (strategy === 'rename') target = renamed(destinationPath, reserved);
      else if (strategy === 'skip' || source.kind !== 'note') action = 'skip';
      else if (prior?.kind !== 'note') blocked.push(`Cannot ${strategy} ${destinationPath}: it is not an existing note.`);
      else if (strategy === 'overwrite') {
        if (prior.item.collaborative) blocked.push(`Cannot overwrite collaborative note ${destinationPath}.`);
        action = 'overwrite';
      }
      else {
        const current = await repository.getNote(prior.item.id);
        const merged = current ? safeMerge(current.markdown, source.markdown) : null;
        if (merged === null) blocked.push(`Cannot safely merge ${destinationPath}; choose rename, skip, or overwrite.`);
        else { action = 'merge'; markdown = merged; }
      }
    }
    reserved.add(pathKey(target));
    if (action === 'create') plannedFiles.add(pathKey(target));
    items.push({ kind: source.kind, sourcePath: source.path, destinationPath: target, action, existingId: prior?.item.id, existingRevision: prior?.kind === 'note' ? prior.item.revision : undefined, markdown });
  }
  return { items, conflicts, blocked, signature: JSON.stringify(items.map(({ sourcePath, destinationPath, action, existingId, existingRevision }) => [sourcePath, destinationPath, action, existingId, existingRevision])) };
}

export function createImportReport(batch: ImportBatch, plan: ImportPlan | null): VaultImportReport {
  const analysis = batch.nativeArchive ? { warnings: [], unsupportedSyntax: [], brokenReferences: [] } : analyzeMarkdownVault(batch.notes, batch.attachments, batch.canvases);
  const warnings = [...batch.unsupported, ...analysis.warnings];
  if (plan?.items.some((item) => item.action === 'create' && item.sourcePath !== item.destinationPath.replace(/^\//u, '') && /\(imported \d+\)/u.test(item.destinationPath))) warnings.push('Renamed import paths may change link targets. Original Markdown was preserved; review links to renamed files.');
  const successes = batch.nativeArchive
    ? [...batch.folders.map((item) => ({ path: `/${item}`, kind: 'folder' as const, action: 'restore' })), ...batch.notes.map((item) => ({ path: `/${item.path}`, kind: 'note' as const, action: 'restore' })), ...batch.attachments.map((item) => ({ path: `/${item.path}`, kind: 'attachment' as const, action: 'restore' })), ...batch.canvases.map((item) => ({ path: `/${item.path}`, kind: 'canvas' as const, action: 'restore' }))]
    : plan?.items.filter((item) => item.action !== 'skip').map((item) => ({ path: item.destinationPath, kind: item.kind, action: item.action })) ?? [];
  return { successes, warnings, unsupportedSyntax: analysis.unsupportedSyntax, brokenReferences: analysis.brokenReferences };
}

function remapCanvasFiles(canvas: VaultImportCanvas, items: readonly PlannedImportItem[]): unknown {
  const copy: unknown = structuredClone(canvas.document);
  const parsed = z.object({ nodes: z.array(z.object({ type: z.string(), file: z.string().optional() }).passthrough()) }).passthrough().parse(copy);
  const paths = new Map(items.filter((item) => item.action !== 'skip').map((item) => [pathKey(`/${item.sourcePath}`), item.destinationPath]));
  for (const node of parsed.nodes) {
    if (node.type !== 'file' || !node.file) continue;
    const source = resolveVaultReference(`/${canvas.path}`, node.file);
    const destination = source ? paths.get(pathKey(source)) : undefined;
    if (destination) node.file = destination;
  }
  return parsed;
}

export async function commitImport(batch: ImportBatch, repository: VaultRepository, vaultId: string, targetFolderId: string | null, strategy: ConflictStrategy, preview: ImportPlan): Promise<{ imported: number; vaultId: string }> {
  if (batch.nativeArchive) { const created = await importVaultZip(repository, batch.nativeArchive); return { imported: batch.folders.length + batch.notes.length + batch.attachments.length + batch.canvases.length, vaultId: created }; }
  const tree = await repository.listTree(vaultId);
  const fresh = await planImport(batch, repository, tree, targetFolderId, strategy);
  if (fresh.signature !== preview.signature || fresh.blocked.length) throw new Error('The vault changed after preview. Review the import again.');
  const folders = new Map(tree.folders.map((item) => [pathKey(item.path), item.id]));
  const noteSources = new Map(batch.notes.map((item) => [item.path, item]));
  const attachmentSources = new Map(batch.attachments.map((item) => [item.path, item]));
  const canvasSources = new Map(batch.canvases.map((item) => [item.path, item]));
  let imported = 0;
  const zip = batch.archive ? await import('@zip.js/zip.js') : null;
  const archiveReader = zip && batch.archive ? new zip.ZipReader(new zip.BlobReader(batch.archive)) : null;
  try {
  const archiveEntries = archiveReader ? new Map((await archiveReader.getEntries()).map((entry) => [entry.filename, entry])) : null;
  for (const item of fresh.items) {
    if (item.action === 'skip') continue;
    if (item.action === 'merge' || item.action === 'overwrite') {
      if (!item.existingId || item.kind !== 'note') throw new Error('Import conflict changed');
      const source = noteSources.get(item.sourcePath)!;
      const current = await repository.getNote(item.existingId);
      if (!current || current.revision !== item.existingRevision || current.collaborative) throw new Error('A destination note changed. Review the import again.');
      await repository.saveNote(current.id, { markdown: item.action === 'merge' ? item.markdown! : source.markdown }, true);
      imported++;
      continue;
    }
    const parts = item.destinationPath.split('/').filter(Boolean);
    let folderId: string | null = targetFolderId;
    let path = tree.folders.find((folder) => folder.id === targetFolderId)?.path ?? '';
    for (const part of parts.slice(path ? path.split('/').filter(Boolean).length : 0, item.kind === 'folder' ? undefined : -1)) {
      path += `/${part}`;
      const key = pathKey(path);
      folderId = folders.get(key) ?? (await repository.createFolder(vaultId, folderId, part)).id;
      folders.set(key, folderId);
    }
    if (item.kind === 'folder') { imported++; continue; }
    if (item.kind === 'note') {
      const source = noteSources.get(item.sourcePath)!;
      const parsed = parsePortableMarkdown(source.markdown, source.title);
      const now = new Date().toISOString();
      await repository.importNote(vaultId, folderId, { path: item.destinationPath, title: parsed.title, markdown: source.markdown, createdAt: now, updatedAt: now, aliases: parsed.aliases, properties: parsed.properties });
    } else if (item.kind === 'attachment') {
      const source = attachmentSources.get(item.sourcePath)!;
      const archiveEntry = source.archivePath ? archiveEntries?.get(source.archivePath) : null;
      let blob = source.blob;
      if (!blob && archiveEntry && 'getData' in archiveEntry && zip) blob = await readBoundedZipBlob(archiveEntry, MAX_ASSET_BYTES);
      if (!blob || blob.size > MAX_ASSET_BYTES) throw new Error(`Attachment is unavailable or too large: ${source.path}`);
      await repository.addAttachment(vaultId, folderId, blob, parts.at(-1)!);
    } else {
      const source = canvasSources.get(item.sourcePath)!;
      const destination = await repository.listTree(vaultId);
      const document = importJsonCanvas(remapCanvasFiles(source, fresh.items), destination.notes, destination.attachments, item.destinationPath);
      const now = new Date().toISOString();
      await repository.putObject('canvas', canvasSchema.parse({ id: crypto.randomUUID(), vaultId, path: item.destinationPath, title: parts.at(-1)!.replace(/\.canvas$/iu, ''), document, createdAt: now, updatedAt: now, deletedAt: null }));
    }
    imported++;
  } } catch (cause) {
    if (imported) throw new Error(`Import stopped after ${imported} item${imported === 1 ? '' : 's'}; review the vault before retrying. ${cause instanceof Error ? cause.message : ''}`);
    throw cause;
  } finally { await archiveReader?.close(); }
  return { imported, vaultId };
}
