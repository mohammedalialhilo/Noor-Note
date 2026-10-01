import { describe, expect, it } from 'vitest';
import { baseDefinitionSchema, buildBaseChart, defaultBaseChart, evaluateBaseFormulas, formulaField, newBaseDefinition, newBaseView, removeBaseFormula, type BaseNote } from '../src';

const vaultId = crypto.randomUUID();
const rows: BaseNote[] = [
  { id: crypto.randomUUID(), vaultId, folderId: null, path: '/A.md', title: 'A', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null, properties: { status: 'Open', amount: 10, x: 1, y: 2, tags: ['one', 'two'] }, excerpt: '', tags: ['one', 'two'], links: [], tasks: [], taskCount: 0 },
  { id: crypto.randomUUID(), vaultId, folderId: null, path: '/B.md', title: 'B', createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', deletedAt: null, properties: { status: 'Open', amount: '20', x: 2, y: 4 }, excerpt: '', tags: [], links: [], tasks: [], taskCount: 0 },
  { id: crypto.randomUUID(), vaultId, folderId: null, path: '/C.md', title: 'C', createdAt: '2026-01-03T00:00:00.000Z', updatedAt: '2026-01-03T00:00:00.000Z', deletedAt: null, properties: { status: 'Done', amount: -5, x: 3, y: 'bad' }, excerpt: '', tags: [], links: [], tasks: [], taskCount: 0 },
  { id: crypto.randomUUID(), vaultId, folderId: null, path: '/D.md', title: 'D', createdAt: '2026-01-04T00:00:00.000Z', updatedAt: '2026-01-04T00:00:00.000Z', deletedAt: null, properties: { status: 'Done', amount: 'oops' }, excerpt: '', tags: [], links: [], tasks: [], taskCount: 0 },
];

describe('Base chart engine', () => {
  it('persists a chart view with safe defaults and numeric validation', () => {
    const view = newBaseView('chart');
    expect(view.chart).toEqual(defaultBaseChart);
    expect(baseDefinitionSchema.parse({ ...newBaseDefinition(), views: [view], activeViewId: view.id }).views[0]?.kind).toBe('chart');
    expect(() => baseDefinitionSchema.parse({ ...newBaseDefinition(), views: [{ ...view, chart: { ...view.chart, bins: 0 } }], activeViewId: view.id })).toThrow();
  });

  it('aggregates numeric properties by group, applies sorting and limits, and excludes invalid numbers', () => {
    const config = { ...defaultBaseChart, groupField: 'property:status', valueField: 'property:amount', aggregation: 'sum' as const, sort: 'valueDesc' as const, limit: 1 };
    const result = buildBaseChart(rows, config);
    expect(result.rows).toEqual([{ label: 'Open', value: 30, count: 2 }]);
    expect(result.usedNotes).toBe(3);
    expect(result.omitted).toBe(1);
    expect(buildBaseChart(rows, { ...config, aggregation: 'average', limit: 10 }).rows).toEqual([{ label: 'Open', value: 15, count: 2 }, { label: 'Done', value: -5, count: 1 }]);
    expect(buildBaseChart(rows, { ...config, aggregation: 'count', sort: 'labelAsc', limit: 10 }).rows.map((row) => row.value)).toEqual([2, 2]);
  });

  it('supports multi-value tags, histograms, scatter points, and KPI numbers', () => {
    expect(buildBaseChart(rows, { ...defaultBaseChart, groupField: 'tags' }).rows.map((row) => [row.label, row.value])).toEqual([['one', 1], ['two', 1], ['Unassigned', 3]]);
    const histogram = buildBaseChart(rows, { ...defaultBaseChart, kind: 'histogram', valueField: 'property:amount', bins: 5 });
    expect(histogram.rows.reduce((sum, row) => sum + row.count, 0)).toBe(3);
    expect(histogram.usedNotes).toBe(3);
    const scatter = buildBaseChart(rows, { ...defaultBaseChart, kind: 'scatter', xField: 'property:x', yField: 'property:y' });
    expect(scatter.points.map((point) => [point.x, point.y])).toEqual([[1, 2], [2, 4]]);
    expect(buildBaseChart(rows, { ...defaultBaseChart, kind: 'number', aggregation: 'count' }).number).toBe(4);
    expect(buildBaseChart(rows, { ...defaultBaseChart, kind: 'number', aggregation: 'sum', valueField: 'property:amount' }).number).toBe(25);
  });

  it('warns when circular charts contain negative values or numeric fields are absent', () => {
    expect(buildBaseChart(rows, { ...defaultBaseChart, kind: 'pie', groupField: 'property:status', aggregation: 'sum', valueField: 'property:amount' }).warning).toMatch(/nonnegative/u);
    expect(buildBaseChart(rows, { ...defaultBaseChart, kind: 'number', aggregation: 'sum' }).warning).toMatch(/numeric value field/u);
    expect(buildBaseChart(rows, { ...defaultBaseChart, kind: 'scatter', xField: 'property:no', yField: 'property:y' }).warning).toMatch(/both axes/u);
  });

  it('uses formula results and clears chart references when a formula is deleted', () => {
    const id = crypto.randomUUID(), field = formulaField(id);
    const computed = evaluateBaseFormulas(rows, [{ id, name: 'Doubled', expression: 'amount * 2' }]);
    const result = buildBaseChart(rows, { ...defaultBaseChart, groupField: 'property:status', valueField: field, aggregation: 'sum' }, [], computed);
    expect(result.rows.find((row) => row.label === 'Open')?.value).toBe(20);
    const view = { ...newBaseView('chart'), chart: { ...defaultBaseChart, groupField: field, valueField: field, xField: field, yField: field } };
    const definition = baseDefinitionSchema.parse({ ...newBaseDefinition(), formulas: [{ id, name: 'Doubled', expression: 'amount * 2' }], views: [view], activeViewId: view.id });
    expect(removeBaseFormula(definition, id).views[0]?.chart).toMatchObject({ groupField: 'folder', valueField: null, xField: 'property:x', yField: 'property:y' });
  });
});
