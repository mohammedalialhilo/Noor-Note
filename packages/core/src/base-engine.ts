import { z } from 'zod';
import { baseSchema, propertyTypeSchema, safeFileStem, type Base, type PropertyValue, type VaultNote } from './vault-domain';
import type { MarkdownTask } from './markdown';
import { compileFormula, type FormulaValue } from './formula-engine';

const fieldName = z.string().trim().min(1).max(100);
const optionalField = fieldName.nullable();
const dateString = z.iso.date();
export const baseViewKindSchema = z.enum(['table', 'list', 'cards', 'gallery', 'kanban', 'calendar', 'map', 'timeline', 'gantt']);
export type BaseViewKind = z.infer<typeof baseViewKindSchema>;
export const baseFilterSchema = z.object({ field: fieldName, operator: z.enum(['equals', 'contains', 'exists', 'greater', 'less']), value: z.string().max(500).default('') }).strict();
export const baseFormulaSchema = z.object({ id: z.uuid(), name: fieldName, expression: z.string().trim().min(1).max(500) }).strict();
export const baseAggregateSchema = z.object({ id: z.uuid(), operation: z.enum(['count', 'sum', 'average', 'minimum', 'maximum', 'unique']), field: fieldName.nullable(), label: fieldName }).strict();
export const baseQuerySchema = z.object({
  folderId: z.uuid().nullable().default(null), includeSubfolders: z.boolean().default(true),
  tag: z.string().max(100).nullable().default(null),
  property: baseFilterSchema.nullable().default(null),
  link: z.string().max(200).nullable().default(null),
  date: z.object({ field: fieldName, after: dateString.nullable(), before: dateString.nullable() }).strict().nullable().default(null),
  task: z.enum(['any', 'open', 'done', 'none']).default('any'),
  search: z.string().max(1000).default(''),
}).strict();
export const baseViewSchema = z.object({
  id: z.uuid(), name: z.string().trim().min(1).max(100), kind: baseViewKindSchema,
  filters: z.array(baseFilterSchema).max(20).default([]),
  sort: z.object({ field: fieldName, direction: z.enum(['asc', 'desc']) }).strict().nullable().default(null),
  groupBy: optionalField.default(null), visibleFields: z.array(fieldName).max(100).default(['title', 'tags', 'updatedAt']),
  columnOrder: z.array(fieldName).max(100).default(['title', 'tags', 'updatedAt']), columnWidths: z.record(fieldName, z.number().int().min(80).max(800)).default({}),
  fieldTypes: z.record(fieldName, propertyTypeSchema).default({}),
  fieldOptions: z.record(fieldName, z.array(z.string().trim().min(1).max(100)).max(100)).default({}),
  aggregates: z.array(baseAggregateSchema).max(20).default([]),
  kanbanLanes: z.array(z.string().trim().min(1).max(100)).max(40).default(['To do', 'In progress', 'Done']),
  card: z.object({ titleField: fieldName.default('title'), imageField: optionalField, descriptionField: optionalField, propertyFields: z.array(fieldName).max(20), size: z.enum(['compact', 'medium', 'large']) }).strict().default({ titleField: 'title', imageField: null, descriptionField: 'excerpt', propertyFields: [], size: 'medium' }),
  calendar: z.object({ dateField: fieldName, endField: optionalField, taskDateField: optionalField }).strict().default({ dateField: 'createdAt', endField: null, taskDateField: null }),
  map: z.object({ locationField: fieldName }).strict().default({ locationField: 'property:location' }),
  timeline: z.object({ startField: fieldName, endField: fieldName, groupField: optionalField }).strict().default({ startField: 'createdAt', endField: 'updatedAt', groupField: null }),
  gantt: z.object({ startField: fieldName, endField: fieldName, dependencyField: optionalField, progressField: optionalField }).strict().default({ startField: 'createdAt', endField: 'updatedAt', dependencyField: null, progressField: null }),
}).strict();
export const baseDefinitionSchema = z.object({ version: z.literal(1), query: baseQuerySchema, formulas: z.array(baseFormulaSchema).max(50).default([]), views: z.array(baseViewSchema).min(1).max(50), activeViewId: z.uuid() }).strict().refine((value) => value.views.some((view) => view.id === value.activeViewId), { message: 'Active Base view does not exist', path: ['activeViewId'] }).refine((value) => new Set(value.formulas.map((formula) => formula.name.toLocaleLowerCase())).size === value.formulas.length, { message: 'Formula names must be unique', path: ['formulas'] });
export type BaseQuery = z.infer<typeof baseQuerySchema>;
export type BaseFilter = z.infer<typeof baseFilterSchema>;
export type BaseFormula = z.infer<typeof baseFormulaSchema>;
export type BaseAggregate = z.infer<typeof baseAggregateSchema>;
export type BaseView = z.infer<typeof baseViewSchema>;
export type BaseDefinition = z.infer<typeof baseDefinitionSchema>;
export type BaseNote = Pick<VaultNote, 'id' | 'vaultId' | 'folderId' | 'path' | 'title' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'properties'> & { excerpt: string; tags: string[]; links: string[]; tasks: MarkdownTask[]; taskCount: number };
export interface BaseFolder { id: string; parentId: string | null; name: string; path: string }
export type BaseComputedValues = ReadonlyMap<string, Readonly<Record<string, FormulaValue>>>;
export function formulaField(id: string): string { return `formula:${id}`; }
export function evaluateBaseFormulas<T extends BaseNote>(notes: readonly T[], formulas: readonly BaseFormula[]): BaseComputedValues {
  const programs = formulas.map((formula) => ({ field: formulaField(formula.id), program: compileFormula(formula.expression) }));
  const values = new Map<string, Record<string, FormulaValue>>();
  for (const note of notes) {
    const fields = { title: note.title, path: note.path, createdAt: note.createdAt, updatedAt: note.updatedAt, tasks: note.tasks.length, openTasks: note.taskCount };
    const row: Record<string, FormulaValue> = {};
    for (const { field, program } of programs) row[field] = program.evaluate({ properties: note.properties, fields });
    values.set(note.id, row);
  }
  return values;
}
export function removeBaseFormula(definition: BaseDefinition, id: string): BaseDefinition {
  const field = formulaField(id);
  return baseDefinitionSchema.parse({
    ...definition,
    formulas: definition.formulas.filter((formula) => formula.id !== id),
    query: { ...definition.query, property: definition.query.property?.field === field ? null : definition.query.property, date: definition.query.date?.field === field ? null : definition.query.date },
    views: definition.views.map((view) => ({
      ...view,
      filters: view.filters.filter((filter) => filter.field !== field),
      sort: view.sort?.field === field ? null : view.sort,
      groupBy: view.groupBy === field ? null : view.groupBy,
      visibleFields: view.visibleFields.filter((item) => item !== field),
      columnOrder: view.columnOrder.filter((item) => item !== field),
      aggregates: view.aggregates.filter((item) => item.field !== field),
      card: { ...view.card, titleField: view.card.titleField === field ? 'title' : view.card.titleField, imageField: view.card.imageField === field ? null : view.card.imageField, descriptionField: view.card.descriptionField === field ? null : view.card.descriptionField, propertyFields: view.card.propertyFields.filter((item) => item !== field) },
      calendar: { dateField: view.calendar.dateField === field ? 'createdAt' : view.calendar.dateField, endField: view.calendar.endField === field ? null : view.calendar.endField, taskDateField: view.calendar.taskDateField === field ? null : view.calendar.taskDateField },
      map: { locationField: view.map.locationField === field ? 'property:location' : view.map.locationField },
      timeline: { startField: view.timeline.startField === field ? 'createdAt' : view.timeline.startField, endField: view.timeline.endField === field ? 'updatedAt' : view.timeline.endField, groupField: view.timeline.groupField === field ? null : view.timeline.groupField },
      gantt: { startField: view.gantt.startField === field ? 'createdAt' : view.gantt.startField, endField: view.gantt.endField === field ? 'updatedAt' : view.gantt.endField, dependencyField: view.gantt.dependencyField === field ? null : view.gantt.dependencyField, progressField: view.gantt.progressField === field ? null : view.gantt.progressField },
    })),
  });
}

export function newBaseView(kind: BaseViewKind, name = kind[0]!.toUpperCase() + kind.slice(1)): BaseView {
  return baseViewSchema.parse({ id: crypto.randomUUID(), name, kind, groupBy: kind === 'kanban' ? 'property:status' : null });
}
export function newBaseDefinition(): BaseDefinition {
  const view = newBaseView('table');
  return baseDefinitionSchema.parse({ version: 1, query: {}, views: [view], activeViewId: view.id });
}
export function newBase(vaultId: string, title: string, existing: Base[]): Base {
  const trimmed = title.trim();
  if (!trimmed || trimmed.length > 200) throw new Error('Enter a Base name up to 200 characters');
  const path = `/Bases/${safeFileStem(trimmed)}.base`;
  if (existing.some((base) => !base.deletedAt && base.path.toLocaleLowerCase() === path.toLocaleLowerCase())) throw new Error('A Base with this name already exists');
  const now = new Date().toISOString();
  return baseSchema.parse({ id: crypto.randomUUID(), vaultId, path, title: trimmed, definition: newBaseDefinition(), createdAt: now, updatedAt: now, deletedAt: null });
}
export function readBaseDefinition(base: Base): BaseDefinition { const definition = baseDefinitionSchema.parse(base.definition); for (const formula of definition.formulas) compileFormula(formula.expression); return definition; }
export function withBaseDefinition(base: Base, definition: BaseDefinition): Base { const parsed = baseDefinitionSchema.parse(definition); for (const formula of parsed.formulas) compileFormula(formula.expression); return baseSchema.parse({ ...base, definition: parsed, updatedAt: new Date().toISOString() }); }

export function baseFieldValue(note: BaseNote, field: string, folders: readonly BaseFolder[] = [], computed?: BaseComputedValues): PropertyValue | undefined {
  if (field.startsWith('formula:')) return computed?.get(note.id)?.[field];
  if (field === 'title') return note.title;
  if (field === 'path') return note.path;
  if (field === 'excerpt') return note.excerpt;
  if (field === 'folder') return folders.find((folder) => folder.id === note.folderId)?.path ?? 'Root';
  if (field === 'tags') return note.tags;
  if (field === 'createdAt') return note.createdAt;
  if (field === 'updatedAt') return note.updatedAt;
  if (field === 'tasks') return note.tasks.length;
  if (field === 'openTasks') return note.taskCount;
  if (field.startsWith('property:')) return note.properties[field.slice(9)];
  return undefined;
}
export function baseValueText(value: PropertyValue | undefined): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.map(baseValueText).filter(Boolean).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
function matchesFilter(note: BaseNote, filter: BaseFilter, folders: readonly BaseFolder[], computed?: BaseComputedValues): boolean {
  const value = baseFieldValue(note, filter.field, folders, computed);
  const text = baseValueText(value).normalize('NFKC').toLocaleLowerCase();
  const target = filter.value.normalize('NFKC').toLocaleLowerCase();
  if (filter.operator === 'exists') return value !== undefined && value !== null && text !== '';
  if (filter.operator === 'equals') return text === target || Array.isArray(value) && value.some((item) => baseValueText(item).toLocaleLowerCase() === target);
  if (filter.operator === 'contains') return text.includes(target);
  if (filter.operator === 'greater' || filter.operator === 'less') {
    const left = Number(value), right = Number(filter.value);
    if (value === undefined || value === null || text === '' || !Number.isFinite(left) || !Number.isFinite(right)) return false;
    return filter.operator === 'greater' ? left > right : left < right;
  }
  return false;
}
function inFolder(note: BaseNote, folderId: string, nested: boolean, folders: readonly BaseFolder[]): boolean {
  if (note.folderId === folderId) return true;
  if (!nested) return false;
  const root = folders.find((folder) => folder.id === folderId);
  return Boolean(root && note.path.startsWith(`${root.path}/`));
}
export function selectBaseNotes<T extends BaseNote>(notes: readonly T[], query: BaseQuery, folders: readonly BaseFolder[] = [], searchIds?: ReadonlySet<string>, computed?: BaseComputedValues): T[] {
  if (query.search.trim() && !searchIds) return [];
  return notes.filter((note) => {
    if (note.deletedAt || query.folderId && !inFolder(note, query.folderId, query.includeSubfolders, folders)) return false;
    if (query.tag && !note.tags.some((tag) => tag.toLocaleLowerCase() === query.tag!.toLocaleLowerCase() || tag.toLocaleLowerCase().startsWith(`${query.tag!.toLocaleLowerCase()}/`))) return false;
    if (query.property && !matchesFilter(note, query.property, folders, computed)) return false;
    if (query.link && !note.links.some((link) => link.toLocaleLowerCase() === query.link!.toLocaleLowerCase() || link.toLocaleLowerCase().includes(query.link!.toLocaleLowerCase()))) return false;
    if (query.date) {
      const date = baseValueText(baseFieldValue(note, query.date.field, folders, computed)).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || query.date.after && date < query.date.after || query.date.before && date > query.date.before) return false;
    }
    if (query.task === 'open' && note.taskCount === 0 || query.task === 'done' && !note.tasks.some((task) => task.completed) || query.task === 'none' && note.tasks.length > 0) return false;
    if (query.search.trim() && !searchIds?.has(note.id)) return false;
    return true;
  });
}
export function applyBaseView<T extends BaseNote>(notes: readonly T[], view: BaseView, folders: readonly BaseFolder[] = [], computed?: BaseComputedValues): T[] {
  const filtered = notes.filter((note) => view.filters.every((filter) => matchesFilter(note, filter, folders, computed)));
  if (!view.sort) return filtered;
  const { field, direction } = view.sort;
  return filtered.sort((left, right) => {
    const a = baseFieldValue(left, field, folders, computed), b = baseFieldValue(right, field, folders, computed);
    const numeric = typeof a === 'number' && typeof b === 'number';
    const comparison = numeric ? a - b : baseValueText(a).localeCompare(baseValueText(b), undefined, { numeric: true, sensitivity: 'base' });
    return (direction === 'asc' ? 1 : -1) * comparison || left.title.localeCompare(right.title);
  });
}
export function groupBaseNotes<T extends BaseNote>(notes: readonly T[], field: string, folders: readonly BaseFolder[] = [], computed?: BaseComputedValues): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const note of notes) {
    const value = baseFieldValue(note, field, folders, computed);
    const label = Array.isArray(value) ? baseValueText(value[0]) || 'Unassigned' : baseValueText(value) || 'Unassigned';
    const group = groups.get(label) ?? [];
    group.push(note); groups.set(label, group);
  }
  return groups;
}
export function availableBaseFields(notes: readonly BaseNote[], configured: readonly string[] = []): string[] {
  const builtins = ['title', 'path', 'folder', 'tags', 'createdAt', 'updatedAt', 'tasks', 'openTasks', 'excerpt'];
  const properties = notes.flatMap((note) => Object.keys(note.properties).filter((key) => key !== 'noor_property_types' && key !== 'noor_property_options').map((key) => `property:${key}`));
  return [...new Set([...builtins, ...configured, ...properties])];
}
export interface BaseAggregateResult { id: string; label: string; value: number | string[] | null }
export function aggregateBaseNotes(notes: readonly BaseNote[], aggregates: readonly BaseAggregate[], folders: readonly BaseFolder[] = [], computed?: BaseComputedValues): BaseAggregateResult[] {
  return aggregates.map((aggregate) => {
    const values = aggregate.field ? notes.map((note) => baseFieldValue(note, aggregate.field!, folders, computed)).filter((value) => value !== undefined && value !== null && value !== '') : [];
    if (aggregate.operation === 'count') return { id: aggregate.id, label: aggregate.label, value: aggregate.field ? values.length : notes.length };
    if (aggregate.operation === 'unique') {
      const unique = new Set<string>();
      for (const value of values) for (const part of Array.isArray(value) ? value : [value]) if (typeof part === 'string' || typeof part === 'number' || typeof part === 'boolean') unique.add(String(part));
      return { id: aggregate.id, label: aggregate.label, value: [...unique].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) };
    }
    const numbers = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const result = numbers.length ? aggregate.operation === 'sum' ? numbers.reduce((sum, value) => sum + value, 0) : aggregate.operation === 'average' ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : aggregate.operation === 'minimum' ? numbers.reduce((best, value) => Math.min(best, value), Infinity) : numbers.reduce((best, value) => Math.max(best, value), -Infinity) : null;
    return { id: aggregate.id, label: aggregate.label, value: result !== null && Number.isFinite(result) ? result : null };
  });
}
export interface GeoPoint { latitude: number; longitude: number; label: string }
export function parseBaseLocation(value: PropertyValue | undefined): GeoPoint | null {
  if (typeof value === 'string') {
    const coordinates = value.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)(?:\s+(.+))?\s*$/u);
    if (coordinates) {
      const latitude = Number(coordinates[1]), longitude = Number(coordinates[2]);
      if (Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) return { latitude, longitude, label: coordinates[3] ?? value };
    }
    return null;
  }
  if (!value || Array.isArray(value) || typeof value !== 'object') return null;
  const latitude = Number(value.latitude ?? value.lat), longitude = Number(value.longitude ?? value.lng ?? value.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude, label: baseValueText(value.name ?? value.label) || `${latitude}, ${longitude}` };
}
