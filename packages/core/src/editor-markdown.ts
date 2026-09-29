import { stripFrontmatter } from './vault-note';

export interface OutlineHeading { id: string; text: string; level: number; line: number; offset: number }
export interface WikiReference { raw: string; target: string; alias: string | null; heading: string | null; blockId: string | null; embed: boolean; line: number }
export interface DocumentStats { words: number; characters: number; readingMinutes: number; lines: number }

const fencePattern = /^[ \t]{0,3}(`{3,}|~{3,})/u;
const wikiPattern = /(!?)\[\[([^\n]+?)\]\]/gu;

function visibleLines(markdown: string): { text: string; line: number; offset: number }[] {
  const result: { text: string; line: number; offset: number }[] = [];
  let fence: { marker: string; length: number } | null = null;
  let offset = 0;
  markdown.split('\n').forEach((text, index) => {
    const marker = text.match(fencePattern)?.[1];
    if (marker) {
      if (!fence) fence = { marker: marker[0]!, length: marker.length };
      else if (marker[0] === fence.marker && marker.length >= fence.length) fence = null;
    } else if (!fence) result.push({ text, line: index + 1, offset });
    offset += text.length + 1;
  });
  return result;
}

export function headingSlug(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase().replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/gu, '-');
}

export function parseOutline(markdown: string): OutlineHeading[] {
  const visible = visibleLines(markdown);
  const headings: OutlineHeading[] = [];
  const duplicates = new Map<string, number>();
  for (let index = 0; index < visible.length; index += 1) {
    const item = visible[index]!;
    if (item.line === 1 && /^---[ \t]*$/u.test(item.text)) {
      const close = visible.find((candidate) => candidate.line > 1 && /^---[ \t]*$/u.test(candidate.text));
      if (close) { index = visible.findIndex((candidate) => candidate.line === close.line); continue; }
    }
    const atx = item.text.match(/^[ \t]{0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/u);
    const underline = visible[index + 1]?.line === item.line + 1 ? visible[index + 1]!.text.match(/^[ \t]{0,3}(=+|-+)[ \t]*$/u) : null;
    if (!atx && !underline) continue;
    const text = (atx?.[2] ?? item.text).trim();
    if (!text) continue;
    const level = atx ? atx[1]!.length : underline?.[1]?.startsWith('=') ? 1 : 2;
    const base = headingSlug(text) || 'heading';
    const count = duplicates.get(base) ?? 0;
    duplicates.set(base, count + 1);
    headings.push({ id: count ? `${base}-${count}` : base, text, level, line: item.line, offset: item.offset });
    if (underline) index += 1;
  }
  return headings;
}

export function parseWikiReference(raw: string, embed = false, line = 1): WikiReference | null {
  const aliasAt = raw.indexOf('|');
  const locator = (aliasAt >= 0 ? raw.slice(0, aliasAt) : raw).trim();
  const alias = aliasAt >= 0 ? raw.slice(aliasAt + 1).trim() || null : null;
  const headingAt = locator.indexOf('#');
  const blockAt = locator.indexOf('^');
  const cut = [headingAt, blockAt].filter((value) => value >= 0).sort((a, b) => a - b)[0] ?? locator.length;
  const target = locator.slice(0, cut).trim();
  if (!target) return null;
  return {
    raw, target, alias,
    heading: headingAt >= 0 && headingAt === cut ? locator.slice(headingAt + 1).trim() || null : null,
    blockId: blockAt >= 0 && blockAt === cut ? locator.slice(blockAt + 1).trim() || null : null,
    embed, line,
  };
}

export function extractWikiReferences(markdown: string): WikiReference[] {
  const references: WikiReference[] = [];
  for (const item of visibleLines(markdown)) {
    const text = item.text.replace(/(`+)([\s\S]*?)\1/gu, (match) => ' '.repeat(match.length));
    for (const match of text.matchAll(wikiPattern)) {
      const reference = parseWikiReference(match[2] ?? '', Boolean(match[1]), item.line);
      if (reference) references.push(reference);
    }
  }
  return references;
}

export function documentStats(markdown: string): DocumentStats {
  const body = stripFrontmatter(markdown);
  const words = body.match(/[\p{L}\p{N}]+(?:['’_-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
  return { words, characters: body.length, readingMinutes: words ? Math.max(1, Math.ceil(words / 225)) : 0, lines: markdown.split('\n').length };
}

/** Expand whole-line note embeds in a display copy, leaving code fences untouched. */
export function expandNoteEmbeds(markdown: string, embeds: ReadonlyMap<string, string>): string {
  let fence: { marker: string; length: number } | null = null;
  return stripFrontmatter(markdown).split('\n').map((line) => {
    const marker = line.match(fencePattern)?.[1];
    if (marker) {
      if (!fence) fence = { marker: marker[0]!, length: marker.length };
      else if (marker[0] === fence.marker && marker.length >= fence.length) fence = null;
      return line;
    }
    if (fence) return line;
    const match = line.match(/^[ \t]*!\[\[([^\n]+?)\]\](?:<!-- noor-note-id:[0-9a-f-]{36} -->)?[ \t]*$/iu);
    if (!match) return line;
    const body = embeds.get(match[1]!);
    if (!body) return line;
    return `> **Embedded: ${match[1]}**\n>\n${stripFrontmatter(body).split('\n').map((part) => `> ${part}`).join('\n')}`;
  }).join('\n');
}

/** Produce a display copy only. The caller must retain the original Markdown as its source. */
export function prepareReadingMarkdown(markdown: string): string {
  let fence: { marker: string; length: number } | null = null;
  return stripFrontmatter(markdown).split('\n').map((line) => {
    const marker = line.match(fencePattern)?.[1];
    if (marker) {
      if (!fence) fence = { marker: marker[0]!, length: marker.length };
      else if (marker[0] === fence.marker && marker.length >= fence.length) fence = null;
      return line;
    }
    if (fence) return line;
    const callout = line.match(/^(\s*>\s*)\[!([A-Za-z][A-Za-z0-9_-]*)\]([+-]?)[ \t]*(.*)$/u);
    let display = callout ? `${callout[1]}**${callout[2]}${callout[4] ? ` · ${callout[4]}` : ''}**` : line;
    display = display.replace(/(`+)([\s\S]*?)\1|(!?)\[\[([^\n]+?)\]\](?:<!-- noor-note-id:([0-9a-f-]{36}) -->)?|==([^=\n]+)==/giu, (match, ticks: string | undefined, _code: string | undefined, bang: string | undefined, raw: string | undefined, stableId: string | undefined, highlight: string | undefined) => {
      if (ticks) return match;
      if (highlight) return `[${highlight}](#noor-highlight)`;
      const reference = parseWikiReference(raw ?? '', Boolean(bang));
      if (!reference) return match;
      if (reference.embed && /\.(?:png|jpe?g|gif|webp|svg|avif)$/iu.test(reference.target)) return `![${reference.alias ?? reference.target}](${reference.target})`;
      const encoded = `${encodeURIComponent(raw ?? '')}${stableId ? `&noor-id=${stableId}` : ''}`;
      const label = reference.alias ?? reference.target;
      return reference.embed ? `![${label}](#noor-embed-${encoded})` : `[${label}](#noor-wiki-${encoded})`;
    });
    return display;
  }).join('\n');
}
