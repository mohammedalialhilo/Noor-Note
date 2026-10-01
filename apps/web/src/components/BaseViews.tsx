'use client';

import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react';
import Image from 'next/image';
import { ArrowDown, ArrowUp, FileText, GripVertical, Image as ImageIcon, Pencil, Trash2 } from 'lucide-react';
import { baseFieldValue, baseValueText, groupBaseNotes, parseBaseLocation, type BaseComputedValues, type BaseFolder, type BaseView } from '@noor-note/core';
import type { Attachment } from '@noor-note/core';
import type { NoteEntry, VaultRepository } from '@noor-note/storage';
import { previewImageTypes, safeAttachmentPreview } from '../lib/safe-attachment-preview';
import styles from './BasesView.module.css';
import { BaseChartView } from './BaseChartView';

export interface BaseViewActions {
  onOpen: (id: string) => void;
  onPatchView: (patch: Partial<BaseView>) => Promise<void>;
  onEdit: (note: NoteEntry, field: string, input: string) => Promise<boolean>;
  onMoveGroup: (note: NoteEntry, field: string, from: string, to: string) => Promise<boolean>;
  onBulkEdit: (ids: string[], field: string, input: string) => Promise<boolean>;
  onBulkTrash: (ids: string[]) => Promise<boolean>;
}
interface Props extends BaseViewActions { notes: NoteEntry[]; view: BaseView; fields: string[]; folders: BaseFolder[]; attachments: Attachment[]; repository: VaultRepository | null; computed?: BaseComputedValues; formulaLabels?: Readonly<Record<string, string>> }
const label = (field: string, formulaLabels?: Readonly<Record<string, string>>) => formulaLabels?.[field] ?? (field.startsWith('property:') ? field.slice(9) : ({ createdAt: 'Created', updatedAt: 'Updated', openTasks: 'Open tasks' } as Record<string, string>)[field] ?? field[0]!.toUpperCase() + field.slice(1));
const value = (note: NoteEntry, field: string, folders: BaseFolder[], computed?: BaseComputedValues) => baseValueText(baseFieldValue(note, field, folders, computed));
const dateOf = (note: NoteEntry, field: string | null, folders: BaseFolder[], computed?: BaseComputedValues): string | null => {
  if (!field) return null;
  const text = value(note, field, folders, computed).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/u.test(text) && Number.isFinite(Date.parse(`${text}T00:00:00Z`)) && new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) === text ? text : null;
};
function formatDate(text: string): string { const date = new Date(text); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date) : text; }

function EditableCell({ note, field, folders, computed, formulaLabels, onEdit, onOpen }: { note: NoteEntry; field: string; folders: BaseFolder[]; computed?: BaseComputedValues; formulaLabels?: Readonly<Record<string, string>>; onEdit: BaseViewActions['onEdit']; onOpen: BaseViewActions['onOpen'] }) {
  const current = value(note, field, folders, computed);
  const editable = field === 'title' || field.startsWith('property:');
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState(current);
  const [error, setError] = useState(false);
  const save = async () => { if (input === current) { setEditing(false); return; } if (await onEdit(note, field, input)) { setEditing(false); setError(false); } else setError(true); };
  if (editing) return <form className={styles.cellForm} onSubmit={(event) => { event.preventDefault(); void save(); }}><input autoFocus aria-label={`Edit ${label(field, formulaLabels)} for ${note.title}`} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { setEditing(false); setInput(current); } }} /><button type="submit">Save</button>{error && <small role="alert">Could not save</small>}</form>;
  if (field === 'title') return <span className={styles.titleCell}><button type="button" className={styles.cellLink} onClick={() => onOpen(note.id)}>{current || 'Untitled note'}</button><button type="button" aria-label={`Rename ${note.title}`} className={styles.renameCell} onClick={() => { setInput(current); setEditing(true); }}><Pencil size={12} /></button></span>;
  return <button type="button" className={styles.cellValue} disabled={!editable} aria-label={editable ? `Edit ${label(field, formulaLabels)} for ${note.title}` : undefined} onClick={() => { setInput(current); setEditing(true); }}>{current || (editable ? 'Add value' : '—')}</button>;
}

function TableView({ notes, view, fields, folders, computed, formulaLabels, onOpen, onPatchView, onEdit, onBulkEdit, onBulkTrash }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [widths, setWidths] = useState(view.columnWidths);
  const editableFields = fields.filter((field) => field.startsWith('property:'));
  const [bulkField, setBulkField] = useState(editableFields[0] ?? '');
  const [bulkInput, setBulkInput] = useState('');
  const columns = [...new Set([...view.columnOrder, ...fields])].filter((field) => view.visibleFields.includes(field));
  const groups = view.groupBy ? groupBaseNotes(notes, view.groupBy, folders, computed) : new Map([['', notes]]);
  const toggle = (id: string) => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const startResize = (event: ReactPointerEvent<HTMLSpanElement>, field: string) => {
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX, original = widths[field] ?? 170;
    const move = (next: PointerEvent) => setWidths((current) => ({ ...current, [field]: Math.min(800, Math.max(80, original + next.clientX - startX)) }));
    const finish = (next: PointerEvent) => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); void onPatchView({ columnWidths: { ...widths, [field]: Math.min(800, Math.max(80, original + next.clientX - startX)) } }); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish, { once: true });
  };
  const reorder = (source: string, target: string, after = false) => { if (source === target) return; const next = [...new Set([...view.columnOrder, ...fields])].filter((field) => field !== source); const index = next.indexOf(target); if (index < 0) return; next.splice(index + (after ? 1 : 0), 0, source); void onPatchView({ columnOrder: next }); };
  const toggleSort = (field: string) => void onPatchView({ sort: view.sort?.field === field ? view.sort.direction === 'asc' ? { field, direction: 'desc' } : null : { field, direction: 'asc' } });
  const selectedIds = [...selected].filter((id) => notes.some((note) => note.id === id));
  return <div className={styles.tableArea}>
    {selectedIds.length > 0 && <div className={styles.bulkBar}><strong>{selectedIds.length} selected</strong><label>Field <select value={bulkField} onChange={(event) => setBulkField(event.target.value)}>{editableFields.map((field) => <option key={field} value={field}>{label(field, formulaLabels)}</option>)}</select></label><input aria-label="Bulk value" value={bulkInput} onChange={(event) => setBulkInput(event.target.value)} placeholder="Value; blank clears" /><button type="button" disabled={!editableFields.length} onClick={() => { void onBulkEdit(selectedIds, bulkField, bulkInput).then((okay) => { if (okay) setSelected(new Set()); }); }}>Apply to selected</button><button type="button" className={styles.danger} onClick={() => { if (window.confirm(`Move ${selectedIds.length} notes to Trash?`)) void onBulkTrash(selectedIds).then((okay) => { if (okay) setSelected(new Set()); }); }}><Trash2 size={14} /> Trash</button></div>}
    <div className={styles.tableScroll}><table className={styles.table}><caption className="sr-only">Base notes, {notes.length} results. Sort with a column heading; resize with the separator arrow keys; move columns with the adjacent buttons.</caption><thead><tr><th scope="col" className={styles.checkCell}><input type="checkbox" aria-label="Select all visible notes" checked={notes.length > 0 && selectedIds.length === notes.length} onChange={(event) => setSelected(event.target.checked ? new Set(notes.map((note) => note.id)) : new Set())} /></th>{columns.map((field, columnIndex) => <th key={field} scope="col" aria-sort={view.sort?.field === field ? view.sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'} draggable onDragStart={(event) => event.dataTransfer.setData('text/x-noor-base-column', field)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const source = event.dataTransfer.getData('text/x-noor-base-column'); if (source) reorder(source, field); }} style={{ width: widths[field] ?? 170, minWidth: widths[field] ?? 170 }}><button type="button" onClick={() => toggleSort(field)}>{label(field, formulaLabels)}{view.sort?.field === field && (view.sort.direction === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />)}</button><span className={styles.columnMove}><button type="button" aria-label={`Move ${label(field, formulaLabels)} column left`} disabled={columnIndex === 0} onClick={() => reorder(field, columns[columnIndex - 1]!)}>←</button><button type="button" aria-label={`Move ${label(field, formulaLabels)} column right`} disabled={columnIndex === columns.length - 1} onClick={() => reorder(field, columns[columnIndex + 1]!, true)}>→</button></span><span className={styles.resize} role="separator" aria-orientation="vertical" aria-valuemin={80} aria-valuemax={800} aria-valuenow={widths[field] ?? 170} aria-label={`Resize ${label(field, formulaLabels)} column`} tabIndex={0} onPointerDown={(event) => startResize(event, field)} onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); void onPatchView({ columnWidths: { ...view.columnWidths, [field]: Math.min(800, Math.max(80, (view.columnWidths[field] ?? 170) + (event.key === 'ArrowRight' ? 16 : -16))) } }); } }} /><GripVertical size={12} className={styles.grip} /></th>)}</tr></thead><tbody>{[...groups].flatMap(([group, rows]) => [view.groupBy ? <tr key={`group:${group}`} className={styles.groupRow}><td colSpan={columns.length + 1}>{group} <span>{rows.length}</span></td></tr> : null, ...rows.map((note) => <tr key={note.id}><td className={styles.checkCell}><input type="checkbox" aria-label={`Select ${note.title}`} checked={selected.has(note.id)} onChange={() => toggle(note.id)} /></td>{columns.map((field) => <td key={field} style={{ width: widths[field] ?? 170, minWidth: widths[field] ?? 170 }}><EditableCell key={`${note.id}:${field}:${value(note, field, folders, computed)}`} note={note} field={field} folders={folders} computed={computed} formulaLabels={formulaLabels} onEdit={onEdit} onOpen={onOpen} /></td>)}</tr>)])}</tbody></table></div>
  </div>;
}

function BaseImage({ note, field, computed, attachments, repository }: { note: NoteEntry; field: string | null; computed?: BaseComputedValues; attachments: Attachment[]; repository: VaultRepository | null }) {
  const reference = field ? baseValueText(baseFieldValue(note, field, [], computed)) : '';
  const attachment = attachments.find((item) => previewImageTypes.has(item.mime) && (item.id === reference || item.path === reference || item.name === reference));
  const [image, setImage] = useState<{ id: string; url: string } | null>(null);
  useEffect(() => {
    if (!attachment || !repository) return;
    let alive = true;
    let objectUrl: string | null = null;
    void repository.getAttachmentBlob(attachment.id).then(async (blob) => {
      const preview = blob ? await safeAttachmentPreview(blob, attachment.mime) : null;
      if (preview && alive) { objectUrl = URL.createObjectURL(preview); setImage({ id: attachment.id, url: objectUrl }); }
    }).catch(() => undefined);
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [attachment, repository]);
  return image && image.id === attachment?.id ? <Image unoptimized width={480} height={300} className={styles.cardImage} src={image.url} alt="" /> : <div className={styles.cardImageEmpty}><ImageIcon size={21} /></div>;
}

function CardView({ notes, view, folders, computed, formulaLabels, attachments, repository, onOpen }: Props) {
  const card = view.card;
  return <div className={`${styles.cardGrid} ${styles[`card${card.size}`] ?? ''} ${view.kind === 'gallery' ? styles.gallery : ''}`}>{notes.map((note) => <article key={note.id} className={styles.card}>
    {(view.kind === 'gallery' || card.imageField) && <BaseImage note={note} field={card.imageField} computed={computed} attachments={attachments} repository={repository} />}
    <div className={styles.cardBody}><button type="button" className={styles.cardTitle} onClick={() => onOpen(note.id)}>{value(note, card.titleField, folders, computed) || note.title || 'Untitled note'}</button><p>{card.descriptionField ? value(note, card.descriptionField, folders, computed) : note.excerpt}</p><dl>{card.propertyFields.map((field) => <div key={field}><dt>{label(field, formulaLabels)}</dt><dd>{value(note, field, folders, computed) || '—'}</dd></div>)}</dl></div>
  </article>)}</div>;
}

function KanbanView({ notes, view, folders, onOpen, onMoveGroup }: Props) {
  const field = view.groupBy ?? 'property:status';
  const groups = groupBaseNotes(notes, field, folders);
  const lanes = [...new Set([...(field === 'folder' ? ['Root', ...folders.map((folder) => folder.path)] : field === 'tags' ? ['Unassigned', ...notes.flatMap((note) => note.tags)] : [...view.kanbanLanes, 'Unassigned']), ...groups.keys()])];
  const [dragId, setDragId] = useState<string | null>(null);
  const move = async (note: NoteEntry, to: string) => { const from = [...groups].find(([, items]) => items.some((item) => item.id === note.id))?.[0] ?? 'Unassigned'; await onMoveGroup(note, field, from, to); setDragId(null); };
  return <div className={styles.kanban}>{lanes.map((lane) => <section key={lane} className={styles.lane} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const note = notes.find((item) => item.id === dragId); if (note) void move(note, lane); }}><h3>{lane}<span>{groups.get(lane)?.length ?? 0}</span></h3><div className={styles.laneCards}>{(groups.get(lane) ?? []).map((note) => <article key={note.id} draggable onDragStart={() => setDragId(note.id)} onDragEnd={() => setDragId(null)}><button type="button" onClick={() => onOpen(note.id)}>{note.title || 'Untitled note'}</button><p>{note.excerpt || note.path}</p><label>Move to <select aria-label={`Move ${note.title} to lane`} value={lane} onChange={(event) => { void move(note, event.target.value); }}>{lanes.map((option) => <option key={option} value={option}>{option}</option>)}</select></label></article>)}</div></section>)}</div>;
}

function CalendarView({ notes, view, folders, computed, onOpen }: Props) {
  const startDates = notes.map((note) => dateOf(note, view.calendar.dateField, folders, computed)).filter((date): date is string => Boolean(date));
  const [month, setMonth] = useState(() => { const first = startDates[0]; const date = first ? new Date(`${first}T12:00:00`) : new Date(); return new Date(date.getFullYear(), date.getMonth(), 1); });
  const year = month.getFullYear(), index = month.getMonth(), offset = (new Date(year, index, 1).getDay() + 6) % 7;
  const days = Array.from({ length: 42 }, (_, cell) => { const date = new Date(year, index, cell - offset + 1); return { key: date.toISOString().slice(0, 10), current: date.getMonth() === index, day: date.getDate() }; });
  const move = (step: number) => setMonth(new Date(year, index + step, 1));
  const noDate = notes.filter((note) => !dateOf(note, view.calendar.dateField, folders, computed) && (!view.calendar.taskDateField || !dateOf(note, view.calendar.taskDateField, folders, computed)));
  return <div className={styles.calendar}><div className={styles.calendarHead}><button type="button" onClick={() => move(-1)} aria-label="Previous month">←</button><h3>{new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(month)}</h3><button type="button" onClick={() => move(1)} aria-label="Next month">→</button><button type="button" onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>Today</button></div><div className={styles.calendarGrid}>{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((day) => <strong key={day}>{day}</strong>)}{days.map((day) => <div key={day.key} className={day.current ? '' : styles.outside}><span>{day.day}</span>{notes.filter((note) => { const start = dateOf(note, view.calendar.dateField, folders, computed), end = dateOf(note, view.calendar.endField, folders, computed); const task = note.tasks.length && dateOf(note, view.calendar.taskDateField, folders, computed); return start && start <= day.key && (end ?? start) >= day.key || task === day.key; }).slice(0, 5).map((note) => <button key={note.id} type="button" onClick={() => onOpen(note.id)}>{note.title || 'Untitled note'}</button>)}</div>)}</div>{noDate.length > 0 && <div className={styles.unplaced}><strong>{noDate.length} notes have no configured date.</strong>{noDate.map((note) => <button key={note.id} type="button" onClick={() => onOpen(note.id)}>{note.title}</button>)}</div>}</div>;
}

function MapView({ notes, view, folders, computed, onOpen }: Props) {
  const placed = notes.map((note) => ({ note, point: parseBaseLocation(baseFieldValue(note, view.map.locationField, folders, computed)) }));
  const unplaced = placed.filter((item) => !item.point);
  return <div className={styles.mapLayout}><div className={styles.mapGrid} role="group" aria-label="Longitude and latitude map of notes"><div className={styles.equator} /><div className={styles.prime} />{placed.flatMap(({ note, point }) => point ? <button key={note.id} type="button" className={styles.mapPin} style={{ left: `${(point.longitude + 180) / 360 * 100}%`, top: `${(90 - point.latitude) / 180 * 100}%` }} title={`${note.title}: ${point.label}`} aria-label={`Open ${note.title} at ${point.label}`} onClick={() => onOpen(note.id)}>●<span>{note.title}</span></button> : [])}<span className={styles.mapWest}>180° W</span><span className={styles.mapEast}>180° E</span></div>{unplaced.length > 0 && <div className={styles.unplaced}><strong>{unplaced.length} unplaced</strong><p>Use latitude, longitude in the location property. Place names without coordinates remain listed here while offline.</p>{unplaced.slice(0, 30).map(({ note }) => <button key={note.id} type="button" onClick={() => onOpen(note.id)}>{note.title}</button>)}</div>}</div>;
}

function RangeView({ notes, view, folders, computed, onOpen }: Props) {
  const config = view.kind === 'gantt' ? view.gantt : view.timeline;
  const startField = config.startField, endField = config.endField;
  const entries = notes.map((note) => ({ note, start: dateOf(note, startField, folders, computed), end: dateOf(note, endField, folders, computed) })).filter((item): item is { note: NoteEntry; start: string; end: string } => Boolean(item.start && item.end));
  const dates = entries.flatMap((item) => [Date.parse(`${item.start}T00:00:00Z`), Date.parse(`${item.end}T00:00:00Z`)]);
  const min = dates.reduce((value, date) => Math.min(value, date), Infinity), max = dates.reduce((value, date) => Math.max(value, date), -Infinity), span = Math.max(86_400_000, max - min);
  const groupField = view.kind === 'timeline' ? view.timeline.groupField : null;
  const groups = groupField ? groupBaseNotes(entries.map((item) => item.note), groupField, folders, computed) : new Map([['', entries.map((item) => item.note)]]);
  const missing = notes.length - entries.length;
  return <div className={styles.range}><div className={styles.rangeAxis}><span>{entries.length ? formatDate(new Date(min).toISOString()) : 'Start'}</span><span>{entries.length ? formatDate(new Date(max).toISOString()) : 'End'}</span></div>{[...groups].flatMap(([group, items]) => [groupField ? <h3 key={`group:${group}`}>{group}</h3> : null, ...items.map((note) => {
    const item = entries.find((entry) => entry.note.id === note.id)!;
    const start = Date.parse(`${item.start}T00:00:00Z`), end = Date.parse(`${item.end}T00:00:00Z`);
    const left = (start - min) / span * 100, width = Math.max(1.5, (Math.max(start, end) - start + 86_400_000) / span * 100);
    const progress = view.kind === 'gantt' && view.gantt.progressField ? Math.min(100, Math.max(0, Number(baseFieldValue(note, view.gantt.progressField, folders, computed)) || 0)) : null;
    const dependency = view.kind === 'gantt' && view.gantt.dependencyField ? value(note, view.gantt.dependencyField, folders, computed) : '';
    return <div key={note.id} className={styles.rangeRow}><button type="button" onClick={() => onOpen(note.id)}>{note.title}</button><div className={styles.rangeTrack}><span className={styles.rangeBar} style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }} title={`${item.start} to ${item.end}`}>{progress !== null && <i style={{ width: `${progress}%` }} />}</span></div>{view.kind === 'gantt' && <small>{progress ?? 0}%{dependency && ` · after ${dependency}`}</small>}</div>;
  })])}{missing > 0 && <div className={styles.unplaced}><strong>{missing} notes need valid start and end dates.</strong>{notes.filter((note) => !entries.some((entry) => entry.note.id === note.id)).map((note) => <button key={note.id} type="button" onClick={() => onOpen(note.id)}>{note.title}</button>)}</div>}</div>;
}

export function BaseViewPanel(props: Props) {
  const { notes, view, folders, computed, onOpen } = props;
  if (view.kind === 'chart') return <BaseChartView notes={notes} config={view.chart} folders={folders} computed={computed} title={view.name} onOpenNote={onOpen} />;
  if (!notes.length) return <div className={styles.empty}>No notes match this Base and view. Adjust the query or filters, or add properties to your Markdown notes.</div>;
  if (view.kind === 'table') return <TableView {...props} />;
  if (view.kind === 'cards' || view.kind === 'gallery') return <CardView {...props} />;
  if (view.kind === 'kanban') return <KanbanView {...props} />;
  if (view.kind === 'calendar') return <CalendarView {...props} />;
  if (view.kind === 'map') return <MapView {...props} />;
  if (view.kind === 'timeline' || view.kind === 'gantt') return <RangeView {...props} />;
  return <div className={styles.list}>{view.groupBy ? [...groupBaseNotes(notes, view.groupBy, folders, computed)].map(([group, items]) => <section key={group}><h3>{group} <span>{items.length}</span></h3>{items.map((note) => <button key={note.id} type="button" onClick={() => onOpen(note.id)}><FileText size={17} /><span><strong>{note.title || 'Untitled note'}</strong><small>{note.excerpt || note.path}</small></span><span>{formatDate(note.updatedAt)}</span></button>)}</section>) : notes.map((note) => <button key={note.id} type="button" onClick={() => onOpen(note.id)}><FileText size={17} /><span><strong>{note.title || 'Untitled note'}</strong><small>{note.excerpt || note.path}</small></span><span>{formatDate(note.updatedAt)}</span></button>)}</div>;
}
