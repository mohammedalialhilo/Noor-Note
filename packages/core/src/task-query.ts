import { parseTaskDate, taskDate, taskPrioritySchema, type TaskRecord } from './task-engine';

export type TaskDashboardView = 'inbox' | 'today' | 'upcoming' | 'overdue' | 'scheduled' | 'someday' | 'completed';
export interface TaskListItem { noteId: string; noteTitle: string; notePath: string; task: TaskRecord }
type Predicate = (item: TaskListItem, today: string) => boolean;

export function taskMatchesView(view: TaskDashboardView, item: TaskListItem, now = new Date()): boolean {
  const task = item.task;
  const today = taskDate(now);
  if (view === 'completed') return task.completed;
  if (task.completed) return false;
  switch (view) {
    case 'inbox': return !task.dueDate && !task.scheduledDate && !task.startDate && !task.someday;
    case 'today': return task.dueDate === today || task.scheduledDate === today || task.startDate === today;
    case 'upcoming': return Boolean(task.dueDate && task.dueDate > today);
    case 'overdue': return Boolean(task.dueDate && task.dueDate < today);
    case 'scheduled': return Boolean(task.scheduledDate);
    case 'someday': return task.someday;
  }
}

/** All saved task queries are local predicates over note-entry summaries. */
export function compileTaskQuery(query: string): Predicate {
  if (!query.trim() || query.length > 300) throw new Error('Task query must be 1–300 characters');
  const tokens = query.match(/"[^"]+"|\S+/gu) ?? [];
  if (tokens.length > 30) throw new Error('Task query has too many terms');
  const predicates: Predicate[] = tokens.map((token) => {
    const separator = token.indexOf(':');
    if (separator < 0 || token.startsWith('"')) {
      const text = token.replace(/^"|"$/gu, '').toLocaleLowerCase();
      return (item) => `${item.task.text} ${item.noteTitle}`.toLocaleLowerCase().includes(text);
    }
    const field = token.slice(0, separator).toLocaleLowerCase();
    const value = token.slice(separator + 1);
    if (!value) throw new Error(`Missing ${field} value`);
    if (field === 'status' && ['open', 'done'].includes(value)) return (item) => item.task.completed === (value === 'done');
    if (field === 'due' && ['today', 'overdue', 'upcoming', 'none'].includes(value)) return (item, today) => value === 'none' ? !item.task.dueDate : value === 'today' ? item.task.dueDate === today : value === 'overdue' ? Boolean(item.task.dueDate && item.task.dueDate < today) : Boolean(item.task.dueDate && item.task.dueDate > today);
    if (field === 'priority' && taskPrioritySchema.safeParse(value).success) return (item) => item.task.priority === value;
    if (field === 'tag' && value.length <= 100) return (item) => item.task.tags.some((tag) => tag.toLocaleLowerCase() === value.toLocaleLowerCase());
    if (field === 'assignee' && value.length <= 100) return (item) => item.task.assignee?.toLocaleLowerCase().includes(value.toLocaleLowerCase()) ?? false;
    if (field === 'path' && value.length <= 200) return (item) => item.notePath.toLocaleLowerCase().includes(value.toLocaleLowerCase());
    if (field === 'repeat' && ['true', 'false'].includes(value)) return (item) => Boolean(item.task.recurrence) === (value === 'true');
    if (field === 'someday' && ['true', 'false'].includes(value)) return (item) => item.task.someday === (value === 'true');
    if ((field === 'before' || field === 'after') && parseTaskDate(value)) return (item) => Boolean(item.task.dueDate && (field === 'before' ? item.task.dueDate < value : item.task.dueDate > value));
    if (field === 'text' && value.length <= 100) return (item) => item.task.text.toLocaleLowerCase().includes(value.toLocaleLowerCase());
    throw new Error(`Invalid task filter: ${token}`);
  });
  return (item, today) => predicates.every((predicate) => predicate(item, today));
}

export function filterTasks(items: readonly TaskListItem[], query: string, now = new Date()): TaskListItem[] {
  const predicate = compileTaskQuery(query);
  const today = taskDate(now);
  return items.filter((item) => predicate(item, today));
}
