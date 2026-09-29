import { headingSlug, parseOutline } from './editor-markdown';
import { parseBlocks, parseInternalLinks, resolveInternalLink, type InternalLink } from './link-engine';
import { joinVaultPath, pathKey, safeFileStem, type VaultNote } from './vault-domain';
import { stripFrontmatter } from './vault-note';

export type NoteRefactorRequest =
  | { kind: 'merge'; sourceId: string; targetId: string }
  | { kind: 'split'; sourceId: string; level: number }
  | { kind: 'extract-selection'; sourceId: string; from: number; to: number; title: string }
  | { kind: 'extract-heading'; sourceId: string; headingId: string }
  | { kind: 'move-heading'; sourceId: string; headingId: string; targetId: string }
  | { kind: 'duplicate-heading'; sourceId: string; headingId: string }
  | { kind: 'canvas-selection'; sourceId: string; from: number; to: number; title: string }
  | { kind: 'moc'; sourceId: string; title: string; noteIds: string[] };

export interface RefactorCreate { id: string; title: string; path: string; folderId: string | null; markdown: string }
export interface RefactorEdit { noteId: string; title: string; path: string; revision: number; before: string; after: string }
export interface NoteRefactorPlan {
  kind: NoteRefactorRequest['kind']; vaultId: string; summary: string;
  expectedRevisions: { id: string; revision: number }[];
  creates: RefactorCreate[]; edits: RefactorEdit[]; warnings: string[];
  canvas?: { title: string; cards: string[] };
}

const folderOf = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/';
function relativePath(fromPath: string, toPath: string): string {
  const from = folderOf(fromPath).split('/').filter(Boolean), to = toPath.split('/').filter(Boolean);
  while (from.length && to.length && from[0]!.toLocaleLowerCase() === to[0]!.toLocaleLowerCase()) { from.shift(); to.shift(); }
  return [...from.map(() => '..'), ...to].map((part) => encodeURIComponent(part).replace(/\(/gu, '%28').replace(/\)/gu, '%29')).join('/');
}
function noteLink(fromPath: string, to: Pick<RefactorCreate, 'id' | 'title' | 'path'>, label = to.title): string {
  return `[${label.replaceAll(']', '\\]')}](${relativePath(fromPath, to.path)})<!-- noor-note-id:${to.id} -->`;
}
function appendSection(markdown: string, section: string): string { return `${markdown.trimEnd()}\n\n${section.trim()}\n`; }
function replaceRange(markdown: string, start: number, end: number, replacement: string): string { return `${markdown.slice(0, start)}${replacement}${markdown.slice(end)}`; }
function selection(note: VaultNote, from: number, to: number): string {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > note.markdown.length || from >= to) throw new Error('Select nonempty source Markdown before previewing.');
  const frontmatter = note.markdown.match(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/u);
  if (frontmatter && from < frontmatter[0].length) throw new Error('Select note body text; YAML frontmatter cannot be extracted.');
  return note.markdown.slice(from, to);
}
function headingSection(note: VaultNote, id: string): { start: number; end: number; markdown: string; title: string; level: number; headings: ReturnType<typeof parseOutline> } {
  const headings = parseOutline(note.markdown), index = headings.findIndex((item) => item.id === id);
  if (index < 0) throw new Error('The heading is no longer in this note.');
  const heading = headings[index]!;
  const end = headings.slice(index + 1).find((item) => item.level <= heading.level)?.offset ?? note.markdown.length;
  return { start: heading.offset, end, markdown: note.markdown.slice(heading.offset, end).trimEnd(), title: heading.text, level: heading.level, headings: headings.filter((item) => item.offset >= heading.offset && item.offset < end) };
}
function headingStub(section: string, link: string): string {
  const lines = section.split('\n');
  const header = lines[1] && /^[ \t]{0,3}(?:=+|-+)[ \t]*\r?$/u.test(lines[1]) ? lines.slice(0, 2).join('\n') : lines[0] ?? '';
  return `${header}\n\nMoved to ${link}.\n\n`;
}
function readableTarget(note: Pick<VaultNote, 'path' | 'title'> | RefactorCreate): string { return note.path.replace(/^\//u, '').replace(/\.md$/iu, ''); }
function rewrittenLink(link: InternalLink, note: Pick<RefactorCreate, 'id' | 'path' | 'title'>, fromPath: string): string {
  const anchor = link.blockId ? `#^${link.blockId}` : link.heading ? `#${headingSlug(link.heading)}` : '';
  if (link.kind === 'markdown') return `${link.raw.startsWith('!') ? '!' : ''}[${(link.alias ?? note.title).replaceAll(']', '\\]')}](${relativePath(fromPath, note.path)}${anchor})<!-- noor-note-id:${note.id} -->`;
  const label = link.alias ? `|${link.alias}` : '';
  return `${link.kind === 'embed' ? '!' : ''}[[${readableTarget(note)}${link.blockId ? `^${link.blockId}` : link.heading ? `#${link.heading}` : ''}${label}]]<!-- noor-note-id:${note.id} -->`;
}
function rewriteLinks(markdown: string, context: VaultNote, outputPath: string, notes: VaultNote[], moved: Map<string, RefactorCreate | VaultNote>, warnings: Set<string>): string {
  let result = markdown;
  for (const link of parseInternalLinks(markdown).reverse()) {
    const resolved = resolveInternalLink(link, context, notes);
    if (!resolved.noteId) {
      if (resolved.status === 'ambiguous' || resolved.status === 'missing') warnings.add(`Unresolved link in ${context.title || context.path}: ${link.raw.slice(0, 80)}`);
      continue;
    }
    const key = link.blockId ? `block:${resolved.noteId}:${link.blockId}` : link.heading ? `heading:${resolved.noteId}:${headingSlug(link.heading)}` : '';
    const movedTarget = key ? moved.get(key) : undefined;
    if (outputPath === context.path && !movedTarget) continue;
    const destination = movedTarget ?? notes.find((note) => note.id === resolved.noteId);
    if (!destination) continue;
    const replacement = rewrittenLink(link, destination, outputPath);
    result = replaceRange(result, link.start, link.end, replacement);
  }
  return result;
}
function markMovedAnchors(note: VaultNote, fragment: string, destination: RefactorCreate | VaultNote, moved: Map<string, RefactorCreate | VaultNote>, warnings: Set<string>): void {
  for (const heading of parseOutline(fragment)) {
    const key = `heading:${note.id}:${headingSlug(heading.text)}`;
    if (moved.has(key) && moved.get(key)?.id !== destination.id) warnings.add(`Duplicate heading “${heading.text}” in ${note.title}; review heading links.`);
    else moved.set(key, destination);
  }
  for (const block of parseBlocks(fragment)) {
    const key = `block:${note.id}:${block.id}`;
    if (moved.has(key) && moved.get(key)?.id !== destination.id) warnings.add(`Duplicate block ID ^${block.id} in ${note.title}; review block links.`);
    else moved.set(key, destination);
  }
}

/** Pure preview planner. It never writes notes; apply must verify all source revisions again. */
export function planNoteRefactor(notes: VaultNote[], request: NoteRefactorRequest, existingPaths: string[] = []): NoteRefactorPlan {
  const source = notes.find((note) => note.id === request.sourceId && !note.deletedAt);
  if (!source) throw new Error('Source note is unavailable.');
  if (notes.some((note) => note.vaultId !== source.vaultId)) throw new Error('Notes from different vaults cannot be refactored together.');
  const byId = new Map(notes.map((note) => [note.id, note]));
  const usedPaths = new Set([...existingPaths, ...notes.map((note) => note.path)].map(pathKey));
  const warnings = new Set<string>();
  const moved = new Map<string, RefactorCreate | VaultNote>();
  const creates: RefactorCreate[] = [];
  const edited = new Map<string, string>();
  const add = (title: string, folderId: string | null, folderPath: string, markdown: string): RefactorCreate => {
    const name = title.trim().slice(0, 200);
    if (!name) throw new Error('Enter a title for the new note.');
    const stem = safeFileStem(name);
    let path = joinVaultPath(folderPath, `${stem}.md`), suffix = 2;
    while (usedPaths.has(pathKey(path))) path = joinVaultPath(folderPath, `${stem} (${suffix++}).md`);
    usedPaths.add(pathKey(path));
    const created = { id: crypto.randomUUID(), title: name, path, folderId, markdown };
    creates.push(created);
    return created;
  };
  const targetOf = (id: string): VaultNote => { const target = byId.get(id); if (!target || target.deletedAt || target.id === source.id) throw new Error('Choose another available note.'); return target; };
  const destinationFor = (fragment: string, title: string): RefactorCreate => add(title, source.folderId, folderOf(source.path), fragment);
  const sourceLink = (fromPath: string, to: RefactorCreate | VaultNote) => noteLink(fromPath, to, to.title);
  let summary = '';
  let canvas: NoteRefactorPlan['canvas'];

  if (request.kind === 'merge') {
    const target = targetOf(request.targetId);
    const body = stripFrontmatter(source.markdown).trim();
    if (!body) throw new Error('The source note has no content to merge.');
    markMovedAnchors(source, body, target, moved, warnings);
    const relocated = rewriteLinks(body, source, target.path, notes, moved, warnings);
    edited.set(target.id, appendSection(target.markdown, `## From ${source.title || 'Untitled note'}\n\n${relocated}`));
    edited.set(source.id, `# ${source.title || 'Untitled note'}\n\nMerged into ${sourceLink(source.path, target)}.\n`);
    if (source.markdown.startsWith('---')) warnings.add('Source frontmatter remains on the source redirect note; review properties before deleting it.');
    summary = `Merge “${source.title}” into “${target.title}” and leave a link from the source note.`;
  } else if (request.kind === 'split') {
    if (!Number.isInteger(request.level) || request.level < 1 || request.level > 6) throw new Error('Choose a heading level from 1 to 6.');
    const sections = parseOutline(source.markdown).filter((item) => item.level === request.level).map((item) => headingSection(source, item.id));
    if (!sections.length) throw new Error(`No level ${request.level} headings were found.`);
    let remainder = source.markdown;
    const replacements = sections.map((section) => {
      const created = destinationFor(section.markdown, section.title);
      markMovedAnchors(source, section.markdown, created, moved, warnings);
      return { section, created };
    });
    for (const { section, created } of replacements.reverse()) remainder = replaceRange(remainder, section.start, section.end, headingStub(section.markdown, sourceLink(source.path, created)));
    edited.set(source.id, remainder);
    summary = `Split ${sections.length} level ${request.level} sections into new notes.`;
  } else if (request.kind === 'extract-heading' || request.kind === 'move-heading') {
    const section = headingSection(source, request.headingId);
    const destination = request.kind === 'move-heading' ? targetOf(request.targetId) : destinationFor(section.markdown, section.title);
    if (request.kind === 'move-heading' && parseOutline(destination.markdown).some((item) => headingSlug(item.text) === headingSlug(section.title))) throw new Error('Destination already has this heading. Rename one heading before moving.');
    markMovedAnchors(source, section.markdown, destination, moved, warnings);
    if (request.kind === 'move-heading') edited.set(destination.id, appendSection(destination.markdown, rewriteLinks(section.markdown, source, destination.path, notes, moved, warnings)));
    edited.set(source.id, replaceRange(source.markdown, section.start, section.end, headingStub(section.markdown, sourceLink(source.path, destination))));
    summary = request.kind === 'move-heading' ? `Move “${section.title}” to “${destination.title}”.` : `Extract “${section.title}” to a new note.`;
  } else if (request.kind === 'extract-selection') {
    const fragment = selection(source, request.from, request.to);
    if (!fragment.trim()) throw new Error('Select nonempty Markdown.');
    if (request.from > 0 && source.markdown[request.from - 1] !== '\n' || request.to < source.markdown.length && source.markdown[request.to] !== '\n') warnings.add('Selection cuts through a Markdown line; review the source and extracted note.');
    const destination = destinationFor(fragment, request.title);
    markMovedAnchors(source, fragment, destination, moved, warnings);
    edited.set(source.id, replaceRange(source.markdown, request.from, request.to, sourceLink(source.path, destination)));
    summary = `Extract selection to “${destination.title}”.`;
  } else if (request.kind === 'duplicate-heading') {
    const section = headingSection(source, request.headingId);
    const lines = section.markdown.split('\n');
    lines[0] = lines[0]!.replace(section.title, `${section.title} copy`);
    const duplicate = lines.join('\n').replace(/[ \t]+\^[A-Za-z0-9][A-Za-z0-9_-]{0,100}(?=\r?$)/gmu, '');
    edited.set(source.id, replaceRange(source.markdown, section.end, section.end, `\n\n${duplicate}\n`));
    warnings.add('Block IDs were removed from the copy so existing block links keep pointing to the original. Review links inside the duplicate.');
    summary = `Duplicate “${section.title}” below the original section.`;
  } else if (request.kind === 'moc') {
    const chosen = [...new Set(request.noteIds)].map((id) => byId.get(id)).filter((note): note is VaultNote => Boolean(note && !note.deletedAt));
    if (!chosen.length) throw new Error('Choose at least one note for the index.');
    const destination = destinationFor('', request.title);
    destination.markdown = `# ${destination.title}\n\n${chosen.map((note) => `- ${noteLink(destination.path, note, note.title || 'Untitled note')}`).join('\n')}\n`;
    summary = `Create an index linking ${chosen.length} notes.`;
  } else if (request.kind === 'canvas-selection') {
    const fragment = selection(source, request.from, request.to);
    const cards = fragment.split(/\r?\n[ \t]*\r?\n/gu).map((part) => part.trim()).filter(Boolean);
    if (!cards.length || cards.length > 50 || cards.some((card) => card.length > 100_000)) throw new Error('Select 1 to 50 Markdown blocks, each under 100,000 characters.');
    canvas = { title: request.title.trim() || `${source.title || 'Note'} cards`, cards };
    warnings.add('Canvas cards copy the selected Markdown; the source selection remains in the note.');
    summary = `Create ${cards.length} Canvas text cards from the selection.`;
  }

  if (request.kind !== 'duplicate-heading' && request.kind !== 'moc' && request.kind !== 'canvas-selection') {
    for (const created of creates) created.markdown = rewriteLinks(created.markdown, source, created.path, notes, moved, warnings);
    for (const note of notes) {
      const before = edited.get(note.id) ?? note.markdown;
      const after = rewriteLinks(before, note, note.path, notes, moved, warnings);
      if (after !== before) edited.set(note.id, after);
    }
    const movedAcrossFolders = [...creates.map((item) => item.path), ...[...edited.keys()].filter((id) => id !== source.id).map((id) => byId.get(id)!.path)].some((path) => folderOf(path) !== folderOf(source.path));
    if (movedAcrossFolders) {
      const bodies = request.kind === 'merge' ? stripFrontmatter(source.markdown) : request.kind === 'extract-selection' ? source.markdown.slice(request.from, request.to) : request.kind === 'split' ? source.markdown : request.kind === 'extract-heading' || request.kind === 'move-heading' ? headingSection(source, request.headingId).markdown : '';
      if (/(?:!\[[^\]]*\]\([^):]+\)|!\[\[[^\]]+\]\])/u.test(bodies)) warnings.add('Relative attachment references may need adjustment after moving content between folders.');
    }
  }
  const edits = [...edited].flatMap(([id, after]) => { const note = byId.get(id)!; return after === note.markdown ? [] : [{ noteId: id, title: note.title, path: note.path, revision: note.revision, before: note.markdown, after }]; });
  if (!edits.length && !creates.length && !canvas) throw new Error('This operation would not change anything.');
  return { kind: request.kind, vaultId: source.vaultId, summary, expectedRevisions: notes.map((note) => ({ id: note.id, revision: note.revision })), creates, edits, warnings: [...warnings], ...(canvas ? { canvas } : {}) };
}
