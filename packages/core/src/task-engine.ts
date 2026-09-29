import { z } from 'zod';
import { parseTasks } from './markdown';

export const taskPrioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);
export type TaskPriority = z.infer<typeof taskPrioritySchema>;
export const taskRecurrenceSchema = z.union([
  z.enum(['daily', 'weekdays', 'weekly', 'monthly', 'yearly']),
  z.string().regex(/^every:(?:[1-9]|[1-9]\d|[1-2]\d\d|3[0-6][0-5]):(?:days|weeks|months|years)$/u),
]);
export type TaskRecurrence = z.infer<typeof taskRecurrenceSchema>;
export interface TaskRecord {
  id: string | null;
  blockId: string | null;
  line: number;
  text: string;
  completed: boolean;
  dueDate: string | null;
  scheduledDate: string | null;
  startDate: string | null;
  completionDate: string | null;
  priority: TaskPriority;
  recurrence: TaskRecurrence | null;
  tags: string[];
  assignee: string | null;
  someday: boolean;
  issues: string[];
}
export interface TaskPatch {
  text?: string;
  completed?: boolean;
  dueDate?: string | null;
  scheduledDate?: string | null;
  startDate?: string | null;
  completionDate?: string | null;
  priority?: TaskPriority;
  recurrence?: TaskRecurrence | null;
  tags?: string[];
  assignee?: string | null;
  someday?: boolean;
}
export interface TaskSelector { id?: string | null; line: number; expectedText?: string }
export interface TaskEditResult { markdown: string; taskId: string; nextTaskId: string | null }

const linePattern = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]\s+(.*)$/u;
const idPattern = /\s*<!--\s*noor-task-id:([0-9a-fA-F-]{36})\s*-->\s*$/u;
const blockPattern = /\s+\^([A-Za-z0-9-]{1,80})\s*$/u;
const metadataPattern = /(?:^|\s)@(due|scheduled|start|done|priority|repeat|assignee)\(([^()\n]{0,100})\)/gu;
const tagPattern = /(^|\s)#([\p{L}\p{N}_]+(?:\/[\p{L}\p{N}_-]+)*)/gu;

export function taskDate(date: Date): string {
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid task date');
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function parseTaskDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

function parseTaskBody(raw: string, completed: boolean, line: number): TaskRecord {
  const blockMatch = raw.match(blockPattern);
  const withoutBlock = raw.replace(blockPattern, '');
  const idMatch = withoutBlock.match(idPattern);
  const id = idMatch && z.uuid().safeParse(idMatch[1]).success ? idMatch[1]!.toLowerCase() : null;
  const metadata: Record<string, string> = {};
  const issues: string[] = [];
  const withoutId = withoutBlock.replace(idPattern, '');
  const someday = /(?:^|\s)@someday(?:\s|$)/u.test(withoutId);
  const withoutMetadata = withoutId.replace(/(?:^|\s)@someday(?=\s|$)/gu, '').replace(metadataPattern, (whole, name: string, value: string) => {
    const valid = name === 'due' || name === 'scheduled' || name === 'start' || name === 'done' ? Boolean(parseTaskDate(value))
      : name === 'priority' ? taskPrioritySchema.safeParse(value).success
      : name === 'repeat' ? taskRecurrenceSchema.safeParse(value).success
      : Boolean(value.trim()) && value.length <= 100;
    if (!valid) { issues.push(`Invalid ${name} value`); return whole; }
    metadata[name] = value.trim();
    return '';
  });
  const tags: string[] = [];
  const text = withoutMetadata.replace(tagPattern, (_whole, before: string, tag: string) => {
    if (!tags.some((item) => item.toLocaleLowerCase() === tag.toLocaleLowerCase())) tags.push(tag);
    return before;
  }).replace(/\s+/gu, ' ').trim();
  return {
    id, blockId: blockMatch?.[1] ?? null, line, text, completed,
    dueDate: metadata.due ?? null, scheduledDate: metadata.scheduled ?? null, startDate: metadata.start ?? null,
    completionDate: metadata.done ?? null, priority: taskPrioritySchema.parse(metadata.priority ?? 'normal'),
    recurrence: metadata.repeat ? taskRecurrenceSchema.parse(metadata.repeat) : null,
    tags, assignee: metadata.assignee ?? null, someday, issues,
  };
}

/** Parse checkbox summaries without reading any other note. Unknown metadata remains visible in text. */
export function parseTaskRecords(markdown: string): TaskRecord[] {
  return parseTasks(markdown).map((task) => parseTaskBody(task.text, task.completed, task.line));
}

export function validateTaskPatch(patch: TaskPatch): void {
  if (patch.text !== undefined && (!patch.text.trim() || patch.text.length > 2_000 || /[\r\n]/u.test(patch.text))) throw new Error('Task text must be one nonempty line');
  if (patch.text !== undefined && (/(?:^|\s)@(due|scheduled|start|done|priority|repeat|assignee)\(/u.test(patch.text) || /<!--\s*noor-task-id:/u.test(patch.text) || /(?:^|\s)@someday(?:\s|$)/u.test(patch.text))) throw new Error('Put task metadata in its own fields');
  for (const value of [patch.dueDate, patch.scheduledDate, patch.startDate, patch.completionDate]) if (value !== undefined && value !== null && !parseTaskDate(value)) throw new Error('Task date must be YYYY-MM-DD');
  if (patch.priority !== undefined) taskPrioritySchema.parse(patch.priority);
  if (patch.recurrence !== undefined && patch.recurrence !== null) taskRecurrenceSchema.parse(patch.recurrence);
  if (patch.tags && (patch.tags.length > 30 || patch.tags.some((tag) => !/^[\p{L}\p{N}_]+(?:\/[\p{L}\p{N}_-]+)*$/u.test(tag)))) throw new Error('Invalid task tags');
  if (patch.assignee !== undefined && patch.assignee !== null && (!patch.assignee.trim() || patch.assignee.length > 100 || /[\r\n()]/u.test(patch.assignee))) throw new Error('Invalid assignee');
}

/** Adds portable IDs to legacy checkboxes, preserving all other Markdown bytes. */
export function ensureTaskIdsInMarkdown(markdown: string, knownIds = new Set<string>(), createId: () => string = () => crypto.randomUUID()): { markdown: string; assigned: number } {
  const newline = markdown.includes('\r\n') ? '\r\n' : '\n';
  const lines = markdown.split(/\r?\n/u);
  let assigned = 0;
  for (const task of parseTaskRecords(markdown)) {
    const current = task.id;
    if (current && !knownIds.has(current)) { knownIds.add(current); continue; }
    let id = createId();
    while (!z.uuid().safeParse(id).success || knownIds.has(id)) id = createId();
    knownIds.add(id);
    const line = lines[task.line - 1]!;
    const block = line.match(blockPattern)?.[0] ?? '';
    const head = block ? line.slice(0, -block.length) : line;
    lines[task.line - 1] = `${current ? head.replace(idPattern, ` <!-- noor-task-id:${id} -->`) : `${head.replace(/\s+$/u, '')} <!-- noor-task-id:${id} -->`}${block}`;
    assigned++;
  }
  return { markdown: assigned ? lines.join(newline) : markdown, assigned };
}

function serializeTask(task: TaskRecord, id: string): string {
  const fields = [task.text.trim()];
  for (const [name, value] of [
    ['due', task.dueDate], ['scheduled', task.scheduledDate], ['start', task.startDate], ['done', task.completionDate],
    ['priority', task.priority === 'normal' ? null : task.priority], ['repeat', task.recurrence], ['assignee', task.assignee],
  ]) if (value) fields.push(`@${name}(${value})`);
  for (const tag of task.tags) fields.push(`#${tag}`);
  if (task.someday) fields.push('@someday');
  fields.push(`<!-- noor-task-id:${id} -->`);
  if (task.blockId) fields.push(`^${task.blockId}`);
  return fields.join(' ');
}

const addDays = (date: Date, amount: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
const dayNumber = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
function addMonths(anchor: Date, amount: number): Date {
  const first = new Date(anchor.getFullYear(), anchor.getMonth() + amount, 1);
  return new Date(first.getFullYear(), first.getMonth(), Math.min(anchor.getDate(), new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()));
}

export function nextRecurringDate(recurrence: TaskRecurrence, anchor: Date, completedAt: Date): Date {
  taskRecurrenceSchema.parse(recurrence);
  if (!Number.isFinite(anchor.getTime()) || !Number.isFinite(completedAt.getTime())) throw new Error('Invalid recurrence date');
  const custom = /^every:(\d+):(days|weeks|months|years)$/u.exec(recurrence);
  const count = custom ? Number(custom[1]) : 1;
  const unit = custom?.[2] ?? (recurrence === 'daily' || recurrence === 'weekdays' ? 'days' : recurrence === 'weekly' ? 'weeks' : recurrence === 'monthly' ? 'months' : 'years');
  const target = dayNumber(completedAt);
  if (recurrence === 'weekdays') {
    let next = addDays(anchor, Math.max(1, Math.floor(target - dayNumber(anchor)) + 1));
    while (next.getDay() === 0 || next.getDay() === 6) next = addDays(next, 1);
    return next;
  }
  if (unit === 'days' || unit === 'weeks') {
    const interval = count * (unit === 'weeks' ? 7 : 1);
    const steps = Math.max(1, Math.floor((target - dayNumber(anchor)) / interval) + 1);
    return addDays(anchor, interval * steps);
  }
  for (let step = 1; step <= 120_000; step++) {
    const next = addMonths(anchor, step * count * (unit === 'years' ? 12 : 1));
    if (dayNumber(next) > target) return next;
  }
  throw new Error('Recurrence exceeds supported date range');
}

/** Applies a dashboard edit to the canonical Markdown line, assigning a portable ID on first edit. */
export function updateTaskMarkdown(markdown: string, selector: TaskSelector, patch: TaskPatch, now = new Date()): TaskEditResult {
  validateTaskPatch(patch);
  const tasks = parseTaskRecords(markdown);
  const matches = selector.id ? tasks.filter((task) => task.id === selector.id) : tasks.filter((task) => task.line === selector.line);
  if (matches.length > 1) throw new Error('Duplicate task ID. Assign task IDs before editing.');
  const source = matches[0];
  if (!source || selector.expectedText !== undefined && source.text !== selector.expectedText) throw new Error('Task changed in its source note. Refresh the dashboard.');
  const newline = markdown.includes('\r\n') ? '\r\n' : '\n';
  const lines = markdown.split(/\r?\n/u);
  const rawLine = lines[source.line - 1];
  const match = rawLine?.match(linePattern);
  if (!match) throw new Error('Task line is unavailable');
  const id = source.id ?? crypto.randomUUID();
  const completionChanged = patch.completed !== undefined && patch.completed !== source.completed;
  const next: TaskRecord = {
    ...source, ...patch, id,
    text: patch.text?.trim() ?? source.text,
    tags: patch.tags ? [...new Set(patch.tags)] : source.tags,
    assignee: patch.assignee?.trim() || null,
    completionDate: patch.completionDate !== undefined ? patch.completionDate : completionChanged ? patch.completed ? taskDate(now) : null : source.completionDate,
  };
  if (patch.assignee === undefined) next.assignee = source.assignee;
  lines[source.line - 1] = `${match[1]}[${next.completed ? 'x' : ' '}] ${serializeTask(next, id)}`;
  let nextTaskId: string | null = null;
  if (completionChanged && next.completed && next.recurrence) {
    const anchor = parseTaskDate(next.dueDate ?? '') ?? new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const due = nextRecurringDate(next.recurrence, anchor, now);
    const delta = dayNumber(due) - dayNumber(anchor);
    const shift = (value: string | null) => { const parsed = value ? parseTaskDate(value) : null; return parsed ? taskDate(addDays(parsed, delta)) : null; };
    nextTaskId = crypto.randomUUID();
    const upcoming: TaskRecord = { ...next, id: nextTaskId, blockId: null, completed: false, dueDate: taskDate(due), scheduledDate: shift(next.scheduledDate), startDate: shift(next.startDate), completionDate: null };
    lines.splice(source.line, 0, `${match[1]}[ ] ${serializeTask(upcoming, nextTaskId)}`);
  }
  return { markdown: lines.join(newline), taskId: id, nextTaskId };
}
