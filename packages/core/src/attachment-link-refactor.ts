import { pathKey, type VaultNote } from './vault-domain';
import { resolveVaultReference } from './vault-note';

export interface AttachmentLinkChange { noteId: string; title: string; path: string; before: string; after: string; revision: number; count: number }
const link = /(!?\[(?:\\.|[^\]\\\n])*\]\()([^\s)\n]+)(\))/gu;
const fence = /^[ \t]{0,3}(`{3,}|~{3,})/u;

function relativePath(fromPath: string, toPath: string): string {
  const from = fromPath.split('/').filter(Boolean).slice(0, -1);
  const to = toPath.split('/').filter(Boolean);
  while (from.length && to.length && from[0]!.toLocaleLowerCase() === to[0]!.toLocaleLowerCase()) { from.shift(); to.shift(); }
  return [...from.map(() => '..'), ...to].map((part) => encodeURIComponent(part).replace(/\(/gu, '%28').replace(/\)/gu, '%29')).join('/');
}

/** Rewrites local Markdown links to a renamed attachment; skips YAML and code. */
export function planAttachmentLinkRename(notes: readonly VaultNote[], oldPath: string, newPath: string): AttachmentLinkChange[] {
  const oldKey = pathKey(oldPath);
  return notes.flatMap((note) => {
    let inFrontmatter = /^\uFEFF?---[ \t]*\r?\n/u.test(note.markdown);
    let inFence: { marker: string; length: number } | null = null;
    let count = 0;
    const lines = note.markdown.split('\n').map((line, index) => {
      if (inFrontmatter) { if (index > 0 && /^---[ \t]*\r?$/u.test(line)) inFrontmatter = false; return line; }
      const marker = line.match(fence)?.[1];
      if (marker) { if (!inFence) inFence = { marker: marker[0]!, length: marker.length }; else if (marker[0] === inFence.marker && marker.length >= inFence.length) inFence = null; return line; }
      if (inFence || line.includes('`')) return line;
      return line.replace(link, (raw, open: string, destination: string, close: string) => {
        const resolved = resolveVaultReference(note.path, destination);
        if (!resolved || pathKey(resolved) !== oldKey) return raw;
        count += 1;
        const pathOnly = destination.split(/[?#]/u, 1)[0] ?? destination;
        return `${open}${relativePath(note.path, newPath)}${destination.slice(pathOnly.length)}${close}`;
      });
    });
    return count ? [{ noteId: note.id, title: note.title, path: note.path, before: note.markdown, after: lines.join('\n'), revision: note.revision, count }] : [];
  });
}
