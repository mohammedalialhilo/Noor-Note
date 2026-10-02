import { describe, expect, it } from 'vitest';
import { noteActions, planNoteActionEdit, prepareNoteAction } from '../src/note-actions';

const source = { id: crypto.randomUUID(), vaultId: crypto.randomUUID(), path: '/Ideas.md', title: 'Ideas', markdown: 'First point.\nSecond point.' };
const selection = { from: 0, to: 12, text: 'First point.' };

describe('AI note actions', () => {
  it('registers every supported action with a bounded and scoped request', () => {
    expect(noteActions).toHaveLength(19);
    expect(new Set(noteActions.map((action) => action.id)).size).toBe(19);
    for (const action of noteActions) {
      const prepared = prepareNoteAction({ action: action.id, source, selection, language: 'Swedish' });
      expect(prepared.scope).toEqual({ kind: 'currentNote', vaultId: source.vaultId, noteId: source.id });
      expect(prepared.content).toHaveLength(1);
      expect(prepared.content[0]?.markdown).toBe(action.id === 'summarize-note' ? source.markdown : selection.text);
      expect(prepared.prompt).not.toContain(selection.text);
      if (action.id === 'translate') { expect(prepared.prompt).not.toContain('Swedish'); expect(prepared.userInstruction).toBe('Target language: Swedish'); }
    }
  });

  it('rejects stale selections, oversized context, and missing translation language', () => {
    expect(() => prepareNoteAction({ action: 'summarize-selection', source, selection: null })).toThrow('Select text');
    expect(() => prepareNoteAction({ action: 'rewrite', source, selection: { ...selection, text: 'Other text' } })).toThrow('changed');
    expect(() => prepareNoteAction({ action: 'translate', source, selection })).toThrow('target language');
    expect(() => prepareNoteAction({ action: 'summarize-note', source: { ...source, markdown: 'a'.repeat(2_501) }, selection: null })).toThrow('2,500');
  });

  it('plans replace, insert below, append, and title changes without editing source', () => {
    const prepared = prepareNoteAction({ action: 'rewrite', source, selection });
    const replace = planNoteActionEdit(prepared, 'Revised point.');
    expect(replace).toMatchObject({ from: 0, to: 12, after: 'Revised point.\nSecond point.' });
    const below = planNoteActionEdit(prepared, '- [ ] Follow up', 'insert-below');
    expect(below).toMatchObject({ from: 12, to: 12 });
    expect('after' in below && below.after).toContain('- [ ] Follow up');
    const append = planNoteActionEdit(prepared, 'Summary', 'append');
    expect('after' in append && append.after.endsWith('Summary\n')).toBe(true);
    const title = planNoteActionEdit(prepareNoteAction({ action: 'suggest-title', source, selection: null }), '## Better title\nExtra line');
    expect(title).toEqual({ title: 'Better title' });
    expect(source.markdown).toBe('First point.\nSecond point.');
    expect(() => planNoteActionEdit(prepared, ' ')).toThrow('empty');
  });
});
