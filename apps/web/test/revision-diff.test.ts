import { describe, expect, it } from 'vitest';
import type { Revision, VaultNote } from '@noor-note/core';
import { diffMarkdown, diffRevisionMetadata, pairDiffLines } from '../src/lib/revision-diff';

describe('version history comparison', () => {
  it('marks added and removed lines while retaining line numbers across unchanged text', () => {
    const diff = diffMarkdown('A\nOld\nEnd', 'A\nNew\nEnd');
    expect(diff.map((line) => [line.kind, line.text, line.beforeLine, line.afterLine])).toEqual([
      ['equal', 'A', 1, 1], ['removed', 'Old', 2, null], ['added', 'New', null, 2], ['equal', 'End', 3, 3],
    ]);
    expect(pairDiffLines(diff).map((row) => [row.before?.text, row.after?.text])).toEqual([['A', 'A'], ['Old', 'New'], ['End', 'End']]);
  });

  it('reports title, path, and property changes without mutating either snapshot', () => {
    const before = { id: crypto.randomUUID(), vaultId: crypto.randomUUID(), noteId: crypto.randomUUID(), number: 1, title: 'Draft', path: '/Draft.md', markdown: 'A', checksum: 'a'.repeat(64), createdAt: '2026-01-01T00:00:00.000Z', kind: 'manual', metadata: { folderId: null, aliases: ['Idea'], properties: { status: 'open' } } } satisfies Revision;
    const after = { id: before.noteId, vaultId: before.vaultId, folderId: null, title: 'Final', path: '/Final.md', markdown: 'B', createdAt: before.createdAt, updatedAt: before.createdAt, deletedAt: null, trashGroupId: null, aliases: [], properties: { status: 'done' }, revision: 2, checksum: 'b'.repeat(64) } satisfies VaultNote;
    expect(diffRevisionMetadata(before, after).map((item) => item.field)).toEqual(['Title', 'Path', 'Aliases', 'Property: status']);
    expect(before.metadata.properties.status).toBe('open');
  });
});
