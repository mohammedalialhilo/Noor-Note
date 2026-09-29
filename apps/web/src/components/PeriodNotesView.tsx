'use client';

import { useEffect, useMemo, useRef, useState, type MouseEventHandler } from 'react';
import { formatPeriodDate, matchesPeriod, periodKey, periodStart, shiftPeriod, validatePeriodRule, type PeriodKind } from '@noor-note/core';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import type { useVaultWorkspace } from '../hooks/useVaultWorkspace';
import styles from './PeriodNotesView.module.css';

const kinds: { id: PeriodKind; label: string }[] = [
  { id: 'daily', label: 'Daily' }, { id: 'weekly', label: 'Weekly' }, { id: 'monthly', label: 'Monthly' },
  { id: 'quarterly', label: 'Quarterly' }, { id: 'yearly', label: 'Yearly' },
];
const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const dateInputValue = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

interface Props {
  workspace: ReturnType<typeof useVaultWorkspace>;
  kind: PeriodKind;
  onKindChange: (kind: PeriodKind) => void;
  onOpenNote: (id: string) => void;
  onOpenNavigation: MouseEventHandler<HTMLButtonElement>;
  onSettings: () => void;
}

export function PeriodNotesView({ workspace, kind, onKindChange, onOpenNote, onOpenNavigation, onSettings }: Props) {
  const [date, setDate] = useState(() => new Date());
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const autoRunRef = useRef<string | null>(null);
  const calendarOpenRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const vault = workspace.activeVault;
  const rawRule = vault?.settings.periodNotes[kind];
  const rule = (() => { try { return rawRule ? validatePeriodRule(kind, rawRule) : null; } catch { return null; } })();
  const invalidSettings = Boolean(rawRule && !rule);
  const start = useMemo(() => periodStart(kind, date), [kind, date]);
  const key = periodKey(kind, start);
  const existing = workspace.notes.find((note) => matchesPeriod(note.properties, kind, start))
    ?? (kind === 'daily' ? workspace.notes.find((note) => note.folderId === rule?.folderId && note.title === key && !note.properties.noor_period_kind) : undefined);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  useEffect(() => {
    if (!rule?.autoCreate || existing || !vault) return;
    const signature = `${vault.id}:${kind}:${key}`;
    if (autoRunRef.current === signature) return;
    autoRunRef.current = signature;
    void workspace.openPeriodNote(kind, start, true).then((note) => {
      if (!mountedRef.current) return;
      if (!note) { autoRunRef.current = null; setMessage('Could not create this period note. Check the workspace error and settings.'); return; }
      setMessage(null);
      if (calendarOpenRef.current === signature) { calendarOpenRef.current = null; onOpenNote(note.id); }
    });
  }, [rule?.autoCreate, existing, vault, workspace, kind, key, start, onOpenNote]);

  const open = async (target: Date, create: boolean) => {
    setBusy(true); setMessage(null);
    try {
      const note = await workspace.openPeriodNote(kind, target, create);
      if (note) onOpenNote(note.id);
      else setMessage('No note exists for this period. Choose Create note to make one.');
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : 'Could not open the period note.'); }
    finally { setBusy(false); }
  };
  const navigate = (amount: number) => {
    const next = shiftPeriod(kind, date, amount);
    setDate(next); setCalendarMonth(new Date(next.getFullYear(), next.getMonth(), 1)); setMessage(null);
  };
  const current = () => {
    const now = new Date(); setDate(now); setCalendarMonth(new Date(now.getFullYear(), now.getMonth(), 1)); setMessage(null);
  };
  const firstWeekday = (calendarMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0).getDate();
  return <main className={styles.page}>
    <header className={styles.topbar}><button type="button" className={styles.mobileMenu} onClick={onOpenNavigation} aria-label="Open navigation">☰</button><CalendarDays size={20} /><span>Periodic notes</span><button type="button" onClick={onSettings}>Settings</button></header>
    <div className={styles.content}>
      <p className={styles.eyebrow}>TIME & REFLECTION</p><h1>Daily and periodic notes</h1><p className={styles.intro}>Keep one Markdown note for a day, week, month, quarter, or year.</p>
      <div className={styles.kindTabs} role="group" aria-label="Note period">{kinds.map((item) => <button key={item.id} type="button" aria-pressed={kind === item.id} onClick={() => { onKindChange(item.id); setMessage(null); }}>{item.label}</button>)}</div>
      <section className={styles.periodCard} aria-label={`${kind} note`}>
        <div className={styles.navigation}><button type="button" onClick={() => navigate(-1)} aria-label={`Previous ${kind} note`}><ChevronLeft size={19} /> Previous</button><button type="button" onClick={current}>Current {kind === 'daily' ? 'day' : kind === 'weekly' ? 'week' : kind === 'monthly' ? 'month' : kind === 'quarterly' ? 'quarter' : 'year'}</button><button type="button" onClick={() => navigate(1)} aria-label={`Next ${kind} note`}>Next <ChevronRight size={19} /></button></div>
        <p className={styles.label}>{rule ? formatPeriodDate(kind, start, rule.dateFormat) : key}</p>
        <h2>{rule ? formatPeriodDate(kind, start, rule.filenameFormat) : key}</h2>
        <label className={styles.jump}>Jump to date<input type="date" value={dateInputValue(date)} onChange={(event) => { const [year, month, day] = event.target.value.split('-').map(Number); if (year && month && day) { const next = new Date(year, month - 1, day); setDate(next); setCalendarMonth(new Date(year, month - 1, 1)); } }} /></label>
        {existing ? <div className={styles.result}><span>{existing.path}</span><button type="button" onClick={() => onOpenNote(existing.id)}>Open note</button></div> : <div className={styles.result}><span>No note for this period yet.</span><button type="button" disabled={busy || invalidSettings} onClick={() => { void open(start, true); }}>{busy ? 'Creating…' : 'Create note'}</button></div>}
        {invalidSettings && <p role="alert" className={styles.message}>This period has an invalid filename or date format. Correct it in Settings.</p>}
        {message && <p role="status" className={styles.message}>{message}</p>}
      </section>
      {kind === 'daily' && <section className={styles.calendar} aria-label="Daily note calendar"><div className={styles.calendarHeading}><h2>{new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(calendarMonth)}</h2><div><button type="button" aria-label="Previous calendar month" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))}><ChevronLeft size={18} /></button><button type="button" aria-label="Next calendar month" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))}><ChevronRight size={18} /></button></div></div>
        <div className={styles.days}>{dayNames.map((name) => <strong key={name}>{name}</strong>)}{Array.from({ length: firstWeekday }, (_, index) => <span key={`empty-${index}`} />)}{Array.from({ length: daysInMonth }, (_, index) => {
          const day = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), index + 1);
          const found = workspace.notes.some((note) => matchesPeriod(note.properties, 'daily', day) || note.folderId === rule?.folderId && note.title === periodKey('daily', day) && !note.properties.noor_period_kind);
          const selected = dateInputValue(day) === dateInputValue(date);
          return <button key={index} type="button" className={`${found ? styles.hasNote : ''} ${selected ? styles.selected : ''}`} aria-label={`${dateInputValue(day)}${found ? ', note exists' : ''}`} aria-current={selected ? 'date' : undefined} onClick={() => { setDate(day); if (found) void open(day, false); else if (rule?.autoCreate && vault) calendarOpenRef.current = `${vault.id}:daily:${periodKey('daily', day)}`; }}>{index + 1}</button>;
        })}</div><p>Choose a date to open its note. Missing dates create a note only when you choose Create note or enable auto-create.</p>
      </section>}
    </div>
  </main>;
}
