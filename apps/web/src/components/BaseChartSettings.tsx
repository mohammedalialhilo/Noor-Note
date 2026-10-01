'use client';

import type { Base, BaseChartConfig } from '@noor-note/core';
import styles from './BasesView.module.css';

interface Props {
  chart: BaseChartConfig; fields: string[]; formulaLabels: Readonly<Record<string, string>>;
  sourceBaseId: string; bases: Base[]; onSelectBase: (id: string) => void;
  onChange: (chart: BaseChartConfig) => void;
}
const chartKinds = ['bar', 'line', 'area', 'pie', 'donut', 'scatter', 'histogram', 'number'] as const;
const aggregations = ['count', 'sum', 'average', 'minimum', 'maximum'] as const;
const fieldName = (field: string, labels: Readonly<Record<string, string>>) => labels[field] ?? (field.startsWith('property:') ? field.slice(9) : field.startsWith('formula:') ? field : field[0]!.toUpperCase() + field.slice(1));

export function BaseChartSettings({ chart, fields, formulaLabels, sourceBaseId, bases, onSelectBase, onChange }: Props) {
  const patch = (next: Partial<BaseChartConfig>) => onChange({ ...chart, ...next });
  const grouped = ['bar', 'line', 'area', 'pie', 'donut'].includes(chart.kind);
  const needsValue = chart.kind === 'histogram' || chart.kind === 'number' && chart.aggregation !== 'count' || grouped && chart.aggregation !== 'count';
  const fieldSelect = (label: string, value: string | null, update: (field: string | null) => void, allowNone = false) => <label>{label}<select aria-label={label} value={value ?? ''} onChange={(event) => update(event.target.value || null)}>{allowNone && <option value="">None</option>}{fields.map((field) => <option key={field} value={field}>{fieldName(field, formulaLabels)}</option>)}</select></label>;
  return <div className={styles.settingsSection} aria-label="Chart configuration"><h4>Chart configuration</h4><p>The Base query and view filters choose the notes. Numeric values can come from Markdown properties or formulas.</p><div className={styles.settingsGrid}>
    <label>Source Base<select value={sourceBaseId} onChange={(event) => onSelectBase(event.target.value)}>{bases.filter((item) => !item.deletedAt).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
    <label>Chart type<select value={chart.kind} onChange={(event) => patch({ kind: event.target.value as BaseChartConfig['kind'] })}>{chartKinds.map((kind) => <option key={kind} value={kind}>{kind[0]!.toUpperCase() + kind.slice(1)}</option>)}</select></label>
    {grouped && fieldSelect('Group field', chart.groupField, (groupField) => { if (groupField) patch({ groupField }); })}
    {chart.kind !== 'scatter' && <label>Aggregation<select value={chart.kind === 'histogram' ? 'count' : chart.aggregation} disabled={chart.kind === 'histogram'} onChange={(event) => patch({ aggregation: event.target.value as BaseChartConfig['aggregation'] })}>{aggregations.map((operation) => <option key={operation} value={operation}>{operation[0]!.toUpperCase() + operation.slice(1)}</option>)}</select></label>}
    {needsValue && fieldSelect('Value field', chart.valueField, (valueField) => patch({ valueField }), true)}
    {chart.kind === 'scatter' && <>{fieldSelect('X field', chart.xField, (xField) => { if (xField) patch({ xField }); })}{fieldSelect('Y field', chart.yField, (yField) => { if (yField) patch({ yField }); })}</>}
    {chart.kind === 'histogram' && <label>Bins<input type="number" min={2} max={30} value={chart.bins} onChange={(event) => { const bins = Number(event.target.value); if (Number.isInteger(bins) && bins >= 2 && bins <= 30) patch({ bins }); }} /></label>}
    {grouped && <><label>Chart sorting<select value={chart.sort} onChange={(event) => patch({ sort: event.target.value as BaseChartConfig['sort'] })}><option value="labelAsc">Group A–Z</option><option value="labelDesc">Group Z–A</option><option value="valueAsc">Value low to high</option><option value="valueDesc">Value high to low</option></select></label><label>Maximum groups<input type="number" min={1} max={100} value={chart.limit} onChange={(event) => { const limit = Number(event.target.value); if (Number.isInteger(limit) && limit >= 1 && limit <= 100) patch({ limit }); }} /></label></>}
  </div></div>;
}
