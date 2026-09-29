import { z } from 'zod';
import { inferPropertyType, inspectMetadata, updateFrontmatterProperty } from './metadata';
import { parseTaskDate, taskDate, type TaskRecord } from './task-engine';
import type { PropertyValue } from './vault-domain';

export const calendarViewSchema = z.enum(['month', 'week', 'day', 'agenda']);
export type CalendarView = z.infer<typeof calendarViewSchema>;
export const calendarEventInputSchema = z.object({
  title: z.string().trim().min(1).max(200), date: z.iso.date(), endDate: z.iso.date().nullable().default(null),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u).nullable().default(null),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u).nullable().default(null),
  description: z.string().max(20_000).default(''),
}).strict().refine((value) => !value.endDate || value.endDate >= value.date, { message: 'End date must be on or after start date', path: ['endDate'] });
export type CalendarEventInput = z.infer<typeof calendarEventInputSchema>;

export interface CalendarNote {
  id: string; vaultId: string; folderId: string | null; path: string; title: string;
  properties: Record<string, PropertyValue>; tags: string[]; tasks: TaskRecord[];
}
export interface CalendarItem {
  id: string; kind: 'task' | 'daily' | 'property' | 'event'; vaultId: string; noteId: string;
  folderId: string | null; path: string; tags: string[]; date: string; title: string;
  field: string | null; taskId: string | null; line: number | null; completed: boolean | null;
}
export interface CalendarFilters {
  vaultId?: string | null; folderId?: string | null; folderPath?: string | null;
  tag?: string | null; property?: string | null; taskStatus?: 'all' | 'open' | 'done';
  baseNoteIds?: ReadonlySet<string> | null;
}
export const calendarDateValue = (value: PropertyValue | undefined): string | null => {
  if (typeof value !== 'string') return null;
  const date = value.slice(0, 10);
  return parseTaskDate(date) && (value.length === 10 || /^\d{4}-\d{2}-\d{2}T/u.test(value)) ? date : null;
};

/** Calendar records are derived from note metadata and checkbox summaries. */
export function deriveCalendarItems(notes: readonly CalendarNote[], dailyFolderId: string | null = null): CalendarItem[] {
  const items: CalendarItem[] = [];
  for (const note of notes) {
    const base = { vaultId: note.vaultId, noteId: note.id, folderId: note.folderId, path: note.path, tags: note.tags };
    const daily = note.properties.noor_period_kind === 'daily' ? calendarDateValue(note.properties.noor_period_key)
      : note.folderId === dailyFolderId ? calendarDateValue(note.title) : null;
    if (daily) items.push({ ...base, id: `daily:${note.id}`, kind: 'daily', date: daily, title: note.title, field: null, taskId: null, line: null, completed: null });
    const eventDate = note.properties.noor_event === true ? calendarDateValue(note.properties.date) : null;
    if (eventDate) {
      const time = typeof note.properties.start_time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/u.test(note.properties.start_time) ? `${note.properties.start_time} · ` : '';
      items.push({ ...base, id: `event:${note.id}`, kind: 'event', date: eventDate, title: `${time}${note.title}`, field: 'date', taskId: null, line: null, completed: null });
    }
    if (!daily && !eventDate) for (const [field, value] of Object.entries(note.properties)) {
      if (field.startsWith('noor_')) continue;
      const date = calendarDateValue(value);
      if (date) items.push({ ...base, id: `property:${note.id}:${field}`, kind: 'property', date, title: note.title, field, taskId: null, line: null, completed: null });
    }
    for (const task of note.tasks) if (task.dueDate) items.push({
      ...base, id: `task:${note.id}:${task.id ?? task.line}`, kind: 'task', date: task.dueDate, title: task.text,
      field: null, taskId: task.id, line: task.line, completed: task.completed,
      tags: [...new Set([...note.tags, ...task.tags])],
    });
  }
  return items.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

export function filterCalendarItems(items: readonly CalendarItem[], filters: CalendarFilters): CalendarItem[] {
  return items.filter((item) => {
    if (filters.vaultId && item.vaultId !== filters.vaultId) return false;
    if (filters.folderId && item.folderId !== filters.folderId && !(filters.folderPath && item.path.startsWith(`${filters.folderPath}/`))) return false;
    if (filters.tag && !item.tags.some((tag) => tag.toLocaleLowerCase() === filters.tag!.toLocaleLowerCase())) return false;
    if (filters.property && item.field !== filters.property) return false;
    if (filters.taskStatus && filters.taskStatus !== 'all' && item.kind === 'task' && item.completed !== (filters.taskStatus === 'done')) return false;
    if (filters.baseNoteIds && !filters.baseNoteIds.has(item.noteId)) return false;
    return true;
  });
}

const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
export function calendarRange(view: CalendarView, anchor: Date): string[] {
  calendarViewSchema.parse(view);
  if (!Number.isFinite(anchor.getTime())) throw new Error('Invalid calendar date');
  const start = view === 'month' ? new Date(anchor.getFullYear(), anchor.getMonth(), 1)
    : view === 'week' ? addDays(anchor, -((anchor.getDay() + 6) % 7)) : new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  if (view === 'month') start.setDate(start.getDate() - (start.getDay() + 6) % 7);
  const count = view === 'month' ? Math.ceil(((new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate() + (new Date(anchor.getFullYear(), anchor.getMonth(), 1).getDay() + 6) % 7) / 7)) * 7
    : view === 'week' ? 7 : view === 'agenda' ? 30 : 1;
  return Array.from({ length: count }, (_, index) => taskDate(addDays(start, index)));
}

export function shiftCalendarAnchor(view: CalendarView, anchor: Date, amount: number): Date {
  calendarViewSchema.parse(view);
  if (view === 'month') return new Date(anchor.getFullYear(), anchor.getMonth() + amount, 1);
  return addDays(anchor, amount * (view === 'week' ? 7 : view === 'agenda' ? 30 : 1));
}

export function calendarEventMarkdown(input: CalendarEventInput): string {
  const value = calendarEventInputSchema.parse(input);
  if (!parseTaskDate(value.date) || value.endDate && !parseTaskDate(value.endDate)) throw new Error('Invalid event date');
  let markdown = value.description.trim();
  markdown = updateFrontmatterProperty(markdown, 'noor_event', true, 'boolean');
  markdown = updateFrontmatterProperty(markdown, 'date', value.date, 'date');
  if (value.endDate) markdown = updateFrontmatterProperty(markdown, 'end_date', value.endDate, 'date');
  if (value.startTime) markdown = updateFrontmatterProperty(markdown, 'start_time', value.startTime);
  if (value.endTime) markdown = updateFrontmatterProperty(markdown, 'end_time', value.endTime);
  return markdown;
}

/** Move a structured note date, preserving datetime time and shifting event end dates. */
export function moveCalendarProperty(markdown: string, field: string, from: string, to: string): string {
  if (!parseTaskDate(from) || !parseTaskDate(to)) throw new Error('Invalid calendar date');
  const properties = inspectMetadata(markdown).values;
  const current = properties[field];
  if (calendarDateValue(current) !== from) throw new Error('The note date changed. Refresh the calendar.');
  if (typeof current !== 'string') throw new Error('Date property is unavailable');
  const nextValue = `${to}${current.slice(10)}`;
  let result = updateFrontmatterProperty(markdown, field, nextValue, inferPropertyType(current));
  if (properties.noor_event === true && field === 'date') {
    const end = calendarDateValue(properties.end_date);
    if (end) {
      const delta = (Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10))) - Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)))) / 86_400_000;
      const endValue = properties.end_date as string;
      result = updateFrontmatterProperty(result, 'end_date', `${taskDate(addDays(parseTaskDate(end)!, delta))}${endValue.slice(10)}`, inferPropertyType(endValue));
    }
  }
  return result;
}
