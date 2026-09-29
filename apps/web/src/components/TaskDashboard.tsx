'use client';

import { useEffect, useMemo, useState, type FormEvent, type MouseEventHandler } from 'react';
import { CalendarDays, CheckCircle2, Plus, Trash2 } from 'lucide-react';
import { compileTaskQuery, parseTaskDate, savedTaskViewSchema, taskMatchesView, taskPrioritySchema, taskRecurrenceSchema, validateTaskPatch, type TaskDashboardView, type TaskListItem, type TaskPatch } from '@noor-note/core';
import type { useVaultWorkspace } from '../hooks/useVaultWorkspace';
import styles from './TaskDashboard.module.css';

const views: { id: TaskDashboardView; label: string }[] = [
  { id: 'inbox', label: 'Inbox' }, { id: 'today', label: 'Today' }, { id: 'upcoming', label: 'Upcoming' },
  { id: 'overdue', label: 'Overdue' }, { id: 'scheduled', label: 'Scheduled' }, { id: 'someday', label: 'Someday' }, { id: 'completed', label: 'Completed' },
];
const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };
const recurrences = ['none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly', 'custom'] as const;

interface Props {
  workspace: ReturnType<typeof useVaultWorkspace>;
  onOpenNote: (id: string, line: number, blockId?: string | null) => void;
  onOpenNavigation: MouseEventHandler<HTMLButtonElement>;
}

function TaskEditor({ item, onSave, onCancel }: { item: TaskListItem; onSave: (patch: TaskPatch) => Promise<boolean>; onCancel: () => void }) {
  const task = item.task;
  const [text, setText] = useState(task.text);
  const [dueDate, setDueDate] = useState(task.dueDate ?? '');
  const [scheduledDate, setScheduledDate] = useState(task.scheduledDate ?? '');
  const [startDate, setStartDate] = useState(task.startDate ?? '');
  const [completionDate, setCompletionDate] = useState(task.completionDate ?? '');
  const [priority, setPriority] = useState(task.priority);
  const [recurrence, setRecurrence] = useState(task.recurrence && !recurrences.includes(task.recurrence as typeof recurrences[number]) ? 'custom' : task.recurrence ?? 'none');
  const [customRecurrence, setCustomRecurrence] = useState(task.recurrence?.startsWith('every:') ? task.recurrence : 'every:2:weeks');
  const [tags, setTags] = useState(task.tags.join(', '));
  const [assignee, setAssignee] = useState(task.assignee ?? '');
  const [someday, setSomeday] = useState(task.someday);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      for (const date of [dueDate, scheduledDate, startDate, completionDate]) if (date && !parseTaskDate(date)) throw new Error('Dates must be valid calendar dates.');
      const parsedRepeat = recurrence === 'none' ? null : taskRecurrenceSchema.safeParse(recurrence === 'custom' ? customRecurrence : recurrence);
      if (parsedRepeat && !parsedRepeat.success) throw new Error('Use a recurrence such as daily or every:3:weeks (1–365).');
      const repeat = parsedRepeat?.data ?? null;
      taskPrioritySchema.parse(priority);
      const patch: TaskPatch = { text: text.trim(), dueDate: dueDate || null, scheduledDate: scheduledDate || null, startDate: startDate || null, completionDate: completionDate || null, priority, recurrence: repeat, tags: tags.split(',').map((tag) => tag.trim().replace(/^#/u, '')).filter(Boolean), assignee: assignee.trim() || null, someday };
      validateTaskPatch(patch);
      setBusy(true); setError(null);
      const saved = await onSave(patch);
      if (!saved) throw new Error('The task could not be saved. Check the workspace error and refresh.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save task.'); }
    finally { setBusy(false); }
  };
  return <form className={styles.editor} onSubmit={(event) => { void submit(event); }}>
    <label className={styles.full}>Task text<input value={text} onChange={(event) => setText(event.target.value)} required maxLength={2000} /></label>
    <label>Due<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
    <label>Scheduled<input type="date" value={scheduledDate} onChange={(event) => setScheduledDate(event.target.value)} /></label>
    <label>Start<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
    <label>Completed on<input type="date" value={completionDate} onChange={(event) => setCompletionDate(event.target.value)} /></label>
    <label>Priority<select value={priority} onChange={(event) => setPriority(taskPrioritySchema.parse(event.target.value))}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
    <label>Recurrence<select value={recurrence} onChange={(event) => setRecurrence(event.target.value)}>{recurrences.map((value) => <option key={value} value={value}>{value === 'none' ? 'None' : value}</option>)}</select></label>
    {recurrence === 'custom' && <label className={styles.full}>Custom interval<input value={customRecurrence} onChange={(event) => setCustomRecurrence(event.target.value)} placeholder="every:3:weeks" /></label>}
    <label>Tags, separated by commas<input value={tags} onChange={(event) => setTags(event.target.value)} /></label>
    <label>Assignee<input value={assignee} onChange={(event) => setAssignee(event.target.value)} maxLength={100} /></label>
    <label className={styles.checkbox}><input type="checkbox" checked={someday} onChange={(event) => setSomeday(event.target.checked)} /> Someday</label>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.editActions}><button type="button" onClick={onCancel}>Cancel</button><button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save task'}</button></div>
  </form>;
}

function TaskRow({ item, workspace, onOpenNote }: { item: TaskListItem; workspace: ReturnType<typeof useVaultWorkspace>; onOpenNote: Props['onOpenNote'] }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const task = item.task;
  const selector = { id: task.id, line: task.line, expectedText: task.text };
  const save = async (patch: TaskPatch) => {
    setBusy(true); setError(null);
    try {
      const result = await workspace.updateTask(item.noteId, selector, patch);
      if (!result) { setError('The task could not be saved. Refresh the dashboard and try again.'); return false; }
      setEditing(false);
      return true;
    } catch { setError('The task could not be saved. Refresh the dashboard and try again.'); return false; }
    finally { setBusy(false); }
  };
  return <article className={styles.task}>
    <div className={styles.taskMain}><input type="checkbox" aria-label={`${task.completed ? 'Reopen' : 'Complete'} ${task.text}`} checked={task.completed} disabled={busy} onChange={() => { void save({ completed: !task.completed }); }} />
      <div className={styles.taskContent}><div className={styles.taskTitle}><strong className={task.completed ? styles.done : ''}>{task.text}</strong>{task.priority !== 'normal' && <span className={`${styles.priority} ${styles[task.priority]}`}>{task.priority}</span>}{task.recurrence && <span className={styles.badge}>↻ {task.recurrence}</span>}</div>
        <div className={styles.meta}>{task.dueDate && <span>Due {task.dueDate}</span>}{task.scheduledDate && <span>Scheduled {task.scheduledDate}</span>}{task.startDate && <span>Start {task.startDate}</span>}{task.assignee && <span>Assigned to {task.assignee}</span>}{task.tags.map((tag) => <span key={tag}>#{tag}</span>)}{task.issues.map((issue) => <span key={issue} className={styles.error}>{issue}</span>)}</div>
        <button type="button" className={styles.source} onClick={() => onOpenNote(item.noteId, task.line, task.blockId)}>{item.noteTitle || 'Untitled note'} · {item.notePath} · {task.blockId ? `^${task.blockId}` : `line ${task.line}`}</button>
      </div><button type="button" className={styles.editButton} onClick={() => setEditing((current) => !current)}>{editing ? 'Close editor' : 'Edit'}</button></div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {editing && <TaskEditor item={item} onSave={save} onCancel={() => setEditing(false)} />}
  </article>;
}

export function TaskDashboard({ workspace, onOpenNote, onOpenNavigation }: Props) {
  const [view, setView] = useState<TaskDashboardView | 'custom'>('inbox');
  const [query, setQuery] = useState('');
  const [viewName, setViewName] = useState('');
  const [activeSavedId, setActiveSavedId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [assigningIds, setAssigningIds] = useState(false);
  const [today, setToday] = useState(() => new Date());
  useEffect(() => {
    let timer: number;
    const schedule = () => {
      const now = new Date();
      const nextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      timer = window.setTimeout(() => { setToday(new Date()); schedule(); }, nextDay.getTime() - now.getTime() + 1000);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, []);
  const vault = workspace.activeVault;
  const items = useMemo(() => workspace.notes.flatMap((note) => note.tasks.map((task): TaskListItem => ({ noteId: note.id, noteTitle: note.title, notePath: note.path, task }))), [workspace.notes]);
  const seenIds = new Set<string>();
  const untrackedCount = items.filter((item) => { const id = item.task.id; if (!id || seenIds.has(id)) return true; seenIds.add(id); return false; }).length;
  let queryError: string | null = null;
  let predicate: ReturnType<typeof compileTaskQuery> | null = null;
  if (view === 'custom' && query.trim()) try { predicate = compileTaskQuery(query); } catch (caught) { queryError = caught instanceof Error ? caught.message : 'Invalid task query'; }
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const visible = items.filter((item) => view === 'custom' ? predicate?.(item, todayKey) ?? false : taskMatchesView(view, item, today)).sort((a, b) => priorityOrder[a.task.priority] - priorityOrder[b.task.priority] || (a.task.dueDate ?? '9999').localeCompare(b.task.dueDate ?? '9999') || a.notePath.localeCompare(b.notePath) || a.task.line - b.task.line);
  const saveView = async (event: FormEvent) => {
    event.preventDefault();
    if (!vault) return;
    try {
      compileTaskQuery(query);
      const now = new Date().toISOString();
      const saved = savedTaskViewSchema.parse({ id: crypto.randomUUID(), name: viewName.trim(), query: query.trim(), createdAt: now, updatedAt: now });
      const result = await workspace.updateVaultSettings({ taskViews: [...vault.settings.taskViews, saved] });
      if (!result) throw new Error('Could not save this task view.');
      setActiveSavedId(saved.id); setViewName(''); setMessage('Task view saved locally with this vault.');
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : 'Could not save task view.'); }
  };
  const removeView = async (id: string) => {
    if (!vault) return;
    const result = await workspace.updateVaultSettings({ taskViews: vault.settings.taskViews.filter((saved) => saved.id !== id) });
    setMessage(result ? 'Saved task view removed.' : 'Could not remove task view.');
    if (result && activeSavedId === id) { setActiveSavedId(null); setView('inbox'); }
  };
  return <main className={styles.page}>
    <header className={styles.topbar}><button type="button" className={styles.mobileMenu} aria-label="Open navigation" onClick={onOpenNavigation}>☰</button><CheckCircle2 size={19} /><span>Tasks</span><small>{items.filter((item) => !item.task.completed).length} open</small></header>
    <div className={styles.content}><p className={styles.eyebrow}>FROM YOUR MARKDOWN</p><h1>Tasks</h1><p className={styles.intro}>A view of checkboxes in your notes. Edits save back to the source Markdown.</p>
      {untrackedCount > 0 && <div className={styles.identity}><span>{untrackedCount} {untrackedCount === 1 ? 'task needs' : 'tasks need'} a portable ID for stable references. This adds small HTML comments to the source notes.</span><button type="button" disabled={assigningIds} onClick={() => { setAssigningIds(true); void workspace.assignTaskIds().then((count) => setMessage(count === undefined ? 'Could not finish assigning task IDs. Check the workspace error and retry.' : `Assigned ${count} task IDs.`)).finally(() => setAssigningIds(false)); }}>{assigningIds ? 'Assigning…' : 'Assign task IDs'}</button></div>}
      <nav className={styles.viewTabs} aria-label="Task views">{views.map((item) => <button key={item.id} type="button" aria-current={view === item.id ? 'page' : undefined} onClick={() => { setView(item.id); setActiveSavedId(null); }}>{item.label}<span>{items.filter((task) => taskMatchesView(item.id, task, today)).length}</span></button>)}<button type="button" aria-current={view === 'custom' ? 'page' : undefined} onClick={() => setView('custom')}>Custom views</button></nav>
      {view === 'custom' && <section className={styles.custom} aria-label="Custom task views"><label>Filter tasks<input value={query} onChange={(event) => { setQuery(event.target.value); setActiveSavedId(null); }} placeholder="status:open priority:high tag:work" /></label><p>Filters: status, due, priority, tag, assignee, path, repeat, someday, before, after, and text. Plain words search task and note titles.</p>{queryError && <p role="alert" className={styles.error}>{queryError}</p>}
        <form onSubmit={(event) => { void saveView(event); }}><label>View name<input value={viewName} onChange={(event) => setViewName(event.target.value)} required maxLength={80} placeholder="My focused tasks" /></label><button type="submit" disabled={!query.trim() || Boolean(queryError)}><Plus size={15} /> Save view</button></form>
        {vault?.settings.taskViews.length ? <div className={styles.savedViews}>{vault.settings.taskViews.map((saved) => <div key={saved.id}><button type="button" aria-current={activeSavedId === saved.id ? 'true' : undefined} onClick={() => { setView('custom'); setActiveSavedId(saved.id); setQuery(saved.query); }}>{saved.name}</button><button type="button" aria-label={`Remove ${saved.name}`} onClick={() => { void removeView(saved.id); }}><Trash2 size={15} /></button></div>)}</div> : <p>No saved task views yet.</p>}
      </section>}
      {message && <p role="status" className={styles.message}>{message}</p>}
      <div className={styles.listHeading}><h2>{view === 'custom' ? activeSavedId ? vault?.settings.taskViews.find((item) => item.id === activeSavedId)?.name ?? 'Custom tasks' : 'Custom tasks' : views.find((item) => item.id === view)?.label}</h2><span>{visible.length} {visible.length === 1 ? 'task' : 'tasks'}</span></div>
      {visible.length ? <div className={styles.taskList}>{visible.map((item) => <TaskRow key={`${item.noteId}:${item.task.id ?? item.task.line}`} item={item} workspace={workspace} onOpenNote={onOpenNote} />)}</div> : <div className={styles.empty}><CalendarDays size={24} /><strong>No tasks in this view</strong><p>Add a Markdown checkbox in any note or choose another task view.</p></div>}
    </div>
  </main>;
}
