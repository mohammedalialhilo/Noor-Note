import { stringify } from 'yaml';
import { z } from 'zod';

const webUrl = z.url().refine((value) => /^https?:\/\//iu.test(value), 'Use an HTTP(S) URL');
export const clipModeSchema = z.enum(['article', 'selection', 'bookmark', 'image', 'screenshot', 'highlight', 'highlights']);
export const clipHighlightSchema = z.object({
  id: z.uuid(), text: z.string().trim().min(1).max(10_000), capturedAt: z.iso.datetime({ offset: true }),
}).strict();
export const webClipSchema = z.object({
  version: z.literal(1), mode: clipModeSchema,
  url: webUrl, title: z.string().trim().min(1).max(300),
  author: z.string().max(300).nullable(), publishedAt: z.string().max(100).nullable(),
  site: z.string().max(200).nullable(), description: z.string().max(2000).nullable(),
  language: z.string().max(50).nullable(), mainImage: webUrl.nullable(), favicon: webUrl.nullable(),
  schemaType: z.string().max(120).nullable(),
  markdown: z.string().max(500_000), imageUrl: webUrl.nullable(),
  highlights: z.array(clipHighlightSchema).max(50),
  screenshotDataUrl: z.string().max(5_000_000).regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/u).nullable(),
  capturedAt: z.iso.datetime({ offset: true }),
}).strict();
export type WebClip = z.infer<typeof webClipSchema>;
export type ClipMode = z.infer<typeof clipModeSchema>;
const markdownUrl = (value: string): string => value.replaceAll('(', '%28').replaceAll(')', '%29');

export function clipContent(clip: WebClip, screenshotLink?: string): string {
  const parsed = webClipSchema.parse(clip);
  const quote = (value: string) => value.trim().split(/\r?\n/u).map((line) => `> ${line}`).join('\n');
  let body: string;
  switch (parsed.mode) {
    case 'article': body = parsed.markdown.trim(); break;
    case 'selection':
    case 'highlight': body = quote(parsed.markdown); break;
    case 'highlights': body = parsed.highlights.map((item, index) => `### Highlight ${index + 1}\n\n${quote(item.text)}`).join('\n\n'); break;
    case 'bookmark': body = parsed.description?.trim() || ''; break;
    case 'image': body = parsed.imageUrl ? `![${parsed.title.replaceAll('[', '\\[').replaceAll(']', '\\]')}](${markdownUrl(parsed.imageUrl)})` : ''; break;
    case 'screenshot': body = screenshotLink ?? ''; break;
  }
  return body.trim();
}

export function clipProvenance(clip: WebClip): string {
  const parsed = webClipSchema.parse(clip);
  const source = `[${parsed.title.replaceAll('[', '\\[').replaceAll(']', '\\]')}](${markdownUrl(parsed.url)})`;
  return `Source: ${source}\nCaptured: ${parsed.capturedAt}`;
}

export function clipBody(clip: WebClip, screenshotLink?: string): string {
  return `${clipContent(clip, screenshotLink)}\n\n${clipProvenance(clip)}\n`.trimStart();
}

export function clipMetadata(clip: WebClip, tags: string[], properties: Record<string, string>): Record<string, string | string[]> {
  const parsed = webClipSchema.parse(clip);
  const fields: Record<string, string | string[]> = {
    source: parsed.url, clipped_at: parsed.capturedAt, clip_mode: parsed.mode,
  };
  if (parsed.author) fields.author = parsed.author;
  if (parsed.publishedAt) fields.published = parsed.publishedAt;
  if (parsed.site) fields.site = parsed.site;
  if (parsed.description) fields.description = parsed.description;
  if (parsed.language) fields.language = parsed.language;
  if (parsed.mainImage) fields.image = parsed.mainImage;
  if (parsed.favicon) fields.favicon = parsed.favicon;
  if (parsed.schemaType) fields.schema_type = parsed.schemaType;
  const cleanTags = [...new Set(tags.map((tag) => tag.trim().replace(/^#/u, '')).filter(Boolean))];
  if (cleanTags.some((tag) => !/^[\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*$/u.test(tag))) throw new Error('Tags may contain letters, numbers, underscores, hyphens, and nested slashes.');
  if (cleanTags.length) fields.tags = cleanTags;
  for (const [key, value] of Object.entries(properties)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,79}$/u.test(key) || key === '__proto__' || key === 'constructor' || key === 'prototype') throw new Error(`Invalid property name: ${key}`);
    if (key in fields) throw new Error(`Property ${key} is reserved for clip metadata`);
    if (value.length > 2_000) throw new Error(`Property ${key} is too long`);
    fields[key] = value;
  }
  return fields;
}

export function clipFrontmatter(clip: WebClip, tags: string[], properties: Record<string, string>): string {
  return `---\n${stringify(clipMetadata(clip, tags, properties)).trimEnd()}\n---\n\n`;
}
