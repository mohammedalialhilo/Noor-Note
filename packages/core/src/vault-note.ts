import { parseDocument, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';
import { joinVaultPath, safeFileStem, vaultNoteSchema, type PropertyValue, type VaultNote } from './vault-domain';

const frontmatterSchema = z.record(z.string(), z.unknown());

export interface ParsedPortableMarkdown {
  markdown: string;
  title: string;
  aliases: string[];
  properties: Record<string, PropertyValue>;
}

export function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/u, '').replace(/^\r?\n/u, '');
}

export function resolveVaultReference(notePath: string, reference: string): string | null {
  const raw = reference.split(/[?#]/u, 1)[0] ?? '';
  if (!raw || /^[a-z][a-z\d+.-]*:/iu.test(raw) || raw.startsWith('//') || raw.includes('\\')) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(raw); } catch { return null; }
  const parts = decoded.startsWith('/') ? [] : notePath.split('/').filter(Boolean).slice(0, -1);
  for (const segment of decoded.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') { if (!parts.length) return null; parts.pop(); continue; }
    if (Array.from(segment).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return null;
    parts.push(segment);
  }
  return `/${parts.join('/')}`;
}

export function parsePortableMarkdown(source: string, fallbackTitle = 'Untitled note'): ParsedPortableMarkdown {
  const markdown = source.replace(/^\uFEFF/u, '');
  const match = markdown.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/u);
  const properties: Record<string, PropertyValue> = {};
  let aliases: string[] = [];
  let title = '';
  if (match) {
    if ((match[1]?.length ?? 0) > 65_536) throw new Error('Frontmatter is too large');
    const document = parseDocument(match[1] ?? '', { uniqueKeys: true, stringKeys: true });
    if (document.errors.length) throw new Error('Invalid YAML frontmatter');
    const parsed: unknown = document.toJS({ maxAliasCount: 0 });
    if (parsed !== null) {
      const object = frontmatterSchema.parse(parsed);
      for (const [key, value] of Object.entries(object)) {
        if (key === 'title') { title = z.string().max(200).parse(value); continue; }
        if (key === 'aliases') { aliases = z.array(z.string().trim().min(1).max(200)).parse(value); continue; }
        properties[key] = z.json().parse(value);
      }
    }
  }
  const body = match ? markdown.slice(match[0].length) : markdown;
  if (!title) {
    const heading = body.match(/^(?:[ \t]*\r?\n)*[ \t]{0,3}#[ \t]+([^\r\n]+)(?:\r?\n|$)/u);
    title = heading?.[1]?.replace(/[ \t]+#+[ \t]*$/u, '').trim() || fallbackTitle;
  }
  return { markdown, title: title.slice(0, 200), aliases, properties };
}

export function withFrontmatter(note: Pick<VaultNote, 'markdown' | 'title' | 'aliases' | 'properties'>): string {
  if (/^---[ \t]*\r?\n/u.test(note.markdown)) return note.markdown;
  const metadata: Record<string, PropertyValue> = { ...note.properties, title: note.title };
  if (note.aliases.length) metadata.aliases = note.aliases;
  return `---\n${stringifyYaml(metadata)}---\n\n${note.markdown}`;
}

export async function checksumMarkdown(markdown: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(markdown));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function makeVaultNote(options: {
  vaultId: string;
  folderId?: string | null;
  folderPath?: string;
  title?: string;
  markdown?: string;
  path?: string;
  id?: string;
  now?: Date;
}): Promise<VaultNote> {
  const parsed = parsePortableMarkdown(options.markdown ?? '', options.title || 'Untitled note');
  const title = options.title ?? parsed.title;
  const path = options.path ?? joinVaultPath(options.folderPath ?? '/', `${safeFileStem(title)}.md`);
  const now = (options.now ?? new Date()).toISOString();
  return vaultNoteSchema.parse({
    id: options.id ?? crypto.randomUUID(), vaultId: options.vaultId, folderId: options.folderId ?? null, path,
    title, markdown: parsed.markdown, createdAt: now, updatedAt: now, deletedAt: null, trashGroupId: null,
    aliases: parsed.aliases, properties: parsed.properties, revision: 1, checksum: await checksumMarkdown(parsed.markdown),
  });
}
