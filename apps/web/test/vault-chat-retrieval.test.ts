import { describe, expect, it, vi } from 'vitest';
import { makeVaultNote, newBase, readBaseDefinition, withBaseDefinition, type VaultNote } from '@noor-note/core';
import type { SearchResult } from '@noor-note/search';
import { toNoteEntry, type VaultRepository } from '@noor-note/storage';
import { resolveChatCandidates, retrieveChatContext } from '../src/lib/vault-chat-retrieval';

describe('vault chat retrieval', () => {
  it('loads only matching note bodies and sends bounded passages with real source ranges', async () => {
    const vaultId = crypto.randomUUID();
    const match = await makeVaultNote({ vaultId, title: 'Release plan', markdown: '# Timeline\nThe release date is October 12.\n# Budget\nBudget is 400.' });
    const unrelated = await makeVaultNote({ vaultId, title: 'Garden', markdown: 'Tulips are blooming.' });
    const notes = new Map<string, VaultNote>([[match.id, match], [unrelated.id, unrelated]]);
    const getNote = vi.fn(async (id: string) => notes.get(id));
    const search = vi.fn(async (query: string): Promise<SearchResult[]> => query === 'release' || query === 'october' ? [{ id: match.id, kind: 'note', title: match.title, path: match.path, excerpt: '', highlights: [], properties: [], score: 1, updatedAt: match.updatedAt }] : []);
    const result = await retrieveChatContext({ vaultId, question: 'When is the release in October?', choice: { kind: 'vaultRetrieval' }, candidates: [...notes.values()].map(toNoteEntry), repository: { getNote } as unknown as VaultRepository, search });
    expect(getNote).toHaveBeenCalledTimes(1);
    expect(result.sources).toMatchObject([{ id: 'S1', noteId: match.id, heading: 'Timeline', line: 2, excerpt: 'The release date is October 12.' }]);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.markdown).toContain('[S1] Timeline: The release date is October 12.');
    expect(result.content[0]?.markdown).not.toContain('Budget is 400');
    expect(result.scope).toMatchObject({ kind: 'vaultRetrieval', noteIds: [match.id] });
  });

  it('abstains before generation when no passage supports the question', async () => {
    const vaultId = crypto.randomUUID();
    const note = await makeVaultNote({ vaultId, title: 'Garden', markdown: 'Tulips are blooming.' });
    const result = await retrieveChatContext({ vaultId, question: 'What is the launch budget?', choice: { kind: 'currentNote', noteId: note.id }, candidates: [toNoteEntry(note)], repository: { getNote: async () => note } as unknown as VaultRepository, search: async () => [] });
    expect(result.sources).toEqual([]);
    expect(result.content).toEqual([]);
  });

  it('restricts folder candidates to descendants', async () => {
    const vaultId = crypto.randomUUID(), folderId = crypto.randomUUID();
    const inside = await makeVaultNote({ vaultId, folderId, title: 'Inside', markdown: 'alpha' });
    const outside = await makeVaultNote({ vaultId, title: 'Outside', markdown: 'alpha' });
    const folders = [{ id: folderId, vaultId, parentId: null, name: 'Projects', path: '/Projects', createdAt: inside.createdAt, updatedAt: inside.updatedAt, deletedAt: null, trashGroupId: null }];
    const candidates = await resolveChatCandidates({ choice: { kind: 'folderResults', folderId }, notes: [toNoteEntry({ ...inside, path: '/Projects/Inside.md' }), toNoteEntry(outside)], folders, bases: [], search: async () => [] });
    expect(candidates.map((item) => item.id)).toEqual([inside.id]);
  });

  it('uses a saved Base query to restrict candidates', async () => {
    const vaultId = crypto.randomUUID();
    const work = await makeVaultNote({ vaultId, title: 'Work', markdown: 'A work item.' });
    const personal = await makeVaultNote({ vaultId, title: 'Personal', markdown: 'A personal item.' });
    const base = newBase(vaultId, 'Work Base', []);
    const definition = readBaseDefinition(base);
    const filtered = withBaseDefinition(base, { ...definition, query: { ...definition.query, tag: 'work' } });
    const entries = [{ ...toNoteEntry(work), tags: ['work'] }, { ...toNoteEntry(personal), tags: ['personal'] }];
    const candidates = await resolveChatCandidates({ choice: { kind: 'baseResults', baseId: filtered.id }, notes: entries, folders: [], bases: [filtered], search: async () => [] });
    expect(candidates.map((item) => item.id)).toEqual([work.id]);
  });
});
