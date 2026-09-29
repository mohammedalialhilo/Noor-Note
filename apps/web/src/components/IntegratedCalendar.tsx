'use client';

import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type MouseEventHandler } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, MoveRight, Plus } from 'lucide-react';
import { calendarRange, deriveCalendarItems, evaluateBaseFormulas, filterCalendarItems, parseTaskDate, readBaseDefinition, selectBaseNotes, shiftCalendarAnchor, taskDate, type Base, type CalendarEventInput, type CalendarItem, type CalendarView, type PeriodKind } from '@noor-note/core';
import { Dialog } from '@noor-note/ui';
import type { useVaultWorkspace } from '../hooks/useVaultWorkspace';
import { BasesStore } from '../lib/bases';
import { PeriodNotesView } from './PeriodNotesView';
import type { CalendarLayout } from '../lib/workspace-layout';
import styles from './IntegratedCalendar.module.css';

const viewChoices: CalendarView[] = ['month', 'week', 'day', 'agenda'];
const weekdayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const labelDate = (key: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(undefined, options).format(new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10))));
const emptyEvent = (date: string): CalendarEventInput => ({ title: '', date, endDate: null, startTime: null, endTime: null, description: '' });

interface Props {
  workspace: ReturnType<typeof useVaultWorkspace>; periodKind: PeriodKind; onPeriodKindChange: (kind: PeriodKind) => void;
  onOpenNote: (id: string, line?: number) => void; onOpenNavigation: MouseEventHandler<HTMLButtonElement>; onSettings: () => void;
  initialState?: CalendarLayout; onStateChange?: (state: CalendarLayout) => void;
}

export function IntegratedCalendar({ workspace, periodKind, onPeriodKindChange, onOpenNote, onOpenNavigation, onSettings, initialState, onStateChange }: Props) {
  const [section, setSection] = useState<'calendar' | 'periodic'>(initialState?.section ?? 'calendar');
  const [view, setView] = useState<CalendarView>(initialState?.view ?? 'month');
  const [anchor, setAnchor] = useState(() => parseTaskDate(initialState?.anchor ?? '') ?? new Date());
  const [folderId, setFolderId] = useState(initialState?.folderId ?? '');
  const [tag, setTag] = useState(initialState?.tag ?? '');
  const [property, setProperty] = useState(initialState?.property ?? '');
  const [taskStatus, setTaskStatus] = useState<'all' | 'open' | 'done'>(initialState?.taskStatus ?? 'all');
  const [baseId, setBaseId] = useState(initialState?.baseId ?? '');
  const onStateChangeRef = useRef(onStateChange);
  useEffect(() => { onStateChangeRef.current = onStateChange; }, [onStateChange]);
  useEffect(() => { onStateChangeRef.current?.({ view, anchor: taskDate(anchor), section, periodKind, folderId: folderId || null, tag: tag || null, property: property || null, taskStatus, baseId: baseId || null }); }, [view, anchor, section, periodKind, folderId, tag, property, taskStatus, baseId]);
  const [bases, setBases] = useState<Base[]>([]);
  const [baseSearchIds, setBaseSearchIds] = useState<ReadonlySet<string> | null>(null);
  const [eventOpen, setEventOpen] = useState(false);
  const [eventDraft, setEventDraft] = useState<CalendarEventInput>(() => emptyEvent(taskDate(new Date())));
  const [eventFolderId, setEventFolderId] = useState('');
  const [moving, setMoving] = useState<CalendarItem | null>(null);
  const [moveDate, setMoveDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const vault = workspace.activeVault;
  const repository = workspace.repository;
  const vaultId = vault?.id;
  useEffect(() => {
    if (!repository || !vaultId) return;
    let live = true;
    void new BasesStore(repository, vaultId).list().then((rows) => { if (live) setBases(rows.filter((item) => !item.deletedAt)); }).catch(() => { if (live) setBases([]); });
    return () => { live = false; };
  }, [repository, vaultId]);
  const selectedBase = bases.find((item) => item.id === baseId);
  const baseDefinition = selectedBase ? readBaseDefinition(selectedBase) : null;
  const baseSearch = baseDefinition?.query.search.trim() ?? '';
  const searchNotes = workspace.searchNotes;
  useEffect(() => {
    if (!baseSearch) return;
    let live = true;
    void searchNotes(baseSearch, 'relevance', workspace.notes.length).then((rows) => { if (live) setBaseSearchIds(new Set(rows.map((item) => item.id))); }).catch(() => { if (live) { setBaseSearchIds(new Set()); setMessage('Could not search the selected Base.'); } });
    return () => { live = false; };
  }, [baseSearch, searchNotes, workspace.notes]);
  const baseNoteIds = useMemo(() => {
    if (!baseDefinition) return null;
    const computed = evaluateBaseFormulas(workspace.notes, baseDefinition.formulas);
    return new Set(selectBaseNotes(workspace.notes, baseDefinition.query, workspace.folders, baseSearch ? baseSearchIds ?? undefined : undefined, computed).map((note) => note.id));
  }, [baseDefinition, baseSearch, baseSearchIds, workspace.notes, workspace.folders]);
  const allItems = useMemo(() => deriveCalendarItems(workspace.notes, vault?.settings.periodNotes.daily.folderId ?? null), [workspace.notes, vault]);
  const selectedFolder = workspace.folders.find((item) => item.id === folderId);
  const visible = filterCalendarItems(allItems, { vaultId, folderId: folderId || null, folderPath: selectedFolder?.path ?? null, tag: tag || null, property: property || null, taskStatus, baseNoteIds });
  const range = calendarRange(view, anchor);
  const byDate = new Map<string, CalendarItem[]>();
  for (const item of visible) { const group = byDate.get(item.date) ?? []; group.push(item); byDate.set(item.date, group); }
  const tags = [...new Set(allItems.flatMap((item) => item.tags))].sort((a, b) => a.localeCompare(b));
  const properties = [...new Set(allItems.filter((item) => item.kind === 'property').map((item) => item.field).filter((field): field is string => Boolean(field)))].sort();
  const today = taskDate(new Date());

  const openDaily = async (date: string) => {
    setBusy(true); setMessage(null);
    const note = await workspace.openPeriodNote('daily', new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))), true);
    setBusy(false);
    if (note) onOpenNote(note.id);
    else setMessage('Could not open or create this daily note. Check the workspace error or daily note settings.');
  };
  const openItem = (item: CalendarItem) => onOpenNote(item.noteId, item.line ?? undefined);
  const moveItem = async (item: CalendarItem, date: string) => {
    if (item.date === date) { setMoving(null); return; }
    setBusy(true); setMessage(null);
    try {
      const saved = item.kind === 'task'
        ? await workspace.updateTask(item.noteId, { id: item.taskId, line: item.line!, expectedText: item.title }, { dueDate: date })
        : item.field ? await workspace.moveCalendarDate(item.noteId, item.field, item.date, date) : undefined;
      if (!saved) throw new Error('Could not move this item. Check the workspace error and try again.');
      setMoving(null);
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : 'Could not move calendar item.'); }
    finally { setBusy(false); }
  };
  const onDrop = (event: DragEvent, date: string) => {
    event.preventDefault();
    const id = event.dataTransfer.getData('application/x-noor-calendar-item');
    const item = visible.find((candidate) => candidate.id === id);
    if (item && item.kind !== 'daily') void moveItem(item, date);
  };
  const createEvent = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage(null);
    try {
      const saved = await workspace.createCalendarEvent(eventDraft, eventFolderId || null);
      if (!saved) throw new Error('Could not create event. Check the workspace error and try again.');
      setEventOpen(false); setEventDraft(emptyEvent(taskDate(new Date()))); setMessage(`Created ${saved.title}.`);
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : 'Could not create event.'); }
    finally { setBusy(false); }
  };
  const itemRow = (item: CalendarItem) => <div key={item.id} className={`${styles.item} ${styles[item.kind]} ${item.completed ? styles.completed : ''}`}>
    <button type="button" draggable={item.kind !== 'daily'} onDragStart={(event) => event.dataTransfer.setData('application/x-noor-calendar-item', item.id)} onClick={() => openItem(item)} title={`${item.kind}: ${item.title}`}>{item.kind === 'task' ? '☑' : item.kind === 'daily' ? '◈' : item.kind === 'event' ? '●' : '◇'} {item.title}</button>
    {item.kind !== 'daily' && <button type="button" className={styles.moveButton} aria-label={`Change date for ${item.title}`} onClick={() => { setMoving(item); setMoveDate(item.date); }}><MoveRight size={13} /></button>}
  </div>;
  const dayCell = (date: string) => <div key={date} className={`${styles.day} ${date === today ? styles.today : ''} ${view === 'month' && date.slice(0, 7) !== taskDate(anchor).slice(0, 7) ? styles.outside : ''}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => onDrop(event, date)}>
    <button type="button" className={styles.dayButton} onClick={() => { void openDaily(date); }} disabled={busy} aria-label={`Open or create daily note for ${date}`}>{labelDate(date, { weekday: view === 'month' ? undefined : 'short', day: 'numeric', month: view === 'month' ? undefined : 'short' })}</button>
    {(byDate.get(date) ?? []).map(itemRow)}
    {view !== 'month' && (byDate.get(date) ?? []).length === 0 && <span className={styles.noItems}>No items</span>}
  </div>;

  if (section === 'periodic') return <div className={styles.periodic}><button type="button" className={styles.back} onClick={() => setSection('calendar')}>← Back to calendar</button><PeriodNotesView workspace={workspace} kind={periodKind} onKindChange={onPeriodKindChange} onOpenNote={onOpenNote} onOpenNavigation={onOpenNavigation} onSettings={onSettings} /></div>;
  return <main className={styles.page}>
    <header className={styles.topbar}><button type="button" className={styles.mobileMenu} onClick={onOpenNavigation} aria-label="Open navigation">☰</button><CalendarDays size={19} /><strong>Calendar</strong><button type="button" onClick={() => setSection('periodic')}>Periodic notes</button></header>
    <div className={styles.content}>
      <div className={styles.heading}><div><p className={styles.eyebrow}>YOUR TIME, IN ONE PLACE</p><h1>Calendar</h1><p>Tasks, daily notes, dated properties, and events from your vault.</p></div><button type="button" className={styles.primary} onClick={() => { setEventDraft(emptyEvent(taskDate(anchor))); setEventOpen(true); }}><Plus size={16} /> New event</button></div>
      <div className={styles.controls}><div className={styles.navigation}><button type="button" aria-label={`Previous ${view}`} onClick={() => setAnchor(shiftCalendarAnchor(view, anchor, -1))}><ChevronLeft size={18} /></button><button type="button" onClick={() => setAnchor(new Date())}>Today</button><button type="button" aria-label={`Next ${view}`} onClick={() => setAnchor(shiftCalendarAnchor(view, anchor, 1))}><ChevronRight size={18} /></button><strong>{labelDate(taskDate(anchor), view === 'month' ? { month: 'long', year: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })}</strong></div><div className={styles.views} role="group" aria-label="Calendar view">{viewChoices.map((choice) => <button key={choice} type="button" aria-pressed={view === choice} onClick={() => setView(choice)}>{choice}</button>)}</div></div>
      <div className={styles.filters} aria-label="Calendar filters"><label>Vault<select value={vaultId ?? ''} onChange={(event) => { if (event.target.value) void workspace.switchVault(event.target.value); }}>{workspace.vaults.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Folder<select value={folderId} onChange={(event) => setFolderId(event.target.value)}><option value="">All folders</option>{workspace.folders.map((item) => <option key={item.id} value={item.id}>{item.path}</option>)}</select></label><label>Tag<select value={tag} onChange={(event) => setTag(event.target.value)}><option value="">All tags</option>{tags.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label>Date property<select value={property} onChange={(event) => setProperty(event.target.value)}><option value="">All sources</option>{properties.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label>Task status<select value={taskStatus} onChange={(event) => setTaskStatus(event.target.value as typeof taskStatus)}><option value="all">All tasks</option><option value="open">Open tasks</option><option value="done">Completed tasks</option></select></label><label>Base<select value={baseId} onChange={(event) => { setBaseId(event.target.value); setBaseSearchIds(null); }}><option value="">All notes</option>{bases.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label></div>
      {message && <p role="status" className={styles.message}>{message}</p>}
      {view === 'month' && <div className={styles.weekdays}>{weekdayLabels.map((day) => <strong key={day}>{day}</strong>)}</div>}
      {view === 'agenda' ? <div className={styles.agenda}>{range.filter((date) => (byDate.get(date) ?? []).length > 0).map((date) => <section key={date}><button type="button" onClick={() => { void openDaily(date); }}>{labelDate(date, { weekday: 'long', month: 'long', day: 'numeric' })}</button><div>{(byDate.get(date) ?? []).map(itemRow)}</div></section>)}{!range.some((date) => (byDate.get(date) ?? []).length) && <p>No dated items in the next 30 days.</p>}</div> : <div className={`${styles.grid} ${view === 'month' ? styles.month : view === 'week' ? styles.week : styles.single}`}>{range.map(dayCell)}</div>}
      <p className={styles.hint}>Select a date to open or create its daily note. Drag an item to another date, or use its Change date button.</p>
    </div>
    <Dialog title="New event" description="Events are portable Markdown notes with date properties." open={eventOpen} onOpenChange={setEventOpen} contentClassName={styles.dialog}><form className={styles.form} onSubmit={(event) => { void createEvent(event); }}><label>Title<input value={eventDraft.title} onChange={(event) => setEventDraft({ ...eventDraft, title: event.target.value })} required maxLength={200} /></label><label>Date<input type="date" value={eventDraft.date} onChange={(event) => setEventDraft({ ...eventDraft, date: event.target.value })} required /></label><label>End date<input type="date" value={eventDraft.endDate ?? ''} onChange={(event) => setEventDraft({ ...eventDraft, endDate: event.target.value || null })} /></label><label>Start time<input type="time" value={eventDraft.startTime ?? ''} onChange={(event) => setEventDraft({ ...eventDraft, startTime: event.target.value || null })} /></label><label>End time<input type="time" value={eventDraft.endTime ?? ''} onChange={(event) => setEventDraft({ ...eventDraft, endTime: event.target.value || null })} /></label><label>Folder<select value={eventFolderId} onChange={(event) => setEventFolderId(event.target.value)}><option value="">Vault root</option>{workspace.folders.map((item) => <option key={item.id} value={item.id}>{item.path}</option>)}</select></label><label className={styles.full}>Details<textarea value={eventDraft.description} onChange={(event) => setEventDraft({ ...eventDraft, description: event.target.value })} maxLength={20000} rows={4} /></label><button type="submit" className={styles.primary} disabled={busy}>Create event</button></form></Dialog>
    <Dialog title="Change date" description={moving ? `${moving.title} · ${moving.path}` : undefined} open={Boolean(moving)} onOpenChange={(open) => { if (!open) setMoving(null); }} contentClassName={styles.dialog}><form className={styles.form} onSubmit={(event) => { event.preventDefault(); if (moving) void moveItem(moving, moveDate); }}><label>Date<input type="date" value={moveDate} onChange={(event) => setMoveDate(event.target.value)} required /></label><button type="submit" className={styles.primary} disabled={busy}>Save date</button></form></Dialog>
  </main>;
}
