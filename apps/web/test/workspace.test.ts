import { createNote } from '@noor-note/core';
import { describe, expect, it } from 'vitest';
import { filterNotes, nextUpdatedAt, prepareImportedNotes, sortNotes, toggleTaskLine } from '../src/lib/workspace';

const firstId = 'cb3541a0-dc43-4cf1-a6c8-fbcd59f90545';
const secondId = 'cb3541a0-dc43-4cf1-a6c8-fbcd59f90546';
const thirdId = 'cb3541a0-dc43-4cf1-a6c8-fbcd59f90547';

describe('workspace note selectors', () => {
  it('searches content and title while matching complete tags only', () => {
    const older = createNote('Read about #research and #research/notes', {
      id: firstId,
      title: 'Sources',
      now: new Date('2026-09-22T10:00:00.000Z'),
    });
    const newer = createNote('A #researcher note', {
      id: secondId,
      title: 'Fieldwork',
      now: new Date('2026-09-23T10:00:00.000Z'),
    });
    expect(filterNotes([older, newer], 'FIELD')).toEqual([newer]);
    expect(filterNotes([older, newer], '', 'research')).toEqual([older]);
    expect(filterNotes([older, newer], 'about', 'research')).toEqual([older]);
  });

  it('sorts timestamp offsets by actual time and keeps edit timestamps monotonic', () => {
    const first = createNote('first', { id: firstId, now: new Date('2026-09-22T00:00:00Z') });
    const second = createNote('second', { id: secondId, now: new Date('2026-09-22T00:00:00Z') });
    const withOffsets = [
      { ...first, updatedAt: '2026-09-23T10:00:00+02:00' },
      { ...second, updatedAt: '2026-09-23T09:00:00Z' },
    ];
    expect(sortNotes(withOffsets).map((note) => note.id)).toEqual([secondId, firstId]);
    expect(nextUpdatedAt({ ...first, updatedAt: '2026-09-24T00:00:00.000Z' }, Date.parse('2026-09-23T00:00:00Z'))).toBe('2026-09-24T00:00:00.001Z');
  });
});

describe('backup import preparation', () => {
  it('keeps a newer local note and imports a conflicting backup as another note', () => {
    const local = createNote('New work', { id: firstId, title: 'Project' });
    const backup = { ...local, content: 'Older work' };
    const imported = prepareImportedNotes([local], [backup], () => secondId);
    expect(imported).toEqual([{ ...backup, id: secondId }]);
    expect(local.content).toBe('New work');
  });

  it('skips identical records and assigns distinct IDs to repeated collisions', () => {
    const local = createNote('Body', { id: firstId });
    const backup = { ...local, content: 'Other' };
    const ids = [secondId, thirdId];
    const imported = prepareImportedNotes([local], [local, backup, backup], () => ids.shift() ?? crypto.randomUUID());
    expect(imported.map((note) => note.id)).toEqual([secondId, thirdId]);
  });
});

describe('task updates', () => {
  it('toggles bullet and ordered Markdown checkboxes at one-based lines', () => {
    const source = '# Plan\n- [ ] Draft\n1. [x] Review\nPlain text';
    const first = toggleTaskLine(source, 2);
    expect(first).toBe('# Plan\n- [x] Draft\n1. [x] Review\nPlain text');
    expect(toggleTaskLine(first ?? '', 3)).toBe('# Plan\n- [x] Draft\n1. [ ] Review\nPlain text');
    expect(toggleTaskLine(source, 4)).toBeNull();
  });
});
