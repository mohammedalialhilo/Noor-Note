import type { VaultNote } from './vault-domain';
import { headingSlug, parseOutline, parseWikiReference } from './editor-markdown';
import { safeFileStem } from './vault-domain';
import { resolveVaultReference } from './vault-note';

export type LinkStatus = 'resolved' | 'missing' | 'ambiguous' | 'heading-missing' | 'block-missing' | 'attachment';
export interface InternalLink {
  kind: 'wiki' | 'markdown' | 'embed';
  raw: string;
  target: string;
  targetId: string | null;
  alias: string | null;
  heading: string | null;
  blockId: string | null;
  line: number;
  start: number;
  end: number;
  headingContext: string | null;
  preview: string;
}
export interface ResolvedLink extends InternalLink { status: LinkStatus; noteId: string | null }
export interface LinkOccurrence { sourceNoteId: string; sourceTitle: string; link: ResolvedLink }
export interface UnlinkedMention { sourceNoteId: string; sourceTitle: string; targetNoteId: string; text: string; start: number; end: number; line: number; headingContext: string | null; preview: string }
export interface RenameChange { noteId: string; title: string; path: string; before: string; after: string; count: number; revision: number }

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const wiki = new RegExp(`(!?)\\[\\[([^\\]\\n]+)\\]\\](?:<!-- noor-note-id:(${uuid}) -->)?`, 'giu');
const markdownLink = new RegExp(`(!?)\\[([^\\]\\n]+)\\]\\(([^)\\s]+)\\)(?:<!-- noor-note-id:(${uuid}) -->)?`, 'giu');
const blockIdPattern = /(?:^|\s)\^([A-Za-z0-9][A-Za-z0-9_-]{0,100})\s*$/u;
const fencePattern = /^[ \t]{0,3}(`{3,}|~{3,})/u;

function pathName(path: string): string { return path.replace(/^\/+|\/+$/gu, '').replace(/\.md$/iu, '').normalize('NFKC').toLocaleLowerCase(); }
function noteNames(note: Pick<VaultNote, 'title' | 'path' | 'aliases'>): string[] { return [note.title, ...note.aliases, note.path.slice(note.path.lastIndexOf('/') + 1).replace(/\.md$/iu, '')].filter(Boolean).map(pathName); }
function linePreview(line: string): string { return line.trim().slice(0, 220); }
function maskedCode(line: string): string { return line.replace(/(`+)(.*?)\1/gu, (match) => ' '.repeat(match.length)); }

/** Parses local links with source offsets. External URLs and fenced or inline code are excluded. */
export function parseInternalLinks(markdown: string): InternalLink[] {
  const result: InternalLink[] = [];
  const headings = parseOutline(markdown);
  let offset = 0;
  let fence: { marker: string; length: number } | null = null;
  let frontmatter = markdown.startsWith('---\n');
  markdown.split('\n').forEach((line, index) => {
    const lineNo = index + 1;
    if (frontmatter) { if (index > 0 && /^---[ \t]*$/u.test(line)) frontmatter = false; offset += line.length + 1; return; }
    const marker = line.match(fencePattern)?.[1];
    if (marker) {
      if (!fence) fence = { marker: marker[0]!, length: marker.length };
      else if (marker[0] === fence.marker && marker.length >= fence.length) fence = null;
      offset += line.length + 1; return;
    }
    if (fence) { offset += line.length + 1; return; }
    const text = maskedCode(line);
    const context = headings.filter((heading) => heading.line <= lineNo).at(-1)?.text ?? null;
    const spans: [number, number][] = [];
    for (const match of text.matchAll(wiki)) {
      const parsed = parseWikiReference(match[2] ?? '', Boolean(match[1]), lineNo);
      if (!parsed) continue;
      const start = match.index ?? 0;
      const end = start + match[0].length;
      spans.push([start, end]);
      result.push({ kind: parsed.embed ? 'embed' : 'wiki', raw: line.slice(start, end), target: parsed.target, targetId: match[3] ?? null, alias: parsed.alias, heading: parsed.heading, blockId: parsed.blockId, line: lineNo, start: offset + start, end: offset + end, headingContext: context, preview: linePreview(line) });
    }
    for (const match of text.matchAll(markdownLink)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (spans.some(([from, to]) => start < to && end > from)) continue;
      const destination = match[3] ?? '';
      if (!match[4] && !destination.startsWith('#') && !destination.startsWith('noor-note://') && !/\.md(?:#|$)/iu.test(destination)) continue;
      const [path, fragment] = destination.replace(/^noor-note:\/\//u, '').split('#', 2);
      const target = destination.startsWith('#') ? '' : path ?? '';
      result.push({ kind: match[1] ? 'embed' : 'markdown', raw: line.slice(start, end), target, targetId: match[4] ?? (destination.startsWith('noor-note://') && new RegExp(`^${uuid}$`, 'iu').test(target) ? target : null), alias: match[2] ?? null, heading: fragment || null, blockId: fragment?.startsWith('^') ? fragment.slice(1) : null, line: lineNo, start: offset + start, end: offset + end, headingContext: context, preview: linePreview(line) });
    }
    offset += line.length + 1;
  });
  return result.sort((a, b) => a.start - b.start);
}

export function parseBlocks(markdown: string): { id: string; line: number; text: string }[] {
  const blocks: { id: string; line: number; text: string }[] = [];
  let fence: string | null = null;
  markdown.split('\n').forEach((line, index) => {
    const marker = line.match(fencePattern)?.[1];
    if (marker) { if (!fence) fence = marker[0]!; else if (marker[0] === fence) fence = null; return; }
    if (fence) return;
    const match = line.match(blockIdPattern);
    if (match) blocks.push({ id: match[1]!, line: index + 1, text: line.replace(blockIdPattern, '').trim() });
  });
  return blocks;
}

export function ensureBlockId(markdown: string, line: number, id = `b-${crypto.randomUUID()}`): { markdown: string; id: string } {
  const lines = markdown.split('\n');
  const index = line - 1;
  if (index < 0 || index >= lines.length || !lines[index]?.trim()) throw new Error('Select a nonempty block');
  let fence: string | null = null;
  for (let cursor = 0; cursor <= index; cursor += 1) {
    const marker = lines[cursor]?.match(fencePattern)?.[1];
    if (marker) { if (!fence) fence = marker[0]!; else if (marker[0] === fence) fence = null; if (cursor === index) throw new Error('Select a Markdown block outside code'); }
  }
  if (fence) throw new Error('Select a Markdown block outside code');
  const existing = lines[index]!.match(blockIdPattern)?.[1];
  if (existing) return { markdown, id: existing };
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,100}$/u.test(id)) throw new Error('Invalid block ID');
  lines[index] = `${lines[index]!.trimEnd()} ^${id}`;
  return { markdown: lines.join('\n'), id };
}

function candidates<T extends Pick<VaultNote, 'id' | 'path' | 'title' | 'aliases'>>(target: string, source: Pick<VaultNote, 'id' | 'path'>, notes: T[]): T[] {
  if (!target) return notes.filter((note) => note.id === source.id);
  const normalized = pathName(target);
  if (/\.md$/iu.test(target)) {
    const absolute = resolveVaultReference(source.path, target);
    if (absolute) {
      const exact = notes.filter((note) => pathName(note.path) === pathName(absolute));
      if (exact.length) return exact;
    }
  }
  if (target.startsWith('./') || target.startsWith('../') || target.startsWith('/')) {
    const absolute = resolveVaultReference(source.path, target);
    if (absolute) return notes.filter((note) => pathName(note.path) === pathName(absolute));
  }
  const byPath = notes.filter((note) => pathName(note.path) === normalized || pathName(note.path).endsWith(`/${normalized}`));
  if (target.includes('/')) return byPath;
  const sameFolder = notes.filter((note) => note.path.slice(0, note.path.lastIndexOf('/')) === source.path.slice(0, source.path.lastIndexOf('/')) && noteNames(note).includes(normalized));
  if (sameFolder.length) return sameFolder;
  const byTitle = notes.filter((note) => pathName(note.title) === normalized);
  if (byTitle.length) return byTitle;
  return notes.filter((note) => noteNames(note).includes(normalized));
}

/** Resolve identity from metadata alone; validation of heading and block targets needs note bodies. */
export function resolveLinkTarget<T extends Pick<VaultNote, 'id' | 'path' | 'title' | 'aliases' | 'deletedAt'>>(link: Pick<InternalLink, 'target' | 'targetId'>, source: Pick<VaultNote, 'id' | 'path'>, notes: T[]): T | null {
  const available = notes.filter((note) => !note.deletedAt);
  const matches = link.targetId ? available.filter((note) => note.id === link.targetId) : candidates(link.target, source, available);
  return matches.length === 1 ? matches[0]! : null;
}

export function resolveInternalLink(link: InternalLink, source: Pick<VaultNote, 'id' | 'path'>, notes: VaultNote[]): ResolvedLink {
  if (link.kind === 'embed' && /\.(?:png|jpe?g|gif|webp|svg|avif|pdf|mp3|wav|ogg|mp4|webm|mov)$/iu.test(link.target)) return { ...link, status: 'attachment', noteId: null };
  const available = notes.filter((note) => !note.deletedAt);
  const matches = link.targetId ? available.filter((note) => note.id === link.targetId) : candidates(link.target, source, available);
  if (matches.length !== 1) return { ...link, status: matches.length ? 'ambiguous' : 'missing', noteId: null };
  const note = matches[0]!;
  const requestedHeading = link.heading;
  if (requestedHeading && !link.blockId && !parseOutline(note.markdown).some((heading) => heading.id === headingSlug(requestedHeading) || headingSlug(heading.text) === headingSlug(requestedHeading))) return { ...link, status: 'heading-missing', noteId: note.id };
  if (link.blockId && !parseBlocks(note.markdown).some((block) => block.id === link.blockId)) return { ...link, status: 'block-missing', noteId: note.id };
  return { ...link, status: 'resolved', noteId: note.id };
}

export function scanLinks(notes: VaultNote[]): LinkOccurrence[] {
  return notes.filter((note) => !note.deletedAt).flatMap((source) => parseInternalLinks(source.markdown).map((link) => ({ sourceNoteId: source.id, sourceTitle: source.title, link: resolveInternalLink(link, source, notes) })));
}

export function findUnlinkedMentions(notes: VaultNote[], target: VaultNote): UnlinkedMention[] {
  const names = [...new Set([target.title, ...target.aliases].filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!names.length) return [];
  const results: UnlinkedMention[] = [];
  for (const source of notes.filter((note) => !note.deletedAt && note.id !== target.id)) {
    const linked = parseInternalLinks(source.markdown);
    const headings = parseOutline(source.markdown);
    let offset = 0;
    let fence: string | null = null;
    let frontmatter = source.markdown.startsWith('---\n');
    source.markdown.split('\n').forEach((line, index) => {
      if (frontmatter) { if (index > 0 && /^---[ \t]*$/u.test(line)) frontmatter = false; offset += line.length + 1; return; }
      const marker = line.match(fencePattern)?.[1];
      if (marker) { if (!fence) fence = marker[0]!; else if (marker[0] === fence) fence = null; offset += line.length + 1; return; }
      if (!fence) {
        const visible = maskedCode(line);
        for (const name of names) {
          let start = 0;
          while ((start = visible.toLocaleLowerCase().indexOf(name.toLocaleLowerCase(), start)) >= 0) {
            const end = start + name.length;
            const left = visible[start - 1] ?? '';
            const right = visible[end] ?? '';
            if (!/[\p{L}\p{N}_]/u.test(left) && !/[\p{L}\p{N}_]/u.test(right) && !linked.some((link) => offset + start < link.end && offset + end > link.start) && !results.some((item) => item.sourceNoteId === source.id && item.start === offset + start)) {
              results.push({ sourceNoteId: source.id, sourceTitle: source.title, targetNoteId: target.id, text: line.slice(start, end), start: offset + start, end: offset + end, line: index + 1, headingContext: headings.filter((heading) => heading.line <= index + 1).at(-1)?.text ?? null, preview: linePreview(line) });
            }
            start = end;
          }
        }
      }
      offset += line.length + 1;
    });
  }
  return results;
}

export function replaceMention(markdown: string, mention: Pick<UnlinkedMention, 'start' | 'end' | 'text'>, target: VaultNote): string {
  if (markdown.slice(mention.start, mention.end) !== mention.text) throw new Error('Mention moved. Refresh links before converting.');
  return `${markdown.slice(0, mention.start)}[[${target.title}|${mention.text}]]<!-- noor-note-id:${target.id} -->${markdown.slice(mention.end)}`;
}

/** Returns a preview; callers must explicitly confirm before applying changes. */
export function planLinkRename(notes: VaultNote[], target: VaultNote, newTitle: string): RenameChange[] {
  if (!newTitle.trim() || ['[', ']', '|', '#', '^', '\r', '\n'].some((character) => newTitle.includes(character))) throw new Error('This title cannot be represented as a wiki link target');
  const changes: RenameChange[] = [];
  for (const source of notes.filter((note) => !note.deletedAt)) {
    const links = parseInternalLinks(source.markdown).filter((link) => resolveInternalLink(link, source, notes).noteId === target.id);
    if (!links.length) continue;
    let after = source.markdown;
    let count = 0;
    for (const link of links.reverse()) {
      if (link.kind === 'markdown') {
        const readable = link.raw.match(/^(!?)\[([^\]]+)\]\(([^)]+)\)(<!-- noor-note-id:[0-9a-f-]{36} -->)?$/iu);
        if (!readable) continue;
        const oldDestination = readable[3]!;
        const newDestination = /\.md(?:#|$)/iu.test(oldDestination)
          ? oldDestination.replace(/[^/#]+\.md(?=#|$)/iu, `${safeFileStem(newTitle)}.md`)
          : oldDestination;
        const newLabel = readable[2] === target.title ? newTitle : readable[2]!;
        const replacement = `${readable[1]}[${newLabel}](${newDestination})${readable[4] ?? ''}`;
        if (replacement === link.raw) continue;
        after = `${after.slice(0, link.start)}${replacement}${after.slice(link.end)}`;
        count += 1;
        continue;
      }
      const parsed = parseWikiReference(link.raw.replace(/^!?\[\[/u, '').replace(/\]\](?:<!--.*-->)?$/u, ''));
      if (!parsed) continue;
      const suffix = parsed.heading ? `#${parsed.heading}` : parsed.blockId ? `^${parsed.blockId}` : '';
      const label = parsed.alias ? `|${parsed.alias}` : '';
      const annotation = link.targetId ? `<!-- noor-note-id:${link.targetId} -->` : '';
      const prefix = parsed.target.includes('/') ? `${parsed.target.slice(0, parsed.target.lastIndexOf('/') + 1)}` : '';
      const replacement = `${link.kind === 'embed' ? '!' : ''}[[${prefix}${newTitle}${suffix}${label}]]${annotation}`;
      if (replacement === link.raw) continue;
      after = `${after.slice(0, link.start)}${replacement}${after.slice(link.end)}`;
      count += 1;
    }
    if (count) changes.push({ noteId: source.id, title: source.title, path: source.path, before: source.markdown, after, count, revision: source.revision });
  }
  return changes;
}

export function fuzzyNotes<T extends Pick<VaultNote, 'title' | 'aliases' | 'deletedAt'>>(query: string, notes: T[]): T[] {
  const needle = query.normalize('NFKC').toLocaleLowerCase().trim();
  const score = (name: string) => {
    const text = name.normalize('NFKC').toLocaleLowerCase();
    if (!needle) return 1;
    if (text === needle) return 100;
    if (text.startsWith(needle)) return 80;
    if (text.includes(needle)) return 60;
    let position = 0;
    for (const letter of needle) { position = text.indexOf(letter, position); if (position < 0) return 0; position += 1; }
    return 20;
  };
  return notes.filter((note) => !note.deletedAt).map((note) => ({ note, rank: Math.max(score(note.title), ...note.aliases.map(score)) })).filter(({ rank }) => rank > 0).sort((a, b) => b.rank - a.rank || a.note.title.localeCompare(b.note.title)).slice(0, 12).map(({ note }) => note);
}
