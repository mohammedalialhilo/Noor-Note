'use client';

import { buildBaseChart, type BaseChartConfig, type BaseComputedValues, type BaseFolder, type BaseChartResult } from '@noor-note/core';
import type { NoteEntry } from '@noor-note/storage';
import styles from './BaseChartView.module.css';

interface Props { notes: NoteEntry[]; config: BaseChartConfig; folders: BaseFolder[]; computed?: BaseComputedValues; title: string; onOpenNote: (id: string) => void }
const palette = Array.from({ length: 6 }, (_, index) => `var(--nn-chart-${index + 1})`);
const format = (value: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value);
const plot = { left: 58, top: 22, width: 610, height: 236 };

function Cartesian({ data, kind }: { data: BaseChartResult; kind: 'bar' | 'line' | 'area' | 'histogram' }) {
  const rows = data.rows;
  const values = rows.map((row) => row.value);
  const min = Math.min(0, ...values), max = Math.max(0, ...values);
  const range = max - min || 1;
  const y = (value: number) => plot.top + (max - value) / range * plot.height;
  const zero = y(0);
  const step = plot.width / Math.max(1, rows.length);
  const points = rows.map((row, index) => ({ x: plot.left + step * (index + .5), y: y(row.value), row }));
  const line = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
  const area = points.length ? `${line} L ${points.at(-1)!.x} ${zero} L ${points[0]!.x} ${zero} Z` : '';
  return <svg className={styles.svg} viewBox="0 0 720 320" role="img" aria-hidden="true">
    <line x1={plot.left} x2={plot.left + plot.width} y1={zero} y2={zero} className={styles.axis} />
    <text x={plot.left - 8} y={plot.top + 6} textAnchor="end" className={styles.tick}>{format(max)}</text>
    <text x={plot.left - 8} y={plot.top + plot.height + 3} textAnchor="end" className={styles.tick}>{format(min)}</text>
    {(kind === 'bar' || kind === 'histogram') && points.map(({ x, y: pointY, row }, index) => <rect key={`${row.label}:${index}`} x={x - Math.max(2, step * .37)} y={Math.min(pointY, zero)} width={Math.max(4, step * .74)} height={Math.max(1, Math.abs(pointY - zero))} fill={palette[index % palette.length]}><title>{row.label}: {format(row.value)}</title></rect>)}
    {kind === 'area' && <path d={area} fill="var(--nn-chart-area)" />}
    {(kind === 'line' || kind === 'area') && <><path d={line} fill="none" stroke="var(--nn-chart-1)" strokeWidth="3" strokeLinejoin="round" />{points.map(({ x, y: pointY, row }) => <circle key={row.label} cx={x} cy={pointY} r="4" fill="var(--nn-chart-1)"><title>{row.label}: {format(row.value)}</title></circle>)}</>}
    {points.filter((_, index) => index % Math.max(1, Math.ceil(points.length / 12)) === 0).map(({ x, row }) => <text key={row.label} x={x} y="284" textAnchor="end" transform={`rotate(-35 ${x} 284)`} className={styles.tick}>{row.label.length > 17 ? `${row.label.slice(0, 15)}…` : row.label}</text>)}
  </svg>;
}

function Scatter({ data, onOpenNote }: { data: BaseChartResult; onOpenNote: (id: string) => void }) {
  const xs = data.points.map((point) => point.x), ys = data.points.map((point) => point.y);
  const xMin = Math.min(...xs), xMax = Math.max(...xs), yMin = Math.min(...ys), yMax = Math.max(...ys);
  const x = (value: number) => plot.left + (value - xMin) / (xMax - xMin || 1) * plot.width;
  const y = (value: number) => plot.top + (yMax - value) / (yMax - yMin || 1) * plot.height;
  return <svg className={styles.svg} viewBox="0 0 720 320" aria-hidden="true">
    <line x1={plot.left} x2={plot.left + plot.width} y1={plot.top + plot.height} y2={plot.top + plot.height} className={styles.axis} />
    <line x1={plot.left} x2={plot.left} y1={plot.top} y2={plot.top + plot.height} className={styles.axis} />
    {data.points.map((point) => <circle key={point.noteId} cx={x(point.x)} cy={y(point.y)} r="5" fill="var(--nn-chart-1)" className={styles.point} onClick={() => onOpenNote(point.noteId)}><title>{point.label}: {format(point.x)}, {format(point.y)}</title></circle>)}
    <text x={plot.left} y="280" className={styles.tick}>{format(xMin)}</text><text x={plot.left + plot.width} y="280" textAnchor="end" className={styles.tick}>{format(xMax)}</text>
    <text x={plot.left - 8} y={plot.top + 6} textAnchor="end" className={styles.tick}>{format(yMax)}</text><text x={plot.left - 8} y={plot.top + plot.height} textAnchor="end" className={styles.tick}>{format(yMin)}</text>
  </svg>;
}

function Circular({ data, donut }: { data: BaseChartResult; donut: boolean }) {
  const total = data.rows.reduce((sum, row) => sum + row.value, 0);
  if (total <= 0) return <p className={styles.message}>Pie and donut charts need a positive total. The table shows the values.</p>;
  const slices = data.rows.map((row, index) => ({ row, index, share: row.value / total * 100, start: data.rows.slice(0, index).reduce((sum, previous) => sum + previous.value / total * 100, 0) }));
  return <div className={styles.circular}><svg viewBox="0 0 300 300" className={styles.pie} aria-hidden="true">
    {slices.map(({ row, index, share, start }) => <circle key={row.label} cx="150" cy="150" r={donut ? 90 : 70} pathLength="100" fill="none" stroke={palette[index % palette.length]} strokeWidth={donut ? 42 : 140} strokeDasharray={`${share} ${100 - share}`} strokeDashoffset={-start} transform="rotate(-90 150 150)"><title>{row.label}: {format(row.value)}</title></circle>)}
    {donut && <text x="150" y="158" textAnchor="middle" className={styles.donutTotal}>{format(total)}</text>}
  </svg><ul className={styles.legend}>{data.rows.map((row, index) => <li key={row.label}><span style={{ background: palette[index % palette.length] }} />{row.label} · {format(row.value)}</li>)}</ul></div>;
}

export function BaseChartView({ notes, config, folders, computed, title, onOpenNote }: Props) {
  const data = buildBaseChart(notes, config, folders, computed);
  const rows = data.rows;
  const label = config.kind === 'number' ? `${config.aggregation} of ${config.valueField ?? 'notes'}` : config.kind === 'scatter' ? `${config.xField} by ${config.yField}` : config.kind === 'histogram' ? `Distribution of ${config.valueField ?? 'values'}` : `${config.aggregation} by ${config.groupField}`;
  return <section className={styles.root} aria-label={`${title} chart`}>
    <div className={styles.heading}><div><span>ANALYTICS</span><h2>{title}</h2><p>{label}</p></div><span>{data.usedNotes} of {data.totalNotes} notes represented</span></div>
    {data.warning && <p className={styles.message} role="status">{data.warning}</p>}
    {config.kind === 'number' && data.number !== null && <div className={styles.kpi}><strong>{format(data.number)}</strong><span>{label}</span></div>}
    {!data.warning && (config.kind === 'bar' || config.kind === 'line' || config.kind === 'area' || config.kind === 'histogram') && rows.length > 0 && <Cartesian data={data} kind={config.kind} />}
    {!data.warning && config.kind === 'scatter' && data.points.length > 0 && <Scatter data={data} onOpenNote={onOpenNote} />}
    {!data.warning && (config.kind === 'pie' || config.kind === 'donut') && rows.length > 0 && <Circular data={data} donut={config.kind === 'donut'} />}
    {data.omitted > 0 && <p className={styles.message}>{data.omitted} additional {config.kind === 'scatter' ? 'points' : 'groups'} are outside the display limit. Adjust the chart or Base filters to see them.</p>}
    <div className={styles.tableWrap}><table><caption>{title}: data table for {label}</caption><thead>{config.kind === 'scatter' ? <tr><th scope="col">Note</th><th scope="col">X</th><th scope="col">Y</th></tr> : <tr><th scope="col">{config.kind === 'number' ? 'Metric' : 'Group'}</th><th scope="col">Value</th>{config.kind !== 'number' && <th scope="col">Notes</th>}</tr>}</thead><tbody>{config.kind === 'scatter' ? data.points.map((point) => <tr key={point.noteId}><th scope="row"><button type="button" onClick={() => onOpenNote(point.noteId)}>{point.label}</button></th><td>{format(point.x)}</td><td>{format(point.y)}</td></tr>) : config.kind === 'number' ? <tr><th scope="row">{label}</th><td>{data.number === null ? 'No value' : format(data.number)}</td></tr> : rows.map((row) => <tr key={row.label}><th scope="row">{row.label}</th><td>{format(row.value)}</td><td>{row.count}</td></tr>)}</tbody></table></div>
  </section>;
}
