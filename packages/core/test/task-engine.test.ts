import { describe, expect, it } from 'vitest';
import { compileTaskQuery, ensureTaskIdsInMarkdown, nextRecurringDate, parseTaskRecords, taskMatchesView, updateTaskMarkdown, type TaskListItem } from '../src';

describe('Markdown task engine', () => {
  it('parses portable metadata, tags, IDs, and source lines while skipping code fences', () => {
    const id = crypto.randomUUID();
    const markdown = `# Plan\n\`\`\`md\n- [ ] Ignore\n\`\`\`\n- [ ] Draft #work/notes @due(2026-10-01) @scheduled(2026-09-28) @priority(high) @repeat(weekly) @assignee(Ali) <!-- noor-task-id:${id} -->\n- [x] Rest @done(2026-09-24) @someday`;
    const tasks = parseTaskRecords(markdown);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toMatchObject({ id, line: 5, text: 'Draft', completed: false, dueDate: '2026-10-01', scheduledDate: '2026-09-28', priority: 'high', recurrence: 'weekly', tags: ['work/notes'], assignee: 'Ali' });
    expect(tasks[1]).toMatchObject({ line: 6, completed: true, completionDate: '2026-09-24', someday: true });
  });

  it('edits the source line, assigns a stable ID, and rejects stale dashboard text', () => {
    const source = '# Notes\n- [ ] Draft #work\nAnother paragraph';
    const edited = updateTaskMarkdown(source, { line: 2, expectedText: 'Draft' }, { text: 'Write draft', dueDate: '2026-09-30', priority: 'urgent' }, new Date(2026, 8, 24));
    expect(edited.markdown).toContain('Another paragraph');
    expect(edited.markdown).toContain('@due(2026-09-30) @priority(urgent) #work');
    expect(parseTaskRecords(edited.markdown)[0]).toMatchObject({ id: edited.taskId, text: 'Write draft', dueDate: '2026-09-30' });
    const moved = `Intro\n${edited.markdown}`;
    expect(updateTaskMarkdown(moved, { id: edited.taskId, line: 2 }, { completed: true }, new Date(2026, 8, 24)).markdown).toContain('@done(2026-09-24)');
    expect(() => updateTaskMarkdown(source, { line: 2, expectedText: 'Changed' }, { completed: true })).toThrow(/changed/);
    expect(() => updateTaskMarkdown(source, { line: 2 }, { dueDate: '2026-02-30' })).toThrow(/YYYY-MM-DD/);
  });

  it('assigns IDs to legacy tasks without changing other Markdown or block links', () => {
    const source = '# Plan\n- [ ] First ^block-one\n\n- [ ] Second';
    const assigned = ensureTaskIdsInMarkdown(source);
    expect(assigned.assigned).toBe(2);
    expect(assigned.markdown).toContain('<!-- noor-task-id:');
    expect(assigned.markdown).toMatch(/<!-- noor-task-id:[^>]+ --> \^block-one/u);
    expect(parseTaskRecords(assigned.markdown)[0]?.blockId).toBe('block-one');
    expect(ensureTaskIdsInMarkdown(assigned.markdown).assigned).toBe(0);
    const windows = ensureTaskIdsInMarkdown('- [ ] First\r\n- [ ] Second');
    expect(windows.markdown.split('\r\n')).toHaveLength(2);
    expect(updateTaskMarkdown(windows.markdown, { line: 1 }, { completed: true }).markdown.split('\r\n')).toHaveLength(2);
  });

  it('repairs duplicate task IDs and refuses an ambiguous source edit', () => {
    const id = crypto.randomUUID();
    const source = `- [ ] First <!-- noor-task-id:${id} -->\n- [ ] Second <!-- noor-task-id:${id} -->`;
    expect(() => updateTaskMarkdown(source, { id, line: 2 }, { completed: true })).toThrow(/Duplicate task ID/);
    const repaired = ensureTaskIdsInMarkdown(source);
    expect(repaired.assigned).toBe(1);
    const tasks = parseTaskRecords(repaired.markdown);
    expect(tasks[0]?.id).toBe(id);
    expect(tasks[1]?.id).not.toBe(id);
    expect(tasks[1]?.id).toBeTruthy();
  });

  it('creates one next recurring instance past completion, without a backlog', () => {
    const source = '- [ ] Standup @due(2026-09-01) @scheduled(2026-08-31) @repeat(weekdays)';
    const result = updateTaskMarkdown(source, { line: 1 }, { completed: true }, new Date(2026, 8, 25));
    const tasks = parseTaskRecords(result.markdown);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toMatchObject({ completed: true, completionDate: '2026-09-25' });
    expect(tasks[1]).toMatchObject({ id: result.nextTaskId, completed: false, dueDate: '2026-09-28', scheduledDate: '2026-09-27', recurrence: 'weekdays' });
    expect(updateTaskMarkdown(result.markdown, { id: result.taskId, line: 1 }, { completed: true }).nextTaskId).toBeNull();
    expect(nextRecurringDate('monthly', new Date(2026, 0, 31), new Date(2026, 1, 28))).toEqual(new Date(2026, 2, 31));
    expect(nextRecurringDate('every:3:weeks', new Date(2026, 0, 1), new Date(2026, 0, 25))).toEqual(new Date(2026, 1, 12));
    expect(nextRecurringDate('daily', new Date(2026, 8, 1), new Date(2026, 8, 25))).toEqual(new Date(2026, 8, 26));
    expect(nextRecurringDate('yearly', new Date(2024, 1, 29), new Date(2025, 2, 1))).toEqual(new Date(2026, 1, 28));
  });

  it('filters built-in and saved views over note summaries', () => {
    const task = parseTaskRecords('- [ ] Review #work @due(2026-09-23) @priority(high)')[0]!;
    const item: TaskListItem = { noteId: crypto.randomUUID(), noteTitle: 'Project', notePath: '/Projects/Project.md', task };
    const now = new Date(2026, 8, 24);
    expect(taskMatchesView('overdue', item, now)).toBe(true);
    expect(taskMatchesView('today', item, now)).toBe(false);
    expect(compileTaskQuery('status:open priority:high tag:work path:Projects before:2026-09-24')(item, '2026-09-24')).toBe(true);
    expect(() => compileTaskQuery('status:maybe')).toThrow(/Invalid task filter/);
    const items = [
      ['inbox', '- [ ] Loose'], ['today', '- [ ] Today @due(2026-09-24)'],
      ['upcoming', '- [ ] Future @due(2026-09-25)'], ['scheduled', '- [ ] Plan @scheduled(2026-10-01)'],
      ['someday', '- [ ] Maybe @someday'], ['completed', '- [x] Done'],
    ] as const;
    for (const [view, source] of items) {
      const matching: TaskListItem = { ...item, task: parseTaskRecords(source)[0]! };
      expect(taskMatchesView(view, matching, now)).toBe(true);
    }
  });
});
