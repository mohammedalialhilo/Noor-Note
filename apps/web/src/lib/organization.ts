import { extractTags, findUnlinkedMentions, inspectMetadata, parseInternalLinks, replaceMention, resolveLinkTarget, updateFrontmatterProperty, type Folder, type TagChange, type VaultNote } from '@noor-note/core';

export type OrganizationKind = 'related' | 'missing-link' | 'duplicate' | 'similar' | 'tag' | 'orphan' | 'index' | 'folder' | 'property' | 'task' | 'contradiction';
export type OrganizationAction =
  | { kind: 'link'; targetId: string; text?: string; start?: number; end?: number }
  | { kind: 'property'; key: string; value: string | boolean }
  | { kind: 'tag'; value: string }
  | { kind: 'task'; line: string }
  | { kind: 'move'; folderId: string }
  | { kind: 'index'; noteIds: string[]; folderId: string | null; title: string };
export interface OrganizationSuggestion {
  id: string; kind: OrganizationKind; noteId: string; title: string; reason: string; evidence: string;
  action: OrganizationAction; safeForBatch: boolean; source: 'local' | 'ai';
}

const stop = new Set(['about', 'after', 'again', 'also', 'because', 'before', 'between', 'from', 'have', 'into', 'more', 'note', 'notes', 'that', 'their', 'there', 'these', 'this', 'with', 'your']);
function words(text: string): Set<string> { return new Set((text.toLocaleLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []).filter((word) => !stop.has(word)).slice(0, 500)); }
function similarity(a: Set<string>, b: Set<string>): number { const common = [...a].filter((word) => b.has(word)).length; return common / Math.max(1, a.size + b.size - common); }
function suggestion(kind: OrganizationKind, note: VaultNote, title: string, reason: string, evidence: string, action: OrganizationAction, safeForBatch = true): OrganizationSuggestion {
  return { id: `${kind}:${note.id}:${JSON.stringify(action)}`, kind, noteId: note.id, title, reason, evidence: evidence.slice(0, 240), action, safeForBatch, source: 'local' };
}

/** Bounded local discovery. It never writes to the vault. */
export function discoverOrganization(notes: VaultNote[], folders: Folder[]): OrganizationSuggestion[] {
  const live = notes.filter((note) => !note.deletedAt);
  const result: OrganizationSuggestion[] = [];
  const byId = new Map(live.map((note) => [note.id, note]));
  const tokens = new Map(live.map((note) => [note.id, words(`${note.title} ${note.markdown.slice(0, 4000)}`)]));
  const inbound = new Map(live.map((note) => [note.id, 0]));
  const outbound = new Map(live.map((note) => [note.id, 0]));
  const linked = new Set<string>();
  for (const note of live) for (const link of parseInternalLinks(note.markdown)) {
    const target = resolveLinkTarget(link, note, live);
    if (!target || target.id === note.id) continue;
    inbound.set(target.id, (inbound.get(target.id) ?? 0) + 1); outbound.set(note.id, (outbound.get(note.id) ?? 0) + 1);
    linked.add(`${note.id}:${target.id}`);
  }
  const tagCounts = new Map<string, number>();
  for (const note of live) for (const tag of extractTags(note.markdown)) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  const commonTags = [...tagCounts].filter(([, count]) => count >= 2).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([tag]) => tag);
  for (const note of live) {
    if ((inbound.get(note.id) ?? 0) + (outbound.get(note.id) ?? 0) === 0 && live.length > 1)
      result.push(suggestion('orphan', note, `Review orphan: ${note.title}`, 'This note has no resolved links to other notes.', note.path, { kind: 'property', key: 'needs_review', value: 'orphan' }, false));
    const ownTags = new Set(extractTags(note.markdown));
    const tag = commonTags.find((candidate) => !ownTags.has(candidate) && words(`${note.title} ${note.markdown.slice(0, 400)}`).has(candidate.toLocaleLowerCase()));
    if (tag) result.push(suggestion('tag', note, `Add #${tag}`, 'This established tag appears in the note text.', note.title, { kind: 'tag', value: tag }));
    const due = note.markdown.match(/^(?:Due|Deadline):\s*(\d{4}-\d{2}-\d{2})\s*$/imu);
    let hasDue = true;
    try { hasDue = Object.hasOwn(inspectMetadata(note.markdown).values, 'due'); } catch { /* Malformed YAML should not block the scan. */ }
    if (due && !hasDue) result.push(suggestion('property', note, 'Add due property', 'A due date appears in the body but is absent from frontmatter.', due[0], { kind: 'property', key: 'due', value: due[1]! }));
    const todo = note.markdown.split('\n').find((line) => /^(?:TODO|Action):\s+\S/iu.test(line));
    if (todo) result.push(suggestion('task', note, 'Convert action line to task', 'A plain text action can become a Markdown checkbox.', todo, { kind: 'task', line: todo }));
    if (!note.folderId) {
      const folder = folders.find((item) => !item.deletedAt && new RegExp(`\\b${item.name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\b`, 'iu').test(note.title));
      if (folder) result.push(suggestion('folder', note, `Move to ${folder.name}`, 'The note title matches an existing folder.', note.path, { kind: 'move', folderId: folder.id }, false));
    }
  }
  // A bounded pair comparison avoids an unresponsive main thread on large vaults.
  for (let i = 0; i < Math.min(live.length, 300); i++) for (let j = i + 1; j < Math.min(live.length, 300); j++) {
    const a = live[i]!, b = live[j]!;
    const sameBody = a.markdown.trim().length > 30 && a.markdown.trim() === b.markdown.trim();
    const score = similarity(tokens.get(a.id)!, tokens.get(b.id)!);
    if (sameBody || score > .82 && a.markdown.length > 100 && b.markdown.length > 100) result.push(suggestion('duplicate', b, `Possible duplicate of ${a.title}`, sameBody ? 'The Markdown bodies match.' : 'The notes have highly overlapping vocabulary.', `${a.path} ↔ ${b.path}`, { kind: 'property', key: 'possible_duplicate_of', value: a.id }, false));
    else if (score > .42 && !linked.has(`${a.id}:${b.id}`)) {
      result.push(suggestion('similar', a, `Similar to ${b.title}`, `Shared vocabulary score: ${Math.round(score * 100)}%.`, `${a.path} ↔ ${b.path}`, { kind: 'link', targetId: b.id }));
    } else if (score > .23 && !linked.has(`${a.id}:${b.id}`) && a.title !== b.title) {
      result.push(suggestion('related', a, `Related to ${b.title}`, `Shared vocabulary score: ${Math.round(score * 100)}%.`, `${a.path} ↔ ${b.path}`, { kind: 'link', targetId: b.id }));
    }
  }
  for (const target of live.slice(0, 40)) {
    if (target.title.length < 8) continue;
    const mentions = findUnlinkedMentions(live, target);
    for (const mention of mentions.slice(0, 2)) {
      const source = byId.get(mention.sourceNoteId)!;
      result.push(suggestion('missing-link', source, `Link mention of ${target.title}`, 'The note names another note without a link.', mention.preview, { kind: 'link', targetId: target.id, text: mention.text, start: mention.start, end: mention.end }));
    }
  }
  const groups = new Map<string, VaultNote[]>();
  for (const note of live) { const key = note.folderId ?? 'root'; groups.set(key, [...(groups.get(key) ?? []), note]); }
  for (const [key, group] of groups) if (group.length >= 3 && !group.some((note) => /^(index|moc)$/iu.test(note.title))) {
    const anchor = group[0]!; const folder = folders.find((item) => item.id === key);
    result.push(suggestion('index', anchor, `Create ${folder?.name ?? 'Vault'} index`, 'This folder has at least three notes and no index note.', group.slice(0, 8).map((note) => note.title).join(', '), { kind: 'index', noteIds: group.map((note) => note.id), folderId: anchor.folderId, title: `${folder?.name ?? 'Vault'} index` }, false));
  }
  // Contradictions are only surfaced when two notes explicitly state opposite propositions.
  const claims = live.flatMap((note) => [...note.markdown.matchAll(/^(.{4,90}?)\s+(is|are)\s+(not\s+)?(.{4,90})[.!]?$/gimu)].slice(0, 20).map((match) => ({ note, subject: match[1]!.trim().toLocaleLowerCase(), predicate: match[4]!.trim().replace(/[.!]$/u, '').toLocaleLowerCase(), negated: Boolean(match[3]), line: match[0] })));
  const seenClaims = new Map<string, typeof claims[number]>();
  for (const claim of claims) { const key = `${claim.subject}|${claim.predicate}`; const previous = seenClaims.get(key); if (previous && previous.note.id !== claim.note.id && previous.negated !== claim.negated) result.push(suggestion('contradiction', claim.note, `Review conflict with ${previous.note.title}`, 'These explicit statements have opposite polarity. Context may resolve the difference.', `${previous.line} / ${claim.line}`, { kind: 'property', key: 'review_conflict_with', value: previous.note.id }, false)); else if (!previous) seenClaims.set(key, claim); }
  const counts = new Map<OrganizationKind, number>();
  return result.filter((item) => { const count = counts.get(item.kind) ?? 0; if (count >= 25) return false; counts.set(item.kind, count + 1); return true; }).slice(0, 200);
}

export function planOrganizationEdit(s: OrganizationSuggestion, notes: VaultNote[], markdown: string): string {
  const note = notes.find((item) => item.id === s.noteId);
  if (!note) throw new Error('The source note is unavailable.');
  const action = s.action;
  if (action.kind === 'property') return updateFrontmatterProperty(markdown, action.key, action.value);
  if (action.kind === 'tag') { const existing = extractTags(markdown); return updateFrontmatterProperty(markdown, 'tags', [...new Set([...existing, action.value])]); }
  if (action.kind === 'task') { if (!markdown.split('\n').includes(action.line)) throw new Error('The action line changed. Scan again.'); return markdown.replace(action.line, `- [ ] ${action.line.replace(/^(?:TODO|Action):\s*/iu, '')}`); }
  if (action.kind === 'link') {
    const target = notes.find((item) => item.id === action.targetId);
    if (!target) throw new Error('The target note is unavailable.');
    if (action.text !== undefined && action.start !== undefined && action.end !== undefined) return replaceMention(markdown, { text: action.text, start: action.start, end: action.end }, target);
    if (parseInternalLinks(markdown).some((link) => resolveLinkTarget(link, note, notes)?.id === target.id)) return markdown;
    const bullet = `- [[${target.title}]]<!-- noor-note-id:${target.id} -->`;
    const section = /^## Related notes\s*$/gimu.exec(markdown);
    if (section) {
      const from = section.index + section[0].length;
      const nextHeading = /^#{1,2}\s+\S/gmu.exec(markdown.slice(from));
      const to = nextHeading ? from + nextHeading.index : markdown.length;
      return `${markdown.slice(0, to).trimEnd()}\n${bullet}\n\n${markdown.slice(to).trimStart()}`.trimEnd() + '\n';
    }
    return `${markdown.trimEnd()}\n\n## Related notes\n\n${bullet}\n`;
  }
  throw new Error('This action needs a separate preview.');
}

export function planOrganizationChanges(suggestions: OrganizationSuggestion[], notes: VaultNote[]): TagChange[] {
  const originals = new Map(notes.map((note) => [note.id, note]));
  const drafts = new Map<string, string>();
  const ordered = [...suggestions].sort((a, b) => {
    const rank = (item: OrganizationSuggestion) => item.action.kind === 'link' && item.action.start !== undefined ? 0 : item.action.kind === 'property' || item.action.kind === 'tag' ? 2 : 1;
    return rank(a) - rank(b) || (a.action.kind === 'link' && b.action.kind === 'link' ? (b.action.start ?? 0) - (a.action.start ?? 0) : 0);
  });
  for (const suggestionItem of ordered) {
    const note = originals.get(suggestionItem.noteId);
    if (!note) throw new Error('A note was removed. Scan again.');
    drafts.set(note.id, planOrganizationEdit(suggestionItem, notes, drafts.get(note.id) ?? note.markdown));
  }
  return [...drafts].flatMap(([id, after]) => { const note = originals.get(id)!; return after === note.markdown ? [] : [{ noteId: id, title: note.title, path: note.path, before: note.markdown, after, revision: note.revision, count: 1 }]; });
}
