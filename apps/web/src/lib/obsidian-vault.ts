import { headingSlug, importJsonCanvas, parseBlocks, parseInternalLinks, parseOutline, parsePortableMarkdown, resolveVaultReference } from '@noor-note/core';

export interface VaultImportNote { path: string; title: string; markdown: string }
export interface VaultImportCanvas { path: string; document: unknown }
export interface VaultImportIssue { path: string; line?: number; target?: string; reason: string }
export interface VaultImportReport {
  successes: { path: string; kind: 'folder' | 'note' | 'attachment' | 'canvas'; action: string }[];
  warnings: string[];
  unsupportedSyntax: VaultImportIssue[];
  brokenReferences: VaultImportIssue[];
}

const assetExtension = /\.(?:png|jpe?g|gif|webp|svg|avif|bmp|pdf|mp3|m4a|wav|ogg|mp4|webm|mov|canvas|zip)$/iu;
const pluginFence = /^[ \t]{0,3}`{3,}[ \t]*(dataview(?:js)?|tasks|excalidraw|query)\b/iu;

function key(path: string): string { return path.normalize('NFKC').toLocaleLowerCase(); }
function stem(path: string): string { return path.replace(/\.(?:md|markdown)$/iu, ''); }
function basename(path: string): string { return path.split('/').at(-1) ?? path; }
function maybeDecode(value: string): string { try { return decodeURIComponent(value); } catch { return value; } }
function candidates(target: string, sourcePath: string, paths: readonly string[]): string[] {
  const raw = maybeDecode(target.replaceAll('\\', '/'));
  const absolute = resolveVaultReference(sourcePath, raw);
  const exact = [absolute, `/${raw.replace(/^\/+|\/+$/gu, '')}`].filter((item): item is string => Boolean(item));
  for (const path of exact) {
    const match = paths.find((item) => key(item) === key(path) || key(stem(item)) === key(stem(path)));
    if (match) return [match];
  }
  if (raw.includes('/')) return paths.filter((item) => key(item).endsWith(`/${key(raw)}`) || key(stem(item)).endsWith(`/${key(stem(raw))}`));
  const sameFolder = sourcePath.slice(0, sourcePath.lastIndexOf('/'));
  const local = paths.filter((item) => item.slice(0, item.lastIndexOf('/')) === sameFolder && (key(basename(item)) === key(raw) || key(stem(basename(item))) === key(stem(raw))));
  if (local.length) return local;
  return paths.filter((item) => key(basename(item)) === key(raw) || key(stem(basename(item))) === key(stem(raw)));
}

function assetLinks(markdown: string): { target: string; line: number }[] {
  const result: { target: string; line: number }[] = [];
  let fence: string | null = null;
  let frontmatter = markdown.startsWith('---\n');
  markdown.split('\n').forEach((line, index) => {
    if (frontmatter) { if (index > 0 && /^---[ \t]*$/u.test(line)) frontmatter = false; return; }
    const marker = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/u)?.[1];
    if (marker) { if (!fence) fence = marker[0]!; else if (fence === marker[0]) fence = null; return; }
    if (fence) return;
    const visible = line.replace(/(`+)(.*?)\1/gu, (match) => ' '.repeat(match.length));
    for (const match of visible.matchAll(/!?\[[^\]\n]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/gu)) {
      const target = match[1] ?? '';
      if (target && !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/iu.test(target) && !/\.md(?:#|$)/iu.test(target)) result.push({ target, line: index + 1 });
    }
  });
  return result;
}

/** Audits references inside the selected source vault without editing Markdown. */
export function analyzeMarkdownVault(notes: readonly VaultImportNote[], attachments: readonly { path: string }[], canvases: readonly VaultImportCanvas[]): Pick<VaultImportReport, 'warnings' | 'unsupportedSyntax' | 'brokenReferences'> {
  const warnings: string[] = [];
  const unsupportedSyntax: VaultImportIssue[] = [];
  const brokenReferences: VaultImportIssue[] = [];
  const notePaths = notes.map((note) => `/${note.path}`);
  const assetPaths = [...attachments, ...canvases].map((item) => `/${item.path}`);
  const byPath = new Map(notes.map((note) => [key(`/${note.path}`), note]));
  const aliases = new Map<string, string[]>();
  for (const note of notes) {
    const parsed = parsePortableMarkdown(note.markdown, note.title);
    for (const alias of parsed.aliases) aliases.set(key(alias), [...(aliases.get(key(alias)) ?? []), `/${note.path}`]);
  }
  for (const note of notes) {
    const sourcePath = `/${note.path}`;
    const links = parseInternalLinks(note.markdown);
    for (const link of links) {
      const target = link.target;
      const isAsset = assetExtension.test(target);
      let matches = candidates(target, sourcePath, isAsset ? assetPaths : notePaths);
      if (!isAsset && !matches.length && !target.includes('/')) matches = aliases.get(key(target)) ?? [];
      if (matches.length !== 1) {
        brokenReferences.push({ path: note.path, line: link.line, target, reason: matches.length ? 'Ambiguous target in selected vault' : 'Target missing from selected vault' });
        continue;
      }
      if (isAsset) continue;
      const resolved = byPath.get(key(matches[0]!));
      if (!resolved) continue;
      if (link.heading && !link.blockId && !parseOutline(resolved.markdown).some((heading) => heading.id === headingSlug(link.heading!) || headingSlug(heading.text) === headingSlug(link.heading!))) brokenReferences.push({ path: note.path, line: link.line, target, reason: `Heading missing: ${link.heading}` });
      if (link.blockId && !parseBlocks(resolved.markdown).some((block) => block.id === link.blockId)) brokenReferences.push({ path: note.path, line: link.line, target, reason: `Block missing: ${link.blockId}` });
    }
    for (const link of assetLinks(note.markdown)) {
      if (candidates(link.target, sourcePath, assetPaths).length !== 1) brokenReferences.push({ path: note.path, line: link.line, target: link.target, reason: 'Attachment missing or ambiguous in selected vault' });
    }
    note.markdown.split('\n').forEach((line, index) => {
      const plugin = line.match(pluginFence)?.[1];
      if (plugin) unsupportedSyntax.push({ path: note.path, line: index + 1, reason: `${plugin} plugin block remains in Markdown; Noor Note does not execute it` });
    });
  }
  for (const canvas of canvases) {
    const document = canvas.document;
    if (!document || typeof document !== 'object' || !('nodes' in document) || !Array.isArray(document.nodes)) continue;
    for (const node of document.nodes) {
      if (!node || typeof node !== 'object') continue;
      if ('subpath' in node || 'background' in node || 'backgroundStyle' in node) unsupportedSyntax.push({ path: canvas.path, reason: 'JSON Canvas subpath or group background is not preserved' });
      if ('type' in node && node.type === 'file' && 'file' in node && typeof node.file === 'string' && candidates(node.file, `/${canvas.path}`, [...notePaths, ...assetPaths]).length !== 1) brokenReferences.push({ path: canvas.path, target: node.file, reason: 'Canvas file target missing or ambiguous in selected vault' });
    }
  }
  if (brokenReferences.length) warnings.push(`${brokenReferences.length} reference${brokenReferences.length === 1 ? '' : 's'} could not be resolved within the selected source vault. References to files already in the destination may still resolve.`);
  return { warnings, unsupportedSyntax, brokenReferences };
}

export function validateJsonCanvas(path: string, source: string): VaultImportCanvas {
  const document: unknown = JSON.parse(source);
  importJsonCanvas(document, [], [], `/${path}`);
  return { path, document };
}
