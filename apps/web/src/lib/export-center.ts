import { applyBaseView, baseFieldValue, baseSchema, baseValueText, canvasSchema, evaluateBaseFormulas, exportJsonCanvas, readBaseDefinition, readCanvasDocument, selectBaseNotes, type Attachment, type Base, type Canvas, type VaultNote, type VaultObjectKind } from '@noor-note/core';
import type { VaultRepository, VaultTree } from '@noor-note/storage';
import { renderExportHtml } from './export-html';
import { SearchClient } from './search-client';
import { exportVaultZip } from './vault-archive';

export type ExportFormat = 'noor-zip' | 'markdown-zip' | 'folder-zip' | 'note-md' | 'note-html' | 'note-pdf' | 'json-archive' | 'base-csv' | 'canvas-json';
export interface ExportSelection { format: ExportFormat; vaultId: string; noteId?: string; folderId?: string; baseId?: string; canvasId?: string }
export interface PortabilityReport { included: string[]; limitations: string[]; itemCount: number }
export interface ExportArtifact { filename: string; blob: Blob; delivery: 'download' | 'print'; report: PortabilityReport }
export interface ExportInventory { tree: VaultTree; bases: Base[]; canvases: Canvas[] }

const structuredKinds: VaultObjectKind[] = ['tag', 'property', 'link', 'task', 'canvas', 'base', 'template', 'bookmark', 'workspace', 'dashboard', 'studyCard', 'comment', 'userPreference', 'metadataSchema', 'pdfAnnotation', 'ocrRecord', 'transcript'];
const MAX_JSON_ATTACHMENTS = 32 * 1024 * 1024;
const MAX_JSON_TEXT = 64 * 1024 * 1024;

function filename(name: string): string { return name.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 120) || 'Noor-Note'; }
function nameFromPath(path: string): string { return path.split('/').at(-1) ?? 'Note'; }
function selected(path: string, folderPath?: string): boolean { return !folderPath || path === folderPath || path.startsWith(`${folderPath}/`); }
function zipPath(path: string): string { return path.replace(/^\//u, ''); }
function base64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let index = 0; index < bytes.length; index += 24_576) chunks.push(btoa(String.fromCharCode(...bytes.subarray(index, index + 24_576))));
  return chunks.join('');
}
function csvCell(input: string): string {
  const safe = /^[=+\-@\t\r]/u.test(input) ? `'${input}` : input;
  return /[",\r\n]/u.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export async function loadExportInventory(repository: VaultRepository, vaultId: string): Promise<ExportInventory> {
  const [tree, bases, canvases] = await Promise.all([
    repository.listTree(vaultId),
    repository.listObjects('base', vaultId),
    repository.listObjects('canvas', vaultId),
  ]);
  return { tree, bases: bases.map((item) => baseSchema.parse(item)).filter((item) => !item.deletedAt), canvases: canvases.map((item) => canvasSchema.parse(item)).filter((item) => !item.deletedAt) };
}

function resource(selection: ExportSelection, inventory: ExportInventory): { folderPath?: string; base?: Base; canvas?: Canvas } {
  const folder = inventory.tree.folders.find((item) => item.id === selection.folderId);
  const base = inventory.bases.find((item) => item.id === selection.baseId);
  const canvas = inventory.canvases.find((item) => item.id === selection.canvasId);
  if (selection.format === 'folder-zip' && !folder) throw new Error('Select a folder to export');
  if (selection.format === 'base-csv' && !base) throw new Error('Select a Base to export');
  if (selection.format === 'canvas-json' && !canvas) throw new Error('Select a Canvas to export');
  if (['note-md', 'note-html', 'note-pdf'].includes(selection.format) && !inventory.tree.notes.some((item) => item.id === selection.noteId)) throw new Error('Select a note to export');
  return { folderPath: folder?.path, base, canvas };
}

/** Lists real data boundaries before a download is prepared. */
export function portabilityReport(selection: ExportSelection, inventory: ExportInventory): PortabilityReport {
  const { tree, canvases } = inventory;
  const { folderPath } = resource(selection, inventory);
  const scopedNotes = tree.notes.filter((item) => selected(item.path, folderPath));
  const scopedAttachments = tree.attachments.filter((item) => selected(item.path, folderPath));
  const scopedCanvases = canvases.filter((item) => selected(item.path, folderPath));
  const localOnly = 'Trash, cloud comments, account state, plugin installations, AI chats, and device preferences are outside this export.';
  switch (selection.format) {
    case 'noor-zip': return { included: [`${tree.folders.length} folders, ${tree.notes.length} Markdown notes, and ${tree.attachments.length} attachments`, 'Local revisions and supported structured vault records'], limitations: [localOnly], itemCount: tree.notes.length + tree.attachments.length + tree.folders.length };
    case 'markdown-zip':
    case 'folder-zip': return { included: [`${scopedNotes.length} original Markdown files`, `${scopedAttachments.length} attachments`, `${scopedCanvases.length} compatible JSON Canvas files`, 'Folder paths and explicit empty folders'], limitations: ['Revision history, Base definitions, dashboards, study schedules, OCR/transcript sidecars, PDF annotations, and other Noor-only records are not included.', 'Wiki links and relative paths remain source text; links to content outside this export may not resolve.'], itemCount: scopedNotes.length + scopedAttachments.length + scopedCanvases.length };
    case 'note-md': return { included: ['One original Markdown note, including its YAML frontmatter'], limitations: ['Linked attachments and other notes are not bundled.', 'Revision history, comments, and structured Noor-only records are not included.'], itemCount: 1 };
    case 'note-html': return { included: ['One rendered HTML note with escaped original Markdown source', 'Referenced local raster images up to 5 MiB each are embedded when available'], limitations: ['Other attachments, linked notes, revisions, comments, interactive Canvas, and Base views are not bundled.', 'Wiki links and embeds may display as text or fallback labels; Mermaid and LaTeX are not rendered as interactive diagrams or typeset math.'], itemCount: 1 };
    case 'note-pdf': return { included: ['One printable note with embedded local raster images when available'], limitations: ['PDF is created through the browser print dialog; choose Save as PDF there. Noor Note cannot choose the PDF destination for you.', 'Original Markdown, linked attachments, revisions, comments, Canvas, and Base views are not embedded in the printed PDF.'], itemCount: 1 };
    case 'json-archive': return { included: [`${tree.notes.length} full note records, ${tree.attachments.length} attachment records with bytes, ${tree.folders.length} folders`, 'Local revisions and validated structured objects'], limitations: ['This self-contained JSON format is documented for portability; it is not currently a Noor Note import format.', 'Attachment content is base64 encoded and limited to 32 MiB total; use Noor ZIP for larger vaults.', localOnly], itemCount: tree.notes.length + tree.attachments.length + tree.folders.length };
    case 'base-csv': return { included: ['Rows matching the selected Base query and active view, including visible fields and note paths', 'Computed formula results exported as values'], limitations: ['Markdown bodies, attachments, Base query/view configuration, formulas, and nonvisible fields are not included.', 'CSV cells beginning with spreadsheet formula characters are escaped for safer spreadsheet opening.'], itemCount: 0 };
    case 'canvas-json': return { included: ['One JSON Canvas document with Noor metadata in its namespace'], limitations: ['Referenced notes and attachments are paths only; their content and bytes are not bundled.', 'Noor Canvas undo history, comments, and presentation state outside the document are not included.'], itemCount: 1 };
  }
}

async function getNote(repository: VaultRepository, id?: string): Promise<VaultNote> {
  if (!id) throw new Error('Select a note to export');
  const note = await repository.getNote(id);
  if (!note || note.deletedAt) throw new Error('The selected note is unavailable');
  return note;
}

async function portableZip(repository: VaultRepository, inventory: ExportInventory, folderPath?: string): Promise<Blob> {
  const { BlobReader, BlobWriter, TextReader, ZipWriter } = await import('@zip.js/zip.js');
  const { tree, canvases } = inventory;
  const writer = new ZipWriter(new BlobWriter('application/zip'));
  try {
    for (const folder of tree.folders.filter((item) => selected(item.path, folderPath))) await writer.add(`${zipPath(folder.path)}/`, undefined, { directory: true });
    for (const entry of tree.notes.filter((item) => selected(item.path, folderPath))) {
      const note = await getNote(repository, entry.id);
      await writer.add(zipPath(entry.path), new TextReader(note.markdown));
    }
    for (const attachment of tree.attachments.filter((item) => selected(item.path, folderPath))) {
      const blob = await repository.getAttachmentBlob(attachment.id);
      if (!blob) throw new Error(`Attachment bytes are missing: ${attachment.path}`);
      await writer.add(zipPath(attachment.path), new BlobReader(blob));
    }
    for (const canvas of canvases.filter((item) => selected(item.path, folderPath))) await writer.add(zipPath(canvas.path), new TextReader(JSON.stringify(exportJsonCanvas(readCanvasDocument(canvas), tree.notes, tree.attachments, canvas.path), null, 2)));
    return await writer.close();
  } catch (cause) { await writer.close().catch(() => undefined); throw cause; }
}

async function jsonArchive(repository: VaultRepository, inventory: ExportInventory): Promise<Blob> {
  const { tree } = inventory;
  const attachmentSize = tree.attachments.reduce((sum, item) => sum + item.size, 0);
  if (attachmentSize > MAX_JSON_ATTACHMENTS) throw new Error('JSON archive attachment limit is 32 MiB; choose Noor ZIP for this vault');
  const notes: VaultNote[] = [];
  let textBytes = 0;
  for (const entry of tree.notes) {
    const note = await getNote(repository, entry.id);
    textBytes += new TextEncoder().encode(note.markdown).byteLength;
    if (textBytes > MAX_JSON_TEXT) throw new Error('JSON archive text limit is 64 MiB; choose Noor ZIP for this vault');
    notes.push(note);
  }
  const attachments: { metadata: Attachment; contentBase64: string }[] = [];
  let actualAttachmentSize = 0;
  for (const item of tree.attachments) {
    const blob = await repository.getAttachmentBlob(item.id);
    if (!blob) throw new Error(`Attachment bytes are missing: ${item.path}`);
    actualAttachmentSize += blob.size;
    if (actualAttachmentSize > MAX_JSON_ATTACHMENTS) throw new Error('JSON archive attachment limit is 32 MiB; choose Noor ZIP for this vault');
    attachments.push({ metadata: item, contentBase64: base64(new Uint8Array(await blob.arrayBuffer())) });
  }
  const objects: Record<string, unknown[]> = {};
  for (const kind of structuredKinds) objects[kind] = await repository.listObjects(kind, tree.vault.id);
  const revisions = [];
  for (const note of notes) revisions.push(...await repository.listRevisions(note.id));
  return new Blob([JSON.stringify({ format: 'noor-note-json-archive', version: 1, exportedAt: new Date().toISOString(), vault: tree.vault, folders: tree.folders, notes, attachments, revisions, objects }, null, 2)], { type: 'application/json' });
}

async function baseCsv(repository: VaultRepository, inventory: ExportInventory, base: Base): Promise<{ blob: Blob; rows: number }> {
  const definition = readBaseDefinition(base);
  const view = definition.views.find((item) => item.id === definition.activeViewId);
  if (!view) throw new Error('The Base active view is unavailable');
  let searchIds: Set<string> | undefined;
  if (definition.query.search.trim()) {
    const search = new SearchClient();
    try { searchIds = new Set((await search.search(repository, inventory.tree.vault.id, definition.query.search, inventory.tree.notes.length)).map((item) => item.id)); }
    finally { search.close(); }
  }
  const computed = evaluateBaseFormulas(inventory.tree.notes, definition.formulas);
  const selectedNotes = selectBaseNotes(inventory.tree.notes, definition.query, inventory.tree.folders, searchIds, computed);
  const rows = applyBaseView(selectedNotes, view, inventory.tree.folders, computed);
  const fields = [...new Set(['id', 'path', ...view.columnOrder.filter((field) => view.visibleFields.includes(field)), ...view.visibleFields])];
  const lines = [fields.map(csvCell).join(',')];
  for (const note of rows) lines.push(fields.map((field) => csvCell(field === 'id' ? note.id : baseValueText(baseFieldValue(note, field, inventory.tree.folders, computed)))).join(','));
  return { blob: new Blob([`${lines.join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' }), rows: rows.length };
}

export async function createExport(repository: VaultRepository, selection: ExportSelection, inventory?: ExportInventory): Promise<ExportArtifact> {
  const data = inventory ?? await loadExportInventory(repository, selection.vaultId);
  if (data.tree.vault.id !== selection.vaultId) throw new Error('Export vault changed');
  const { folderPath, base, canvas } = resource(selection, data);
  const report = portabilityReport(selection, data);
  const vaultName = filename(data.tree.vault.name);
  switch (selection.format) {
    case 'noor-zip': return { filename: `${vaultName}-noor.zip`, blob: await exportVaultZip(repository, selection.vaultId), delivery: 'download', report };
    case 'markdown-zip': return { filename: `${vaultName}-markdown.zip`, blob: await portableZip(repository, data), delivery: 'download', report };
    case 'folder-zip': return { filename: `${filename(nameFromPath(folderPath!))}-markdown.zip`, blob: await portableZip(repository, data, folderPath), delivery: 'download', report };
    case 'note-md': {
      const note = await getNote(repository, selection.noteId);
      return { filename: filename(nameFromPath(note.path)), blob: new Blob([note.markdown], { type: 'text/markdown;charset=utf-8' }), delivery: 'download', report };
    }
    case 'note-html':
    case 'note-pdf': {
      const note = await getNote(repository, selection.noteId);
      const rendered = await renderExportHtml(note, data.tree.attachments, repository, selection.format === 'note-pdf');
      report.limitations.push(...rendered.warnings);
      return { filename: `${filename(nameFromPath(note.path).replace(/\.md$/iu, ''))}.html`, blob: new Blob([rendered.html], { type: 'text/html;charset=utf-8' }), delivery: selection.format === 'note-pdf' ? 'print' : 'download', report };
    }
    case 'json-archive': return { filename: `${vaultName}-archive.json`, blob: await jsonArchive(repository, data), delivery: 'download', report };
    case 'base-csv': {
      const result = await baseCsv(repository, data, base!);
      return { filename: `${filename(base!.title)}.csv`, blob: result.blob, delivery: 'download', report: { ...report, itemCount: result.rows } };
    }
    case 'canvas-json': return { filename: filename(nameFromPath(canvas!.path)), blob: new Blob([JSON.stringify(exportJsonCanvas(readCanvasDocument(canvas!), data.tree.notes, data.tree.attachments, canvas!.path), null, 2)], { type: 'application/json' }), delivery: 'download', report };
  }
}
