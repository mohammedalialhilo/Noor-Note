import { headingSlug, parseInternalLinks, parseWikiReference, pathKey, resolveLinkTarget, resolveVaultReference, stripFrontmatter, type Attachment } from '@noor-note/core';
import { z } from 'zod';

export const slugSchema = z.string().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
export const siteSchema = z.object({
  vault_id: z.uuid(), slug: slugSchema.max(80), title: z.string().min(1).max(160),
  description: z.string().max(500), theme: z.enum(['light', 'dark', 'system']),
  robots: z.enum(['index', 'noindex']), navigation: z.array(slugSchema),
  homepage_slug: slugSchema.nullable(), graph_enabled: z.boolean(),
  logo_path: z.string().nullable(), favicon_path: z.string().nullable(),
});
export const pageSchema = z.object({
  vault_id: z.uuid(), note_id: z.uuid(), slug: slugSchema,
  title: z.string().min(1).max(200), source_path: z.string().min(1).max(1024),
  aliases: z.array(z.string()), markdown: z.string().max(1_048_576),
  assets: z.record(z.string(), z.uuid()), description: z.string().max(500),
  published_at: z.string(), updated_at: z.string(),
});
export type PublicSite = z.infer<typeof siteSchema>;
export type PublicPage = z.infer<typeof pageSchema>;

export function publicationSlug(value: string): string {
  return value.normalize('NFKD').toLocaleLowerCase('en').replace(/[\u0300-\u036f]/gu, '').replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '').slice(0, 100).replace(/-$/u, '');
}

/** Remove internal identity annotations and frontmatter from the public copy. */
export function publicSnapshotMarkdown(markdown: string): string {
  return stripFrontmatter(markdown).replace(/<!--\s*noor-note-id:[0-9a-f-]{36}\s*-->/giu, '');
}

/** Select only local image references outside fenced and inline code. */
export function referencedPublicImages(markdown: string, notePath: string, attachments: Attachment[]): Attachment[] {
  const referenced = new Set<string>();
  let fence: { marker: string; length: number } | null = null;
  for (const line of stripFrontmatter(markdown).split('\n')) {
    const delimiter = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/u)?.[1];
    if (delimiter) {
      if (!fence) fence = { marker: delimiter[0]!, length: delimiter.length };
      else if (delimiter[0] === fence.marker && delimiter.length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;
    const visible = line.replace(/(`+)(.*?)\1/gu, (match) => ' '.repeat(match.length));
    for (const match of visible.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)|!\[\[([^\]]+)\]\]/gu)) {
      const source = (match[1] ?? match[2] ?? '').split('|')[0]!.split('#')[0]!;
      const path = resolveVaultReference(notePath, source);
      if (path) referenced.add(pathKey(path));
    }
  }
  return attachments.filter((item) => !item.deletedAt && referenced.has(pathKey(item.path)));
}

/** A private target is never emitted as a public URL. */
export function resolvePublicTarget(target: string, targetId: string | null, source: PublicPage, pages: PublicPage[]): PublicPage | null {
  return resolveLinkTarget({ target, targetId }, { id: source.note_id, path: source.source_path },
    pages.map((page) => ({ ...page, id: page.note_id, path: page.source_path, deletedAt: null }))) ?? null;
}

export function publicHref(siteSlug: string, pageSlug: string, fragment?: string | null): string {
  const anchor = fragment?.startsWith('^') ? fragment.slice(1) : fragment ? headingSlug(fragment) : null;
  return `/p/${encodeURIComponent(siteSlug)}/${encodeURIComponent(pageSlug)}${anchor ? `#${encodeURIComponent(anchor)}` : ''}`;
}

export function outgoingPublicLinks(source: PublicPage, pages: PublicPage[]): PublicPage[] {
  const result = new Map<string, PublicPage>();
  for (const link of parseInternalLinks(source.markdown)) {
    if (link.kind === 'embed' && /\.(?:png|jpe?g|gif|webp|avif)$/iu.test(link.target)) continue;
    const page = resolvePublicTarget(link.target, link.targetId, source, pages);
    if (page && page.note_id !== source.note_id) result.set(page.note_id, page);
  }
  return [...result.values()];
}

export function publicWikiTarget(destination: string, source: PublicPage, pages: PublicPage[]): { page: PublicPage; fragment: string | null } | null {
  if (!destination.startsWith('#noor-wiki-')) return null;
  const [raw, stableId] = destination.slice('#noor-wiki-'.length).split('&noor-id=', 2);
  let decoded: string;
  try { decoded = decodeURIComponent(raw ?? ''); } catch { return null; }
  const reference = parseWikiReference(decoded);
  if (!reference) return null;
  const page = resolvePublicTarget(reference.target, stableId ?? null, source, pages);
  return page ? { page, fragment: reference.heading ?? reference.blockId } : null;
}

export function publicMarkdownTarget(destination: string, source: PublicPage, pages: PublicPage[]): { page: PublicPage; fragment: string | null } | null {
  if (!destination.startsWith('#') && !/\.md(?:#|$)/iu.test(destination)) return null;
  const [path, fragment] = destination.split('#', 2);
  const target = path ? resolveVaultReference(source.source_path, path) ?? path : '';
  const page = resolvePublicTarget(target, null, source, pages);
  return page ? { page, fragment: fragment ?? null } : null;
}
