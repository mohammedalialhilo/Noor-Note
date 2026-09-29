import { chatSourceSchema, type AiContentItem, type AiScope, type ChatSource } from '@noor-note/ai';
import { evaluateBaseFormulas, readBaseDefinition, selectBaseNotes, type Base, type Folder, type VaultNote } from '@noor-note/core';
import { chunkNote, type SearchResult } from '@noor-note/search';
import type { NoteEntry, VaultRepository } from '@noor-note/storage';

export type ChatScopeChoice =
  | { kind: 'currentNote'; noteId: string }
  | { kind: 'selectedNotes'; noteIds: string[] }
  | { kind: 'folderResults'; folderId: string }
  | { kind: 'baseResults'; baseId: string }
  | { kind: 'vaultRetrieval' };

export interface ChatRetrieval {
  scope: AiScope;
  sources: ChatSource[];
  content: AiContentItem[];
}

const stop = new Set('a an and are as at be by can did do does for from how i in is it me my of on or our the this to was were what when where which who why with you your'.split(' '));
export function chatQueryTerms(question: string): string[] {
  return [...new Set((question.normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? []).filter((term) => term.length > 2 && !stop.has(term)))].slice(0, 6);
}
const broadQuestion = (question: string) => /\b(summarize|summary|overview|about this|main points|key points)\b/iu.test(question);

export async function resolveChatCandidates(input: {
  choice: ChatScopeChoice; notes: readonly NoteEntry[]; folders: readonly Folder[]; bases: readonly Base[];
  search: (query: string) => Promise<readonly SearchResult[]>;
}): Promise<NoteEntry[]> {
  const { choice, notes, folders } = input;
  if (choice.kind === 'currentNote') return notes.filter((note) => note.id === choice.noteId);
  if (choice.kind === 'selectedNotes') {
    if (choice.noteIds.length > 20) throw new Error('Select at most 20 notes.');
    const ids = new Set(choice.noteIds);
    return notes.filter((note) => ids.has(note.id));
  }
  if (choice.kind === 'folderResults') {
    const folder = folders.find((item) => item.id === choice.folderId);
    if (!folder) throw new Error('Choose an existing folder.');
    return notes.filter((note) => note.path.startsWith(`${folder.path}/`));
  }
  if (choice.kind === 'baseResults') {
    const base = input.bases.find((item) => item.id === choice.baseId && !item.deletedAt);
    if (!base) throw new Error('Choose an existing Base.');
    const definition = readBaseDefinition(base);
    const searchIds = definition.query.search.trim() ? new Set((await input.search(definition.query.search)).filter((item) => item.kind === 'note').map((item) => item.id)) : undefined;
    const computed = evaluateBaseFormulas(notes, definition.formulas);
    return selectBaseNotes(notes, definition.query, folders, searchIds, computed);
  }
  return [...notes];
}

function passageScore(question: string, title: string, heading: string | null, text: string): number {
  const terms = chatQueryTerms(question);
  const body = text.normalize('NFKC').toLocaleLowerCase();
  const section = (heading ?? '').normalize('NFKC').toLocaleLowerCase();
  const titleText = title.normalize('NFKC').toLocaleLowerCase();
  const sectionScore = terms.reduce((score, term) => score + (body.includes(term) ? 2 : 0) + (section.includes(term) ? 1 : 0), 0);
  return sectionScore ? sectionScore + terms.reduce((score, term) => score + (titleText.includes(term) ? 0.25 : 0), 0) : 0;
}

/** Search note IDs first, then load only a bounded set of candidate bodies and passages. */
export async function retrieveChatContext(input: {
  vaultId: string; question: string; choice: ChatScopeChoice; candidates: readonly NoteEntry[];
  repository: Pick<VaultRepository, 'getNote'>; search: (query: string) => Promise<readonly SearchResult[]>;
  currentNote?: VaultNote | null;
}): Promise<ChatRetrieval> {
  const question = input.question.trim();
  if (!question || question.length > 500) throw new Error('Ask a question up to 500 characters.');
  const eligible = new Map(input.candidates.filter((item) => item.vaultId === input.vaultId && !item.deletedAt).map((item) => [item.id, item]));
  const terms = chatQueryTerms(question);
  const broad = broadQuestion(question);
  const ranks = new Map<string, number>();
  if (input.choice.kind === 'currentNote' || input.choice.kind === 'selectedNotes') {
    for (const id of eligible.keys()) ranks.set(id, 1);
  } else if (terms.length) {
    for (const term of terms.slice(0, 4)) {
      const matches = await input.search(term);
      matches.forEach((match, index) => { if (match.kind === 'note' && eligible.has(match.id)) ranks.set(match.id, (ranks.get(match.id) ?? 0) + 1 / (1 + index / 20)); });
    }
  }
  if (broad && ranks.size === 0 && input.choice.kind !== 'vaultRetrieval') {
    [...eligible.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 12).forEach((item) => ranks.set(item.id, 1));
  }
  const selected = [...ranks].sort((a, b) => b[1] - a[1]).slice(0, 12);
  const loaded = await Promise.all(selected.map(async ([id]) => input.currentNote?.id === id ? input.currentNote : input.repository.getNote(id)));
  const passages = loaded.flatMap((note) => note && note.vaultId === input.vaultId && !note.deletedAt ? chunkNote(note).map((chunk) => ({ note, chunk, score: passageScore(question, note.title, chunk.heading, chunk.text) })) : []);
  const ranked = passages.filter((item) => item.score > 0 || broad).sort((a, b) => b.score - a.score || b.note.updatedAt.localeCompare(a.note.updatedAt));
  const perNote = new Map<string, number>();
  const chosen = ranked.filter((item) => { const count = perNote.get(item.note.id) ?? 0; if (count >= 2) return false; perNote.set(item.note.id, count + 1); return true; }).slice(0, 4);
  const sources = chosen.map(({ note, chunk }, index) => chatSourceSchema.parse({
    id: `S${index + 1}`, vaultId: note.vaultId, noteId: note.id, revision: note.revision,
    title: note.title, path: note.path, heading: chunk.heading, blockId: chunk.blockId, line: chunk.line,
    from: chunk.from, to: chunk.to, excerpt: chunk.text,
  }));
  const grouped = new Map<string, { note: VaultNote; excerpts: string[] }>();
  for (const source of sources) {
    const note = loaded.find((item) => item?.id === source.noteId)!;
    const prior = grouped.get(source.noteId) ?? { note, excerpts: [] };
    prior.excerpts.push(`[${source.id}] ${source.heading ? `${source.heading}: ` : ''}${source.excerpt}`);
    grouped.set(source.noteId, prior);
  }
  const content = [...grouped.values()].map(({ note, excerpts }): AiContentItem => ({ vaultId: note.vaultId, noteId: note.id, title: note.title, path: note.path, markdown: excerpts.join('\n\n') }));
  const noteIds = content.map((item) => item.noteId);
  const choice = input.choice;
  const scope: AiScope = choice.kind === 'currentNote' ? { kind: 'currentNote', vaultId: input.vaultId, noteId: choice.noteId }
    : choice.kind === 'selectedNotes' ? { kind: 'selectedNotes', vaultId: input.vaultId, noteIds }
    : choice.kind === 'folderResults' ? { kind: 'folderResults', vaultId: input.vaultId, folderId: choice.folderId, noteIds }
    : choice.kind === 'baseResults' ? { kind: 'baseResults', vaultId: input.vaultId, baseId: choice.baseId, noteIds }
    : { kind: 'vaultRetrieval', vaultId: input.vaultId, query: question, noteIds };
  return { scope, sources, content };
}
