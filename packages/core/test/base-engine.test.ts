import { describe, expect, it } from 'vitest';
import { aggregateBaseNotes, applyBaseView, baseDefinitionSchema, evaluateBaseFormulas, formulaField, groupBaseNotes, newBaseDefinition, newBaseView, parseBaseLocation, removeBaseFormula, selectBaseNotes, type BaseNote, type BaseQuery } from '../src';

const vaultId = 'bc6fb3db-93dc-4871-8ee0-48e78454f2a1';
const folderId = '90a331e7-d089-4e36-a348-83ac2f67f3ec';
const notes: BaseNote[] = [
  { id: 'da5f10c5-1ef8-43b2-9392-4ff4f7a26b88', vaultId, folderId, path: '/Projects/Alpha.md', title: 'Alpha', createdAt: '2026-01-10T00:00:00.000Z', updatedAt: '2026-03-10T00:00:00.000Z', deletedAt: null, properties: { status: 'Doing', score: 8, due: '2026-03-20' }, excerpt: 'Research', tags: ['work/research'], links: ['Beta'], tasks: [{ text: 'Draft', completed: false, line: 1 }], taskCount: 1 },
  { id: 'e9d69a18-5171-495c-bfe1-b8692494426a', vaultId, folderId, path: '/Projects/Beta.md', title: 'Beta', createdAt: '2026-01-12T00:00:00.000Z', updatedAt: '2026-03-11T00:00:00.000Z', deletedAt: null, properties: { status: 'Done', score: 3, due: '2026-04-20' }, excerpt: 'Published', tags: ['work'], links: [], tasks: [{ text: 'Publish', completed: true, line: 1 }], taskCount: 0 },
  { id: 'c0d58b78-9d74-4683-adc0-4f7e52bfdac2', vaultId, folderId: null, path: '/Gamma.md', title: 'Gamma', createdAt: '2026-01-13T00:00:00.000Z', updatedAt: '2026-03-12T00:00:00.000Z', deletedAt: '2026-03-13T00:00:00.000Z', properties: {}, excerpt: '', tags: [], links: [], tasks: [], taskCount: 0 },
];
const folders = [{ id: folderId, parentId: null, name: 'Projects', path: '/Projects' }];
const query = (patch: Partial<BaseQuery> = {}): BaseQuery => ({ folderId: null, includeSubfolders: true, tag: null, property: null, link: null, date: null, task: 'any', search: '', ...patch });

describe('Bases over Markdown note summaries', () => {
  it('combines folder, nested tag, property, link, date, task, and search filters without deleted notes', () => {
    const selected = selectBaseNotes(notes, query({ folderId, tag: 'work', property: { field: 'property:score', operator: 'greater', value: '5' }, link: 'Beta', date: { field: 'property:due', after: '2026-03-01', before: '2026-03-31' }, task: 'open', search: 'Research' }), folders, new Set([notes[0]!.id]));
    expect(selected.map((note) => note.title)).toEqual(['Alpha']);
    expect(selectBaseNotes(notes, query({ search: 'Research' }), folders)).toEqual([]);
    expect(selectBaseNotes(notes, query({ task: 'done' }), folders).map((note) => note.title)).toEqual(['Beta']);
  });

  it('applies view filters, numeric sorting, and folder grouping', () => {
    const view = { ...newBaseView('table'), filters: [{ field: 'property:status', operator: 'exists' as const, value: '' }], sort: { field: 'property:score', direction: 'asc' as const } };
    const result = applyBaseView(notes, view, folders);
    expect(result.map((note) => note.title)).toEqual(['Beta', 'Alpha']);
    expect([...groupBaseNotes(result, 'folder', folders).keys()]).toEqual(['/Projects']);
  });

  it('persists all nine view configurations and rejects an invalid active view', () => {
    const kinds = ['table', 'list', 'cards', 'gallery', 'kanban', 'calendar', 'map', 'timeline', 'gantt'] as const;
    const views = kinds.map((kind) => newBaseView(kind));
    expect(baseDefinitionSchema.parse({ ...newBaseDefinition(), views, activeViewId: views[0]!.id }).views.map((view) => view.kind)).toEqual(kinds);
    expect(views.find((view) => view.kind === 'kanban')?.groupBy).toBe('property:status');
    expect(() => baseDefinitionSchema.parse({ ...newBaseDefinition(), activeViewId: crypto.randomUUID() })).toThrow();
    const oldView = { id: crypto.randomUUID(), name: 'Legacy', kind: 'table' };
    const oldDefinition = baseDefinitionSchema.parse({ version: 1, query: {}, views: [oldView], activeViewId: oldView.id });
    expect(oldDefinition.formulas).toEqual([]);
    expect(oldDefinition.views[0]?.aggregates).toEqual([]);
  });

  it('places only valid coordinates from text or structured properties', () => {
    expect(parseBaseLocation('59.33, 18.06 Stockholm')).toMatchObject({ latitude: 59.33, longitude: 18.06 });
    expect(parseBaseLocation({ lat: -33.87, lng: 151.21, name: 'Sydney' })).toEqual({ latitude: -33.87, longitude: 151.21, label: 'Sydney' });
    expect(parseBaseLocation('Stockholm')).toBeNull();
    expect(parseBaseLocation('99, 18')).toBeNull();
  });

  it('filters, sorts, groups, and aggregates computed values without writing note properties', () => {
    const id = crypto.randomUUID(), field = formulaField(id);
    const computed = evaluateBaseFormulas(notes, [{ id, name: 'Weighted score', expression: 'score * 2' }]);
    const selected = selectBaseNotes(notes, query({ property: { field, operator: 'greater', value: '10' } }), folders, undefined, computed);
    expect(selected.map((note) => note.title)).toEqual(['Alpha']);
    const view = { ...newBaseView('table'), sort: { field, direction: 'asc' as const } };
    expect(applyBaseView(notes.slice(0, 2), view, folders, computed).map((note) => note.title)).toEqual(['Beta', 'Alpha']);
    expect([...groupBaseNotes(notes.slice(0, 2), field, folders, computed).keys()]).toEqual(['16', '6']);
    const results = aggregateBaseNotes(notes.slice(0, 2), [
      { id: crypto.randomUUID(), operation: 'count', field: null, label: 'Rows' },
      { id: crypto.randomUUID(), operation: 'sum', field, label: 'Total' },
      { id: crypto.randomUUID(), operation: 'average', field, label: 'Average' },
      { id: crypto.randomUUID(), operation: 'minimum', field, label: 'Min' },
      { id: crypto.randomUUID(), operation: 'maximum', field, label: 'Max' },
      { id: crypto.randomUUID(), operation: 'unique', field: 'property:status', label: 'Statuses' },
    ], folders, computed);
    expect(results.map((item) => item.value)).toEqual([2, 22, 11, 6, 16, ['Doing', 'Done']]);
    expect(notes[0]!.properties).not.toHaveProperty(field);
  });

  it('removes a formula and references from saved Base settings', () => {
    const id = crypto.randomUUID(), field = formulaField(id);
    const initial = newBaseDefinition();
    const definition = baseDefinitionSchema.parse({ ...initial, formulas: [{ id, name: 'Score', expression: 'score * 2' }], query: { ...initial.query, property: { field, operator: 'greater', value: '5' } }, views: [{ ...initial.views[0]!, visibleFields: ['title', field], columnOrder: ['title', field], sort: { field, direction: 'asc' }, aggregates: [{ id: crypto.randomUUID(), operation: 'sum', field, label: 'Sum' }] }] });
    const removed = removeBaseFormula(definition, id);
    expect(removed.formulas).toEqual([]);
    expect(removed.query.property).toBeNull();
    expect(removed.views[0]?.visibleFields).toEqual(['title']);
    expect(removed.views[0]?.sort).toBeNull();
    expect(removed.views[0]?.aggregates).toEqual([]);
  });
});
