import { describe, expect, it } from 'vitest';
import { calendarEventMarkdown, calendarRange, deriveCalendarItems, filterCalendarItems, moveCalendarProperty, parseTaskRecords, shiftCalendarAnchor, type CalendarNote } from '../src';

const note = (id: string, properties: CalendarNote['properties'], markdown = '- [ ] Ship @due(2026-09-24)'): CalendarNote => ({
  id, vaultId: 'vault-1', folderId: 'folder-1', path: `/Projects/${id}.md`, title: id, properties,
  tags: ['work'], tasks: parseTaskRecords(markdown),
});

describe('integrated calendar', () => {
  it('derives daily notes, events, dated properties, and tasks from note summaries', () => {
    const notes = [note('Daily', { noor_period_kind: 'daily', noor_period_key: '2026-09-24' }, ''),
      note('Meeting', { noor_event: true, date: '2026-09-25', end_date: '2026-09-26' }, ''),
      note('Milestone', { review: '2026-09-27', updated: '2026-09-28T09:00:00Z' })];
    const items = deriveCalendarItems(notes);
    expect(items.map((item) => [item.kind, item.date])).toEqual([
      ['daily', '2026-09-24'], ['event', '2026-09-25'], ['property', '2026-09-27'],
      ['property', '2026-09-28'], ['task', '2026-09-24'],
    ].sort((a, b) => a[1]!.localeCompare(b[1]!) || String(a[0]).localeCompare(String(b[0]))));
    expect(filterCalendarItems(items, { vaultId: 'vault-1', folderId: 'folder-1', tag: 'work', property: 'review' })).toHaveLength(1);
    expect(filterCalendarItems(items, { baseNoteIds: new Set(['Meeting']) }).map((item) => item.kind)).toEqual(['event']);
    expect(filterCalendarItems(items, { taskStatus: 'done' }).some((item) => item.kind === 'task')).toBe(false);
  });

  it('builds local month, week, day, and agenda ranges', () => {
    const anchor = new Date(2026, 8, 24);
    expect(calendarRange('month', anchor)[0]).toBe('2026-08-31');
    expect(calendarRange('week', anchor)).toEqual(['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27']);
    expect(calendarRange('day', anchor)).toEqual(['2026-09-24']);
    expect(calendarRange('agenda', anchor)).toHaveLength(30);
    expect(shiftCalendarAnchor('month', anchor, 1).getMonth()).toBe(9);
  });

  it('creates a Markdown event and moves its date and end date without losing details', () => {
    const source = calendarEventMarkdown({ title: 'Review', date: '2026-09-24', endDate: '2026-09-26', startTime: '09:30', endTime: '10:30', description: 'Bring the draft.' });
    expect(source).toContain('noor_event: true');
    expect(source).toContain('Bring the draft.');
    const moved = moveCalendarProperty(source, 'date', '2026-09-24', '2026-10-01');
    expect(moved).toContain('date: 2026-10-01');
    expect(moved).toContain('end_date: 2026-10-03');
    expect(moved).toContain('Bring the draft.');
    expect(() => moveCalendarProperty(moved, 'date', '2026-09-24', '2026-10-02')).toThrow(/changed/);
    expect(() => calendarEventMarkdown({ title: 'Bad', date: '2026-02-30', endDate: null, startTime: null, endTime: null, description: '' })).toThrow();
  });
});
