import { describe, expect, it } from 'vitest';
import { makeVaultNote, type Folder } from '@noor-note/core';
import { discoverOrganization, planOrganizationChanges, planOrganizationEdit, type OrganizationSuggestion } from '../src/lib/organization';
import { parseOrganizationAi } from '../src/lib/organization-ai';

const vaultId = '55555555-5555-4555-8555-555555555555';
const folder: Folder = { id: '99999999-9999-4999-8999-999999999999', vaultId, parentId: null, name: 'Research', path: '/Research', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null, trashGroupId: null };

describe('knowledge organization review', () => {
  it('finds grounded local opportunities without changing the source notes', async () => {
    const source = await makeVaultNote({ vaultId, title: 'Research plan', markdown: 'Discuss Project Atlas tomorrow.\nDue: 2026-10-01\nTODO: Send draft' });
    const target = await makeVaultNote({ vaultId, title: 'Project Atlas', markdown: 'An independent project description.' });
    const original = source.markdown;
    const suggestions = discoverOrganization([source, target], [folder]);
    expect(suggestions.map((item) => item.kind)).toEqual(expect.arrayContaining(['missing-link', 'property', 'task', 'folder']));
    expect(source.markdown).toBe(original);
    const linked = suggestions.find((item) => item.kind === 'missing-link')!;
    expect(planOrganizationEdit(linked, [source, target], source.markdown)).toContain(`noor-note-id:${target.id}`);
  });

  it('combines multiple safe suggestions into one revision-checked note edit', async () => {
    const note = await makeVaultNote({ vaultId, title: 'Plan', markdown: 'Due: 2026-10-01\nTODO: Send draft' });
    const proposals = discoverOrganization([note], []);
    const items = proposals.filter((item) => item.kind === 'property' || item.kind === 'task');
    const changes = planOrganizationChanges(items, [note]);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ noteId: note.id, before: note.markdown, revision: note.revision });
    expect(changes[0]!.after).toContain('due:');
    expect(changes[0]!.after).toContain('- [ ] Send draft');
    expect(note.markdown).toBe('Due: 2026-10-01\nTODO: Send draft');
  });

  it('applies multiple unlinked mentions before frontmatter edits without shifting source offsets', async () => {
    const source = await makeVaultNote({ vaultId, title: 'Research notes', markdown: 'Project Atlas and Project Borealis are related.\nDue: 2026-10-01' });
    const atlas = await makeVaultNote({ vaultId, title: 'Project Atlas', markdown: '' });
    const borealis = await makeVaultNote({ vaultId, title: 'Project Borealis', markdown: '' });
    const items = discoverOrganization([source, atlas, borealis], []).filter((item) => item.noteId === source.id && (item.kind === 'missing-link' || item.kind === 'property'));
    const changes = planOrganizationChanges(items, [source, atlas, borealis]);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.after).toContain(`noor-note-id:${atlas.id}`);
    expect(changes[0]!.after).toContain(`noor-note-id:${borealis.id}`);
    expect(changes[0]!.after).toContain('due:');
  });

  it('does not accept model claims without exact source evidence or valid actions', async () => {
    const note = await makeVaultNote({ vaultId, title: 'Plan', markdown: 'TODO: Send draft\nResearch notes' });
    const raw = JSON.stringify({ suggestions: [
      { kind: 'tag', quote: 'Research notes', value: 'research', explanation: 'Topic' },
      { kind: 'task', quote: 'TODO: Send draft', value: 'Send draft', explanation: 'Action' },
      { kind: 'contradiction', quote: 'Research notes', value: 'Conflict', explanation: 'Unsupported' },
      { kind: 'property', quote: 'Imagined evidence', value: 'status=done', explanation: 'Invented' },
    ] });
    const suggestions = parseOrganizationAi(raw, note);
    expect(suggestions.map((item) => item.kind)).toEqual(['tag', 'task']);
    expect(() => parseOrganizationAi('{"suggestions":[{"kind":"delete","quote":"Research notes","value":"x","explanation":"x"}]}', note)).toThrow();
  });

  it('rejects stale mention offsets before a link can be saved', async () => {
    const source = await makeVaultNote({ vaultId, title: 'Source', markdown: 'Project Atlas is active.' });
    const target = await makeVaultNote({ vaultId, title: 'Project Atlas', markdown: '' });
    const item = discoverOrganization([source, target], []).find((suggestion): suggestion is OrganizationSuggestion => suggestion.kind === 'missing-link')!;
    expect(() => planOrganizationEdit(item, [source, target], `Changed ${source.markdown}`)).toThrow(/moved/i);
  });
});
