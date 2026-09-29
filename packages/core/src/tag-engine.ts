import type { VaultNote } from './vault-domain';
import { inspectMetadata, updateFrontmatterProperty } from './metadata';

export interface TagReference { tag: string; start: number; end: number; line: number }
export interface TagChange { noteId: string; title: string; path: string; before: string; after: string; revision: number; count: number }
export interface TagNode { name: string; fullName: string; count: number; children: TagNode[] }
const tagPattern = /(?<![\p{L}\p{N}_/#])#([\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*)/gu;
const validTag = /^[\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*$/u;
const frontmatterPattern = /^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/u;
const fencePattern = /^[ \t]{0,3}(`{3,}|~{3,})/u;

export function normalizeTagName(name: string): string {
  const normalized = name.trim().replace(/^#/u, '');
  if (!validTag.test(normalized)) throw new Error('Tag names use letters, numbers, underscores, hyphens, and slashes');
  return normalized;
}

function yamlTags(markdown: string): string[] {
  try {
    const metadata = inspectMetadata(markdown);
    const value = metadata.values.tags;
    const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\s,]+/u) : [];
    const typed = Object.entries(metadata.types).filter(([key, type]) => key !== 'tags' && type === 'tag').flatMap(([key]) => {
      const tagged = metadata.values[key];
      return typeof tagged === 'string' ? [tagged] : [];
    });
    return [...items, ...typed].filter((item): item is string => typeof item === 'string').map((item) => item.replace(/^#/u, '')).filter((item) => validTag.test(item));
  } catch { return []; }
}

/** Finds inline hashtags outside frontmatter, fenced code, and inline code. */
export function scanInlineTags(markdown: string): TagReference[] {
  const references: TagReference[] = [];
  const frontmatterLength = markdown.match(frontmatterPattern)?.[0].length ?? 0;
  let fence: { marker: string; length: number } | null = null;
  let offset = 0;
  markdown.split('\n').forEach((line, index) => {
    if (offset < frontmatterLength) { offset += line.length + 1; return; }
    const marker = line.match(fencePattern)?.[1];
    if (marker) {
      if (!fence) fence = { marker: marker[0]!, length: marker.length };
      else if (marker[0] === fence.marker && marker.length >= fence.length) fence = null;
      offset += line.length + 1; return;
    }
    if (!fence) {
      const visible = line.replace(/(`+)(.*?)\1/gu, (match) => ' '.repeat(match.length));
      for (const match of visible.matchAll(tagPattern)) references.push({ tag: match[1]!, start: offset + (match.index ?? 0), end: offset + (match.index ?? 0) + match[0].length, line: index + 1 });
    }
    offset += line.length + 1;
  });
  return references;
}

export function extractAllTags(markdown: string): string[] {
  const unique = new Map<string, string>();
  for (const tag of [...yamlTags(markdown), ...scanInlineTags(markdown).map((reference) => reference.tag)]) {
    const key = tag.normalize('NFKC').toLocaleLowerCase();
    if (!unique.has(key)) unique.set(key, tag);
  }
  return [...unique.values()];
}

export function buildTagTree(notes: { tags: string[] }[]): TagNode[] {
  const counts = new Map<string, { name: string; count: number }>();
  for (const note of notes) {
    const used = new Set<string>();
    for (const tag of note.tags) {
      for (let level = 1; level <= tag.split('/').length; level += 1) {
        const label = tag.split('/').slice(0, level).join('/');
        const prefix = label.toLocaleLowerCase();
        if (used.has(prefix)) continue;
        used.add(prefix);
        const previous = counts.get(prefix);
        counts.set(prefix, { name: previous?.name ?? label, count: (previous?.count ?? 0) + 1 });
      }
    }
  }
  const make = (parent: string | null): TagNode[] => [...counts.entries()]
    .filter(([fullName]) => parent ? fullName.startsWith(`${parent}/`) && fullName.slice(parent.length + 1).indexOf('/') < 0 : !fullName.includes('/'))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([fullName, data]) => ({ name: data.name.split('/').at(-1)!, fullName: data.name, count: data.count, children: make(fullName) }));
  return make(null);
}

export function rewriteTag(markdown: string, from: string, to: string | null, includeChildren = false): { markdown: string; count: number } {
  const oldName = normalizeTagName(from);
  const newName = to === null ? null : normalizeTagName(to);
  const change = (tag: string): string | null | undefined => {
    if (tag.toLocaleLowerCase() === oldName.toLocaleLowerCase()) return newName;
    if (includeChildren && tag.toLocaleLowerCase().startsWith(`${oldName.toLocaleLowerCase()}/`)) return newName === null ? null : `${newName}${tag.slice(oldName.length)}`;
    return undefined;
  };
  let count = 0;
  let result = markdown;
  for (const reference of scanInlineTags(markdown).reverse()) {
    const replacement = change(reference.tag);
    if (replacement === undefined || replacement === reference.tag) continue;
    result = `${result.slice(0, reference.start)}${replacement === null ? '' : `#${replacement}`}${result.slice(reference.end)}`;
    count += 1;
  }
  let metadata: ReturnType<typeof inspectMetadata>;
  try { metadata = inspectMetadata(markdown); }
  catch { return { markdown: result, count }; }
  const tagsValue = metadata.values.tags;
  const current = (Array.isArray(tagsValue) ? tagsValue : typeof tagsValue === 'string' ? tagsValue.split(/[\s,]+/u) : [])
    .filter((item): item is string => typeof item === 'string').map((item) => item.replace(/^#/u, '')).filter((item) => validTag.test(item));
  if (current.length) {
    const revised: string[] = [];
    for (const tag of current) {
      const replacement = change(tag);
      if (replacement !== undefined && replacement !== tag) count += 1;
      if (replacement !== null) revised.push(replacement ?? tag);
    }
    if (revised.length !== current.length || revised.some((tag, index) => tag !== current[index])) {
      const unique = [...new Map(revised.map((tag) => [tag.toLocaleLowerCase(), tag])).values()];
      result = updateFrontmatterProperty(result, 'tags', unique.length ? unique : undefined, 'list');
    }
  }
  for (const [key, type] of Object.entries(metadata.types)) {
    if (key === 'tags' || type !== 'tag') continue;
    const value = metadata.values[key];
    if (typeof value !== 'string') continue;
    const original = value.replace(/^#/u, '');
    if (!validTag.test(original)) continue;
    const replacement = change(original);
    if (replacement === undefined || replacement === original) continue;
    result = updateFrontmatterProperty(result, key, replacement === null ? undefined : `#${replacement}`, 'tag');
    count += 1;
  }
  return { markdown: result, count };
}

export function planTagRewrite(notes: VaultNote[], from: string, to: string | null, includeChildren = false): TagChange[] {
  return notes.filter((note) => !note.deletedAt).flatMap((note) => {
    const { markdown, count } = rewriteTag(note.markdown, from, to, includeChildren);
    return count ? [{ noteId: note.id, title: note.title, path: note.path, before: note.markdown, after: markdown, revision: note.revision, count }] : [];
  });
}
