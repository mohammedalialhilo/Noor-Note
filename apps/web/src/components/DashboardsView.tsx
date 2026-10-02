'use client';

import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { applyBaseView, deriveCalendarItems, evaluateBaseFormulas, findUnlinkedMentions, readBaseDefinition, selectBaseNotes, type Base, type Bookmark, type Dashboard, type DashboardWidget, type DashboardWidgetKind, type Folder, type VaultNote } from '@noor-note/core';
import type { NoteEntry, VaultRepository } from '@noor-note/storage';
import { CalendarDays, GripVertical, LayoutDashboard, Menu, Plus, Settings2, Trash2 } from 'lucide-react';
import { useAccount } from '../auth/AuthProvider';
import { describeActivity, emptyActivityFilters, loadActivityPage, type ActivityEvent } from '../lib/activity';
import { DashboardsStore, dashboardTemplates, moveWidget, newDashboard, newWidget, patchWidget, widgetKinds, widgetLabels, type DashboardTemplate } from '../lib/dashboards';
import styles from './DashboardsView.module.css';

interface Props {
  vaultId: string; repository: VaultRepository | null; notes: NoteEntry[]; folders: Folder[]; bookmarks: Bookmark[]; recentIds: string[];
  bases: { id: string; title: string }[]; selectedNoteId: string | null; activityEnabled: boolean;
  onOpenNote: (id: string, line?: number) => void; onOpenBase: (id: string) => void;
  onNavigate: (view: 'tasks' | 'periods' | 'graph' | 'organize' | 'activity') => void;
  onOpenBookmark: (bookmark: Bookmark) => void; onOpenNavigation: (event: MouseEvent<HTMLButtonElement>) => void;
}
const today = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
function matchingBaseNotes(base: Base, notes: NoteEntry[], folders: Folder[]): NoteEntry[] | null {
  try {
    const definition = readBaseDefinition(base);
    if (definition.query.search.trim()) return null;
    const computed = evaluateBaseFormulas(notes, definition.formulas);
    const selected = selectBaseNotes(notes, definition.query, folders, undefined, computed);
    const view = definition.views.find((item) => item.id === definition.activeViewId);
    return view ? applyBaseView(selected, view, folders, computed) : selected;
  }
  catch { return null; }
}
function DashboardNameEditor({ dashboard, onSave }: { dashboard: Dashboard; onSave: (dashboard: Dashboard) => void }) {
  const [name, setName] = useState(dashboard.name);
  const commit = () => { const trimmed = name.trim(); if (trimmed && trimmed !== dashboard.name) onSave({ ...dashboard, name: trimmed, updatedAt: new Date().toISOString() }); else setName(dashboard.name); };
  return <label>Name<input value={name} maxLength={200} onChange={(event) => setName(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>;
}

function WidgetBody({ widget, notes, folders, bookmarks, recentIds, selectedNoteId, repository, vaultId, activityEnabled, onOpenNote, onOpenBase, onNavigate, onOpenBookmark }: Omit<Props, 'onOpenNavigation'> & { widget: DashboardWidget }) {
  const { client } = useAccount();
  const [scan, setScan] = useState<{ count: number; words?: number; samples?: { noteId: string; line: number; text: string }[] } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[] | null>(null);
  const [base, setBase] = useState<Base | null>(null);
  const [baseLoaded, setBaseLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => { if (widget.kind !== 'recentActivity' || !activityEnabled || !client) return; let live = true; void loadActivityPage(client, vaultId, emptyActivityFilters, 0).then((items) => { if (live) setActivity(items.slice(0, widget.limit)); }).catch((error: unknown) => { if (live) setLoadError(error instanceof Error ? error.message : 'Could not load activity.'); }); return () => { live = false; }; }, [widget.kind, widget.limit, activityEnabled, client, vaultId]);
  useEffect(() => { if (widget.kind !== 'baseView' || !widget.baseId || !repository) return; let live = true; void repository.listObjects('base', vaultId).then((items) => { if (live) { setBase(items.find((item) => item.id === widget.baseId) as Base | undefined ?? null); setBaseLoaded(true); } }).catch((error: unknown) => { if (live) setLoadError(error instanceof Error ? error.message : 'Could not load Base.'); }); return () => { live = false; }; }, [widget.kind, widget.baseId, repository, vaultId]);
  const sorted = useMemo(() => [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [notes]);
  const noteMap = useMemo(() => new Map(notes.map((note) => [note.id, note])), [notes]);
  const noteRows = (items: NoteEntry[], empty: string) => items.length ? <ul className={styles.rows}>{items.slice(0, widget.limit).map((note) => <li key={note.id}><button type="button" onClick={() => onOpenNote(note.id)}><strong>{note.title || 'Untitled note'}</strong><span>{note.path}</span></button></li>)}</ul> : <p className={styles.empty}>{empty}</p>;
  if (widget.kind === 'recentNotes') return noteRows(recentIds.map((id) => noteMap.get(id)).filter((note): note is NoteEntry => Boolean(note)), 'Open a note to see it here.');
  if (widget.kind === 'recentlyModified') return noteRows(sorted, 'Create a note to see recent changes here.');
  if (widget.kind === 'favorites') return noteRows(bookmarks.filter((item) => item.favorite && item.noteId).map((item) => noteMap.get(item.noteId!)).filter((note): note is NoteEntry => Boolean(note)), 'Favorite a note to see it here.');
  if (widget.kind === 'bookmarks') { const items = bookmarks.filter((item) => item.kind !== 'group'); return items.length ? <ul className={styles.rows}>{items.slice(0, widget.limit).map((item) => <li key={item.id}><button type="button" onClick={() => onOpenBookmark(item)}><strong>{item.title}</strong><span>{item.kind}</span></button></li>)}</ul> : <p className={styles.empty}>Add a bookmark to keep a note, search, or URL here.</p>; }
  if (widget.kind === 'tasks') { const items = notes.flatMap((note) => note.tasks.filter((task) => !task.completed).map((task) => ({ note, task }))).sort((a, b) => (a.task.dueDate ?? '9999').localeCompare(b.task.dueDate ?? '9999')); return <>{items.length ? <ul className={styles.rows}>{items.slice(0, widget.limit).map(({ note, task }) => <li key={`${note.id}:${task.id ?? task.line}`}><button type="button" onClick={() => onOpenNote(note.id, task.line)}><strong>☐ {task.text}</strong><span>{task.dueDate ? `Due ${task.dueDate} · ` : ''}{note.title}</span></button></li>)}</ul> : <p className={styles.empty}>No open tasks.</p>}<button className={styles.link} type="button" onClick={() => onNavigate('tasks')}>Open tasks</button></>; }
  if (widget.kind === 'calendar') { const items = deriveCalendarItems(notes).filter((item) => item.date >= today() && item.completed !== true).slice(0, widget.limit); return <>{items.length ? <ul className={styles.rows}>{items.map((item) => <li key={item.id}><button type="button" onClick={() => onOpenNote(item.noteId, item.line ?? undefined)}><strong>{item.title}</strong><span>{item.date} · {item.kind}</span></button></li>)}</ul> : <p className={styles.empty}>Nothing scheduled from today onward.</p>}<button className={styles.link} type="button" onClick={() => onNavigate('periods')}><CalendarDays size={14} /> Open calendar</button></>; }
  if (widget.kind === 'graphSummary') { const linked = notes.filter((note) => note.links.length > 0).length; const edges = notes.reduce((count, note) => count + note.links.length, 0); return <><div className={styles.metrics}><span><strong>{notes.length}</strong> notes</span><span><strong>{edges}</strong> outgoing references</span><span><strong>{notes.length - linked}</strong> without outgoing links</span></div><button className={styles.link} type="button" onClick={() => onNavigate('graph')}>Open graph</button></>; }
  if (widget.kind === 'aiSuggestions') { const untagged = notes.filter((note) => !note.tags.length).length; const withoutLinks = notes.filter((note) => !note.links.length).length; return <><div className={styles.metrics}><span><strong>{untagged}</strong> notes without tags</span><span><strong>{withoutLinks}</strong> notes without outgoing links</span></div><p className={styles.empty}>Local organization opportunities. AI stays disabled until configured and invoked.</p><button className={styles.link} type="button" onClick={() => onNavigate('organize')}>Review suggestions</button></>; }
  if (widget.kind === 'baseView') { if (!widget.baseId) return <p className={styles.empty}>Choose a Base in widget settings.</p>; if (!base || base.id !== widget.baseId) return <p className={styles.empty}>{loadError ?? (baseLoaded ? 'This Base no longer exists. Choose another in widget settings.' : 'Loading Base…')}</p>; const selected = matchingBaseNotes(base, notes, folders); return selected ? <>{noteRows(selected, 'No notes match this Base.')}<button className={styles.link} type="button" onClick={() => onOpenBase(base.id)}>Open {base.title}</button></> : <><p className={styles.empty}>This Base uses search syntax that needs the full Base view, or its query needs attention.</p><button className={styles.link} type="button" onClick={() => onOpenBase(base.id)}>Open {base.title}</button></>; }
  if (widget.kind === 'recentActivity') return !activityEnabled ? <><p className={styles.empty}>Shared activity appears when cloud sync is enabled.</p><button className={styles.link} type="button" onClick={() => onNavigate('activity')}>Open activity</button></> : loadError ? <p role="alert">{loadError}</p> : activity === null ? <p className={styles.empty}>Loading activity…</p> : activity.length ? <ul className={styles.rows}>{activity.map((item) => <li key={item.id}><button type="button" disabled={!item.note_id || !noteMap.has(item.note_id)} onClick={() => { if (item.note_id) onOpenNote(item.note_id); }}><strong>{describeActivity(item, item.note_id ? noteMap.get(item.note_id)?.title : undefined)}</strong><span>{new Date(item.occurred_at).toLocaleString()}</span></button></li>)}</ul> : <p className={styles.empty}>No shared activity yet.</p>;
  if (widget.kind === 'writingStatistics' || widget.kind === 'unlinkedMentions') {
    const runScan = async () => {
      if (!repository) return;
      setScanning(true); setScanError(null);
      try {
        let count = 0, words = 0;
        const samples: { noteId: string; line: number; text: string }[] = [];
        const target = selectedNoteId ? await repository.getNote(selectedNoteId) : null;
        if (widget.kind === 'unlinkedMentions' && !target) { setScan({ count: 0, samples: [] }); return; }
        for (const entry of notes) {
          const note = await repository.getNote(entry.id);
          if (!note) continue;
          if (widget.kind === 'writingStatistics') { count++; words += note.markdown.trim() ? note.markdown.trim().split(/\s+/u).length : 0; }
          else if (target && note.id !== target.id) {
            for (const mention of findUnlinkedMentions([note], target as VaultNote)) { count++; if (samples.length < widget.limit) samples.push({ noteId: note.id, line: mention.line, text: mention.preview }); }
          }
        }
        setScan({ count, words, samples });
      } catch (error) { setScanError(error instanceof Error ? error.message : 'Could not scan notes.'); }
      finally { setScanning(false); }
    };
    return <><p className={styles.empty}>{widget.kind === 'writingStatistics' ? scan ? `${scan.words?.toLocaleString()} words across ${scan.count} notes` : 'Count words across your notes on demand.' : !selectedNoteId ? 'Open a note to find its unlinked mentions.' : scan ? `${scan.count} unlinked mentions of the selected note` : 'Scan the vault for unlinked mentions of the selected note.'}</p>{scan?.samples && <ul className={styles.rows}>{scan.samples.map((sample, index) => <li key={`${sample.noteId}:${sample.line}:${index}`}><button type="button" onClick={() => onOpenNote(sample.noteId, sample.line)}>{sample.text}</button></li>)}</ul>}{scanError && <p role="alert">{scanError}</p>}<button className={styles.link} type="button" disabled={scanning || widget.kind === 'unlinkedMentions' && !selectedNoteId} onClick={() => { void runScan(); }}>{scanning ? 'Scanning…' : scan ? 'Refresh scan' : 'Scan notes'}</button></>;
  }
  return null;
}

export function DashboardsView(props: Props) {
  const { vaultId, repository, notes, folders, bookmarks, recentIds, bases, selectedNoteId, activityEnabled, onOpenNote, onOpenBase, onNavigate, onOpenBookmark, onOpenNavigation } = props;
  const store = useMemo(() => repository ? new DashboardsStore(repository, vaultId) : null, [repository, vaultId]);
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const writeQueue = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => { if (!store) return; let live = true; void store.list().then(async (items) => { if (!items.length) items = [await store.save(newDashboard(vaultId, 'Home'))]; if (live) { setDashboards(items); setActiveId(items[0]!.id); setLoaded(true); } }).catch((cause: unknown) => { if (live) { setError(cause instanceof Error ? cause.message : 'Could not load dashboards.'); setLoaded(true); } }); return () => { live = false; }; }, [store, vaultId]);
  const active = dashboards.find((item) => item.id === activeId) ?? dashboards[0] ?? null;
  const save = (dashboard: Dashboard) => { if (!store) return; setDashboards((current) => current.map((item) => item.id === dashboard.id ? dashboard : item)); writeQueue.current = writeQueue.current.catch(() => undefined).then(async () => { try { await store.save(dashboard); setError(null); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save dashboard.'); try { setDashboards(await store.list()); } catch { /* Keep the current layout visible so the user can retry. */ } } }); };
  const addTemplate = async (template: DashboardTemplate) => { if (!store) return; try { const suffix = dashboards.filter((item) => item.name.startsWith(template)).length; const created = await store.save(newDashboard(vaultId, template, suffix ? `${template} ${suffix + 1}` : template)); setDashboards((current) => [...current, created]); setActiveId(created.id); setError(null); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create dashboard.'); } };
  const remove = async () => { if (!store || !active) return; if (!window.confirm(`Delete dashboard “${active.name}”? Notes and other vault content are unaffected.`)) return; try { await writeQueue.current; await store.remove(active); const remaining = dashboards.filter((item) => item.id !== active.id); setDashboards(remaining); setActiveId(remaining[0]?.id ?? null); setError(null); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not delete dashboard.'); } };
  const drop = (event: DragEvent<HTMLElement>, targetId: string) => { event.preventDefault(); if (!active || !draggedId) return; void save(moveWidget(active, draggedId, targetId)); setDraggedId(null); };
  return <main className={styles.root} aria-label="Dashboards">
    <header className={styles.header}><button type="button" className="icon-button mobile-menu" aria-label="Open navigation" onClick={onOpenNavigation}><Menu size={20} /></button><div><span className={styles.eyebrow}>YOUR WORKSPACE</span><h1><LayoutDashboard size={25} /> Dashboards</h1><p>Arrange the information you need, from your own vault.</p></div></header>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {!loaded ? <p className={styles.empty}>Loading dashboards…</p> : <>
      <div className={styles.toolbar}><label>Dashboard<select value={active?.id ?? ''} onChange={(event) => setActiveId(event.target.value)}><option value="" disabled>Choose dashboard</option>{dashboards.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>New from template<select value="" onChange={(event) => { if (event.target.value) void addTemplate(event.target.value as DashboardTemplate); }}><option value="">Choose template…</option>{Object.keys(dashboardTemplates).map((name) => <option key={name} value={name}>{name}</option>)}</select></label><button type="button" aria-pressed={editing} onClick={() => setEditing((value) => !value)}><Settings2 size={16} /> {editing ? 'Done' : 'Customize'}</button></div>
      {active && <>{editing && <div className={styles.editBar}><DashboardNameEditor key={active.id} dashboard={active} onSave={save} /><label>Add widget<select value="" onChange={(event) => { if (event.target.value) save({ ...active, widgets: [...active.widgets, newWidget(event.target.value as DashboardWidgetKind)], updatedAt: new Date().toISOString() }); }}><option value="">Choose widget…</option>{widgetKinds.map((kind) => <option key={kind} value={kind}>{widgetLabels[kind]}</option>)}</select></label><button type="button" onClick={() => { void remove(); }}><Trash2 size={15} /> Delete dashboard</button></div>}
        <div className={styles.grid}>{active.widgets.filter((widget) => !widget.hidden).map((widget, index) => <section key={widget.id} className={styles.widget} style={{ gridColumn: `span ${widget.width}`, gridRow: `span ${widget.height}` }} aria-label={widgetLabels[widget.kind]} onDragOver={editing ? (event) => event.preventDefault() : undefined} onDrop={editing ? (event) => drop(event, widget.id) : undefined}>
          <div className={styles.widgetHeader}>{editing && <span draggable aria-label={`Drag ${widgetLabels[widget.kind]}`} className={styles.drag} onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; setDraggedId(widget.id); }} onDragEnd={() => setDraggedId(null)}><GripVertical size={17} /></span>}<h2>{widgetLabels[widget.kind]}</h2></div>
          {editing && <div className={styles.controls}><button type="button" disabled={index === 0} onClick={() => { const previous = active.widgets.filter((item) => !item.hidden)[index - 1]; if (previous) void save(moveWidget(active, widget.id, previous.id)); }}>Move earlier</button><button type="button" disabled={index === active.widgets.filter((item) => !item.hidden).length - 1} onClick={() => { const next = active.widgets.filter((item) => !item.hidden)[index + 1]; if (next) void save(moveWidget(active, widget.id, next.id)); }}>Move later</button><label>Width<select value={widget.width} onChange={(event) => { void save(patchWidget(active, widget.id, { width: Number(event.target.value) })); }}><option value="1">1 column</option><option value="2">2 columns</option></select></label><label>Height<select value={widget.height} onChange={(event) => { void save(patchWidget(active, widget.id, { height: Number(event.target.value) })); }}><option value="1">Compact</option><option value="2">Tall</option></select></label><label>Show<select value={widget.limit} onChange={(event) => { void save(patchWidget(active, widget.id, { limit: Number(event.target.value) })); }}>{[3, 5, 10, 20].map((count) => <option key={count} value={count}>{count} items</option>)}</select></label>{widget.kind === 'baseView' && <label>Base<select value={widget.baseId ?? ''} onChange={(event) => { void save(patchWidget(active, widget.id, { baseId: event.target.value || null })); }}><option value="">Select Base</option>{bases.map((base) => <option key={base.id} value={base.id}>{base.title}</option>)}</select></label>}<button type="button" onClick={() => { void save(patchWidget(active, widget.id, { hidden: true })); }}>Hide</button></div>}
          <div className={styles.widgetContent}><WidgetBody key={`${widget.id}:${widget.kind === 'unlinkedMentions' ? selectedNoteId ?? 'none' : widget.kind === 'baseView' ? widget.baseId ?? 'none' : ''}`} widget={widget} vaultId={vaultId} repository={repository} notes={notes} folders={folders} bookmarks={bookmarks} recentIds={recentIds} bases={bases} selectedNoteId={selectedNoteId} activityEnabled={activityEnabled} onOpenNote={onOpenNote} onOpenBase={onOpenBase} onNavigate={onNavigate} onOpenBookmark={onOpenBookmark} /></div>
        </section>)}</div>
        {editing && active.widgets.some((widget) => widget.hidden) && <section className={styles.hidden}><h2>Hidden widgets</h2>{active.widgets.filter((widget) => widget.hidden).map((widget) => <button key={widget.id} type="button" onClick={() => { void save(patchWidget(active, widget.id, { hidden: false })); }}><Plus size={14} /> Show {widgetLabels[widget.kind]}</button>)}</section>}
      </>}
    </>}
  </main>;
}
