import { extractTags, inspectMetadata, isPdfAttachment, parseInternalLinks, parseOutline, parseTasks, type Attachment, type OcrRecord, type Transcript, type VaultNote } from '@noor-note/core';
import { z } from 'zod';

export const searchSortSchema = z.enum(['relevance', 'updated', 'created', 'title']);
export type SearchSort = z.infer<typeof searchSortSchema>;
export interface SearchDocument {
  id: string; vaultId: string; revision: number; title: string; path: string; markdown: string;
  kind?: 'note' | 'ocr' | 'transcript'; attachmentId?: string; page?: number; timeMs?: number;
  tags: string[]; properties: Record<string, unknown>; links: string[]; tasks: string[];
  headings: string[]; createdAt: string; updatedAt: string; hasAttachment: boolean;
  derivedText?: { ocr?: string[]; pdfAnnotations?: string[]; transcripts?: string[] };
}
export interface SearchResult {
  id: string; title: string; path: string; excerpt: string; highlights: { start: number; end: number }[];
  kind: 'note' | 'ocr' | 'transcript'; attachmentId?: string; page?: number; timeMs?: number;
  properties: { name: string; value: string }[]; score: number; updatedAt: string;
  similarity?: number; heading?: string; blockId?: string; from?: number; to?: number; line?: number;
}
type Clause = { kind: 'term' | 'phrase' | 'prefix' | 'fuzzy' | 'field' | 'before' | 'after' | 'has' | 'is' | 'regex'; value: string; field?: string };
export interface ParsedSearch { clauses: Clause[]; sort: SearchSort }
const fold = (value: string) => value.normalize('NFKC').toLocaleLowerCase();
const words = (value: string) => fold(value).match(/[\p{L}\p{N}_-]+/gu) ?? [];
const bodyText = (markdown: string) => markdown.replace(/^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/u, '').replace(/```[\s\S]*?```/gu, ' ').replace(/[`*_>#]/gu, ' ').replaceAll('[', ' ').replaceAll(']', ' ').replace(/\s+/gu, ' ').trim();

export function makeSearchDocument(note: VaultNote): SearchDocument {
  let properties: Record<string, unknown> = note.properties;
  try { properties = { ...note.properties, ...inspectMetadata(note.markdown).values }; } catch { /* Source Mode retains invalid YAML. */ }
  const parsedLinks = parseInternalLinks(note.markdown);
  return {
    id: note.id, vaultId: note.vaultId, revision: note.revision, title: note.title, path: note.path, markdown: note.markdown,
    tags: extractTags(note.markdown), properties,
    links: parsedLinks.map((link) => link.target),
    tasks: parseTasks(note.markdown).map((task) => `${task.completed ? 'completed' : 'incomplete'} ${task.text}`),
    headings: parseOutline(note.markdown).map((heading) => heading.text),
    createdAt: note.createdAt, updatedAt: note.updatedAt,
    hasAttachment: parsedLinks.some((link) => link.kind === 'embed' && /\.[\p{L}\p{N}]{1,12}$/u.test(link.target) && !/\.md$/iu.test(link.target)) || /!\[[^\]]*\]\((?!https?:\/\/)[^)]+\)/iu.test(note.markdown),
  };
}

export function makeOcrSearchDocument(record: OcrRecord, attachment: Attachment): SearchDocument {
  return {
    id: record.id, vaultId: record.vaultId, revision: Date.parse(record.updatedAt), kind: 'ocr',
    attachmentId: record.attachmentId, page: record.page, title: `${attachment.name}${isPdfAttachment(attachment) ? `, page ${record.page}` : ''}`,
    path: attachment.path, markdown: '', tags: [], properties: { ocrLanguages: record.languages.join(', ') }, links: [], tasks: [], headings: [],
    createdAt: record.createdAt, updatedAt: record.updatedAt, hasAttachment: true, derivedText: { ocr: [record.text] },
  };
}

export function makeTranscriptSearchDocuments(record: Transcript, attachment: Attachment): SearchDocument[] {
  return record.segments.map((segment) => ({
    id: segment.id, vaultId: record.vaultId, revision: Date.parse(record.updatedAt), kind: 'transcript' as const,
    attachmentId: record.attachmentId, timeMs: segment.startMs,
    title: `Transcript: ${attachment.name}`, path: attachment.path, markdown: '', tags: [],
    properties: { transcriptProvider: record.providerId, ...(record.language ? { transcriptLanguage: record.language } : {}) },
    links: [], tasks: [], headings: [], createdAt: record.createdAt, updatedAt: record.updatedAt,
    hasAttachment: true, derivedText: { transcripts: [segment.text, segment.speaker ?? ''] },
  }));
}

function unquote(value: string): string {
  if (value.startsWith('"')) {
    if (!value.endsWith('"') || value.length < 2) throw new Error('Close the quoted search phrase');
    return value.slice(1, -1).replace(/\\"/gu, '"');
  }
  return value;
}

export function parseSearchQuery(input: string): ParsedSearch {
  if (input.length > 1_000) throw new Error('Search query is too long');
  if (((input.match(/(?<!\\)"/gu) ?? []).length % 2) !== 0) throw new Error('Close the quoted search phrase');
  const clauses: Clause[] = [];
  let sort: SearchSort = 'relevance';
  const tokens = input.match(/(?:[^\s"]|"(?:\\.|[^"])*")+/gu) ?? [];
  for (const token of tokens) {
    const separator = token.indexOf(':');
    const equals = token.indexOf('=');
    if (token.startsWith('regex:/')) {
      const source = token.slice(7, token.endsWith('/') ? -1 : undefined);
      if (!token.endsWith('/') || !source || source.length > 120 || /\([^)]*[+*][^)]*\)[+*{]/u.test(source)) throw new Error('Invalid or overly complex regex');
      try { new RegExp(source, 'iu'); } catch { throw new Error('Invalid regex pattern'); }
      clauses.push({ kind: 'regex', value: source }); continue;
    }
    if (separator > 0 || token.startsWith('property=')) {
      const field = token.startsWith('property=') ? 'propertyExact' : token.slice(0, separator).toLocaleLowerCase();
      const value = unquote(token.slice(token.startsWith('property=') ? equals + 1 : separator + 1));
      if (!value) throw new Error(`Enter a value for ${field}`);
      if (field === 'sort') { const parsed = searchSortSchema.safeParse(value); if (!parsed.success) throw new Error(`Unknown sort: ${value}`); sort = parsed.data; continue; }
      if (field === 'before' || field === 'after') {
        const parsedDate = Date.parse(`${value}T00:00:00Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || !Number.isFinite(parsedDate) || new Date(parsedDate).toISOString().slice(0, 10) !== value) throw new Error(`Enter a valid ${field} date`);
        clauses.push({ kind: field, value }); continue;
      }
      if (field === 'has') {
        if (!['tag', 'property', 'link', 'task', 'heading', 'attachment', 'ocr', 'transcript'].includes(value)) throw new Error(`Unknown has filter: ${value}`);
        clauses.push({ kind: 'has', value }); continue;
      }
      if (field === 'is') {
        if (!['completed', 'incomplete', 'empty'].includes(value)) throw new Error(`Unknown is filter: ${value}`);
        clauses.push({ kind: 'is', value }); continue;
      }
      if (['tag', 'path', 'title', 'status', 'property', 'propertyExact', 'links', 'task', 'heading'].includes(field) || field.startsWith('property.')) {
        clauses.push({ kind: 'field', field, value: fold(value.replace(/^#/u, '')) }); continue;
      }
      throw new Error(`Unknown search filter: ${field}`);
    }
    if (token.startsWith('"')) clauses.push({ kind: 'phrase', value: fold(unquote(token)) });
    else if (token.endsWith('*') && token.length > 1) clauses.push({ kind: 'prefix', value: fold(token.slice(0, -1)) });
    else if (token.endsWith('~') && token.length > 2) clauses.push({ kind: 'fuzzy', value: fold(token.slice(0, -1)) });
    else clauses.push({ kind: 'term', value: fold(token) });
  }
  return { clauses, sort };
}

function propertyStrings(properties: Record<string, unknown>): { name: string; value: string }[] {
  return Object.entries(properties).map(([name, value]) => ({ name, value: typeof value === 'string' ? value : JSON.stringify(value) ?? '' }));
}
function derivedText(document: SearchDocument): string[] { return Object.values(document.derivedText ?? {}).flatMap((items) => items ?? []); }
function distanceAtMostTwo(left: string, right: string): boolean {
  if (Math.abs(left.length - right.length) > 2) return false;
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let index = 1; index <= left.length; index += 1) {
    let previous = row[0]!; row[0] = index; let minimum = row[0]!;
    for (let cursor = 1; cursor <= right.length; cursor += 1) {
      const above = row[cursor]!;
      row[cursor] = Math.min(row[cursor]! + 1, row[cursor - 1]! + 1, previous + (left[index - 1] === right[cursor - 1] ? 0 : 1));
      previous = above; minimum = Math.min(minimum, row[cursor]!);
    }
    if (minimum > 2) return false;
  }
  return row[right.length]! <= (left.length <= 4 ? 1 : 2);
}

export class SearchEngine {
  private readonly documents = new Map<string, SearchDocument>();
  private readonly terms = new Map<string, Set<string>>();
  private readonly tokens = new Map<string, Set<string>>();
  get size(): number { return this.documents.size; }

  upsert(document: SearchDocument): void {
    this.remove(document.id);
    const derived = derivedText(document);
    const searchable = [document.title, document.path, document.markdown, document.tags.join(' '), document.links.join(' '), document.tasks.join(' '), document.headings.join(' '), ...derived, ...propertyStrings(document.properties).flatMap((item) => [item.name, item.value])].join(' ');
    const tokens = new Set(words(searchable));
    this.documents.set(document.id, document); this.tokens.set(document.id, tokens);
    for (const token of tokens) {
      let ids = this.terms.get(token);
      if (!ids) { ids = new Set(); this.terms.set(token, ids); }
      ids.add(document.id);
    }
  }
  remove(id: string): void {
    for (const token of this.tokens.get(id) ?? []) {
      const ids = this.terms.get(token);
      ids?.delete(id);
      if (!ids?.size) this.terms.delete(token);
    }
    this.tokens.delete(id); this.documents.delete(id);
  }
  clear(): void { this.documents.clear(); this.terms.clear(); this.tokens.clear(); }

  search(query: string, limit = 100): SearchResult[] {
    const parsed = parseSearchQuery(query);
    const terms = parsed.clauses.filter((clause) => clause.kind === 'term');
    let candidates: Set<string> | null = null;
    for (const term of terms) {
      const hits = this.terms.get(term.value) ?? new Set<string>();
      if (candidates === null) candidates = new Set(hits);
      else candidates = new Set(Array.from(candidates as Set<string>).filter((id: string) => hits.has(id)));
    }
    const results: SearchResult[] = [];
    for (const document of this.documents.values()) {
      if (candidates && !candidates.has(document.id)) continue;
      const content = fold(document.markdown);
      const title = fold(document.title);
      const path = fold(document.path);
      const properties = propertyStrings(document.properties);
      const all = fold([document.title, document.path, document.markdown, ...properties.flatMap((item) => [item.name, item.value]), ...document.tags, ...document.links, ...document.tasks, ...document.headings, ...derivedText(document)].join(' '));
      let score = 0;
      let matched = true;
      for (const clause of parsed.clauses) {
        const value = clause.value;
        if (clause.kind === 'before' || clause.kind === 'after') { if (clause.kind === 'before' ? document.updatedAt.slice(0, 10) >= value : document.updatedAt.slice(0, 10) <= value) matched = false; continue; }
        if (clause.kind === 'has') { if (!(clause.value === 'tag' ? document.tags.length : clause.value === 'property' ? properties.length : clause.value === 'link' ? document.links.length : clause.value === 'task' ? document.tasks.length : clause.value === 'heading' ? document.headings.length : clause.value === 'ocr' ? document.derivedText?.ocr?.length : clause.value === 'transcript' ? document.derivedText?.transcripts?.length : document.hasAttachment)) matched = false; continue; }
        if (clause.kind === 'is') { if (!(value === 'completed' ? document.tasks.some((task) => task.startsWith('completed ')) : value === 'incomplete' ? document.tasks.some((task) => task.startsWith('incomplete ')) : !bodyText(document.markdown) && !derivedText(document).some((item) => item.trim()))) matched = false; continue; }
        if (clause.kind === 'field') {
          const field = clause.field ?? '';
          const values = field === 'tag' ? document.tags : field === 'path' ? [document.path] : field === 'title' ? [document.title] : field === 'links' ? document.links : field === 'task' ? document.tasks : field === 'heading' ? document.headings : field === 'status' ? [String(document.properties.status ?? '')] : field.startsWith('property.') ? [String(document.properties[field.slice(9)] ?? '')] : properties.map((item) => item.value);
          if (!values.some((item) => field === 'propertyExact' ? fold(item) === value : field === 'tag' ? fold(item) === value || fold(item).startsWith(`${value}/`) : fold(item).includes(value))) matched = false; else score += 6;
          continue;
        }
        if (clause.kind === 'regex') { if (!new RegExp(value, 'iu').test(all)) matched = false; else score += 4; continue; }
        if (clause.kind === 'fuzzy') { if (![...this.tokens.get(document.id) ?? []].some((token) => distanceAtMostTwo(token, value))) matched = false; else score += 2; continue; }
        if (clause.kind === 'prefix') { if (![...this.tokens.get(document.id) ?? []].some((token) => token.startsWith(value))) matched = false; else score += 3; continue; }
        if (!all.includes(value)) matched = false;
        else score += (title.includes(value) ? 10 : 0) + (path.includes(value) ? 5 : 0) + (content.includes(value) ? 2 : 1) + (clause.kind === 'phrase' ? 3 : 0);
      }
      if (!matched) continue;
      const matchTerms = parsed.clauses.filter((clause) => ['term', 'phrase', 'prefix', 'fuzzy', 'field'].includes(clause.kind)).map((clause) => clause.value);
      const plain = bodyText(document.markdown);
      const source = [plain, document.title, document.path, ...properties.map((item) => `${item.name}: ${item.value}`), ...document.tags, ...derivedText(document)].find((item) => matchTerms.some((term) => fold(item).includes(term))) ?? plain;
      const position = matchTerms.map((term) => fold(source).indexOf(term)).find((index) => index >= 0) ?? -1;
      const start = Math.max(0, position - 60);
      const excerpt = source.slice(start, start + 180) || document.title;
      const highlights = matchTerms.flatMap((term) => {
        const index = fold(excerpt).indexOf(term);
        return index < 0 ? [] : [{ start: index, end: index + term.length }];
      });
      const matchedProperties = properties.filter((item) => matchTerms.some((term) => fold(item.name).includes(term) || fold(item.value).includes(term))).slice(0, 3);
      results.push({ id: document.id, title: document.title, path: document.path, excerpt, highlights, properties: matchedProperties, score, updatedAt: document.updatedAt, kind: document.kind ?? 'note', attachmentId: document.attachmentId, page: document.page, timeMs: document.timeMs });
    }
    results.sort((a, b) => parsed.sort === 'updated' ? b.updatedAt.localeCompare(a.updatedAt) : parsed.sort === 'created' ? (this.documents.get(b.id)?.createdAt ?? '').localeCompare(this.documents.get(a.id)?.createdAt ?? '') : parsed.sort === 'title' ? a.title.localeCompare(b.title) : b.score - a.score || b.updatedAt.localeCompare(a.updatedAt));
    return results.slice(0, Math.max(1, Math.min(limit, 500)));
  }
}
