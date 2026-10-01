import { baseFieldValue, baseValueText, type BaseChartConfig, type BaseComputedValues, type BaseFolder, type BaseNote } from './base-engine';
import type { PropertyValue } from './vault-domain';

export interface ChartSeriesRow { label: string; value: number; count: number }
export interface ChartPoint { label: string; x: number; y: number; noteId: string }
export interface BaseChartResult {
  rows: ChartSeriesRow[];
  points: ChartPoint[];
  number: number | null;
  totalNotes: number;
  usedNotes: number;
  omitted: number;
  warning: string | null;
}

function numeric(value: PropertyValue | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() && /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/iu.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
function aggregate(values: readonly number[], operation: BaseChartConfig['aggregation']): number | null {
  if (!values.length) return null;
  if (operation === 'count') return values.length;
  if (operation === 'minimum') return values.reduce((lowest, value) => Math.min(lowest, value), Infinity);
  if (operation === 'maximum') return values.reduce((highest, value) => Math.max(highest, value), -Infinity);
  const sum = values.reduce((total, value) => total + value, 0);
  const result = operation === 'average' ? sum / values.length : sum;
  return Number.isFinite(result) ? result : null;
}
function labels(value: PropertyValue | undefined): string[] {
  const candidates = Array.isArray(value) ? value.map(baseValueText) : [baseValueText(value)];
  const unique = [...new Set(candidates.map((item) => item.trim()).filter(Boolean))];
  return unique.length ? unique : ['Unassigned'];
}

/** Computes chart data from already filtered Base rows; neither Markdown nor properties are modified. */
export function buildBaseChart(notes: readonly BaseNote[], config: BaseChartConfig, folders: readonly BaseFolder[] = [], computed?: BaseComputedValues): BaseChartResult {
  const base: BaseChartResult = { rows: [], points: [], number: null, totalNotes: notes.length, usedNotes: 0, omitted: 0, warning: null };
  if (config.kind === 'number') {
    if (config.aggregation === 'count') return { ...base, number: notes.length, usedNotes: notes.length };
    if (!config.valueField) return { ...base, warning: 'Choose a numeric value field.' };
    const values = notes.map((note) => numeric(baseFieldValue(note, config.valueField!, folders, computed))).filter((value): value is number => value !== null);
    const number = aggregate(values, config.aggregation);
    return { ...base, number, usedNotes: values.length, warning: !values.length ? 'No numeric values match this chart.' : number === null ? 'The result exceeds the supported numeric range.' : null };
  }
  if (config.kind === 'scatter') {
    const all = notes.flatMap((note) => {
      const x = numeric(baseFieldValue(note, config.xField, folders, computed));
      const y = numeric(baseFieldValue(note, config.yField, folders, computed));
      return x === null || y === null ? [] : [{ label: note.title || 'Untitled note', x, y, noteId: note.id }];
    });
    const points = all.slice(0, 1000);
    return { ...base, points, usedNotes: all.length, omitted: all.length - points.length, warning: all.length ? null : 'No notes have numeric values for both axes.' };
  }
  if (config.kind === 'histogram') {
    if (!config.valueField) return { ...base, warning: 'Choose a numeric value field.' };
    const values = notes.map((note) => numeric(baseFieldValue(note, config.valueField!, folders, computed))).filter((value): value is number => value !== null);
    if (!values.length) return { ...base, warning: 'No numeric values match this chart.' };
    const min = values.reduce((lowest, value) => Math.min(lowest, value), Infinity), max = values.reduce((highest, value) => Math.max(highest, value), -Infinity);
    if (min === max) return { ...base, rows: [{ label: String(min), value: values.length, count: values.length }], usedNotes: values.length };
    const width = (max - min) / config.bins;
    const counts = Array.from({ length: config.bins }, () => 0);
    for (const value of values) counts[Math.min(config.bins - 1, Math.floor((value - min) / width))]!++;
    const rows = counts.map((count, index) => ({ label: `${Number((min + width * index).toPrecision(5))}–${Number((min + width * (index + 1)).toPrecision(5))}`, value: count, count }));
    return { ...base, rows, usedNotes: values.length };
  }
  if (config.aggregation !== 'count' && !config.valueField) return { ...base, warning: 'Choose a numeric value field.' };
  const groups = new Map<string, number[]>();
  let usedNotes = 0;
  for (const note of notes) {
    const value = config.aggregation === 'count' ? 1 : numeric(baseFieldValue(note, config.valueField!, folders, computed));
    if (value === null) continue;
    usedNotes++;
    for (const label of labels(baseFieldValue(note, config.groupField, folders, computed))) {
      const values = groups.get(label) ?? [];
      values.push(value); groups.set(label, values);
    }
  }
  const allRows = [...groups].flatMap(([label, values]) => { const value = config.aggregation === 'count' ? values.length : aggregate(values, config.aggregation); return value === null ? [] : [{ label, value, count: values.length }]; });
  const direction = config.sort.endsWith('Desc') ? -1 : 1;
  allRows.sort((a, b) => direction * (config.sort.startsWith('value') ? a.value - b.value || a.label.localeCompare(b.label, undefined, { numeric: true }) : a.label.localeCompare(b.label, undefined, { numeric: true })));
  const rows = allRows.slice(0, config.limit);
  const pieWarning = (config.kind === 'pie' || config.kind === 'donut') && rows.some((row) => row.value < 0) ? 'Pie and donut charts require nonnegative values. Review the table or choose another chart.' : null;
  return { ...base, rows, usedNotes, omitted: allRows.length - rows.length, warning: pieWarning ?? (rows.length ? null : 'No values match this chart.') };
}
