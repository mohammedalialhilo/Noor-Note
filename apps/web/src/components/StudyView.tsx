'use client';

import { useEffect, useMemo, useState, type FormEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { GraduationCap, Menu } from 'lucide-react';
import { studyCandidatesFromMarkdown, studyStatistics, type StudyCandidate, type StudyCard, type StudyRating } from '@noor-note/core';
import type { useVaultWorkspace } from '../hooks/useVaultWorkspace';
import { StudyStore } from '../lib/study';
import styles from './StudyView.module.css';

interface Props { workspace: ReturnType<typeof useVaultWorkspace>; initialDraft: { noteId: string; text: string } | null; onOpenNote: (id: string, line?: number) => void; onOpenNavigation: (event: ReactMouseEvent<HTMLButtonElement>) => void; readOnly: boolean }

export function StudyView({ workspace, initialDraft, onOpenNote, onOpenNavigation, readOnly }: Props) {
  const repository = workspace.repository, vaultId = workspace.activeVault?.id;
  const store = useMemo(() => repository && vaultId ? new StudyStore(repository, vaultId) : null, [repository, vaultId]);
  const [cards, setCards] = useState<StudyCard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [section, setSection] = useState<'review' | 'import' | 'create' | 'library'>(initialDraft ? 'create' : 'review');
  const [noteId, setNoteId] = useState(initialDraft?.noteId ?? workspace.selectedNote?.id ?? workspace.notes[0]?.id ?? '');
  const [includeHeadings, setIncludeHeadings] = useState(false);
  const [candidates, setCandidates] = useState<StudyCandidate[]>([]);
  const [scanned, setScanned] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [kind, setKind] = useState<StudyCard['kind']>('frontBack');
  const [front, setFront] = useState(initialDraft?.text ?? '');
  const [back, setBack] = useState('');
  const load = async () => { if (store) setCards(await store.list()); };
  useEffect(() => { let live = true; if (store) void store.list().then((items) => { if (live) setCards(items); }).catch((caught: unknown) => { if (live) setError(caught instanceof Error ? caught.message : 'Could not load study cards.'); }); return () => { live = false; }; }, [store]);
  const now = new Date();
  const due = cards.filter((card) => card.dueAt <= now.toISOString());
  const active = due[0];
  const stats = studyStatistics(cards, now);
  const sourceTitle = (card: StudyCard) => workspace.notes.find((note) => note.id === card.sourceNoteId)?.title ?? 'Source note unavailable';
  const hasSource = (card: StudyCard) => workspace.notes.some((note) => note.id === card.sourceNoteId);
  const review = async (rating: StudyRating) => {
    if (!store || !active || busy) return;
    setBusy(true); setError(null);
    try { await store.review(active.id, rating, active.updatedAt); await load(); setRevealed(false); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save review.'); }
    finally { setBusy(false); }
  };
  const scan = async () => {
    if (!repository || !noteId) return;
    setBusy(true); setError(null);
    try {
      await workspace.flushPending();
      const note = await repository.getNote(noteId);
      if (!note || note.deletedAt || note.vaultId !== vaultId) throw new Error('The selected note is unavailable.');
      const found = studyCandidatesFromMarkdown(note.markdown, { headings: includeHeadings });
      const existing = new Set(cards.filter((card) => card.sourceNoteId === noteId).map((card) => card.sourceKey));
      setCandidates(found.filter((candidate) => !existing.has(candidate.sourceKey)));
      setScanned(true);
      setSelected(new Set(found.filter((candidate) => !existing.has(candidate.sourceKey)).map((candidate) => candidate.sourceKey)));
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not scan the note.'); }
    finally { setBusy(false); }
  };
  const importCards = async () => {
    if (!store || readOnly) return;
    setBusy(true); setError(null);
    try { const added = await store.add(noteId, candidates.filter((candidate) => selected.has(candidate.sourceKey))); await load(); setCandidates([]); setScanned(false); setSelected(new Set()); if (!added.length) setError('No new cards were added.'); else setSection('review'); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not import cards.'); }
    finally { setBusy(false); }
  };
  const create = async (event: FormEvent) => {
    event.preventDefault(); if (!store || readOnly) return;
    setBusy(true); setError(null);
    try {
      await store.add(noteId, [{ kind, front, back, sourceKind: initialDraft?.noteId === noteId ? 'selection' : 'markdown', sourceLine: null, sourceKey: `manual:${crypto.randomUUID()}` }]);
      await load(); setFront(''); setBack(''); setSection('review');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not create a card.'); }
    finally { setBusy(false); }
  };
  const remove = async (card: StudyCard) => {
    if (!store || readOnly || !window.confirm('Remove this study card and its review history?')) return;
    setBusy(true); setError(null);
    try { await store.remove(card.id); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not remove the card.'); }
    finally { setBusy(false); }
  };
  return <main className={styles.layout}>
    <div className={styles.topbar}><button type="button" className="icon-button mobile-menu" aria-label="Open navigation" onClick={onOpenNavigation}><Menu size={20} /></button><GraduationCap size={21} /><strong>Study</strong></div>
    <div className={styles.content}><header><h1>Study cards</h1><p>Review at your pace. Cards stay linked to their source notes.</p></header>
      <div className={styles.stats} aria-label="Study statistics"><div><strong>{stats.due}</strong><span>Due now</span></div><div><strong>{stats.total}</strong><span>Total cards</span></div><div><strong>{stats.new}</strong><span>Not reviewed yet</span></div><div><strong>{stats.reviewedLast30Days}</strong><span>Reviews in 30 days</span></div></div>
      <nav className={styles.tabs} aria-label="Study sections">{(['review', 'import', 'create', 'library'] as const).map((item) => <button key={item} type="button" aria-current={section === item ? 'page' : undefined} onClick={() => setSection(item)}>{({ review: 'Review', import: 'Import from note', create: 'Create card', library: 'Card library' })[item]}</button>)}</nav>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {section === 'review' && <section className={styles.review} aria-label="Review card">{active ? <><small>{sourceTitle(active)} · {active.kind === 'cloze' ? 'Cloze' : active.kind === 'questionAnswer' ? 'Question and answer' : 'Front and back'}</small><div className={styles.prompt}>{active.front}</div>{revealed ? <><div className={styles.answer}><span>Answer</span><p>{active.back}</p></div><div className={styles.ratings}>{(['again', 'hard', 'good', 'easy'] as const).map((rating) => <button key={rating} type="button" disabled={busy || readOnly} onClick={() => { void review(rating); }}>{rating[0]!.toUpperCase() + rating.slice(1)}</button>)}</div></> : <button type="button" onClick={() => setRevealed(true)}>Show answer</button>}<button type="button" className={styles.source} disabled={!hasSource(active)} onClick={() => onOpenNote(active.sourceNoteId, active.sourceLine ?? undefined)}>Open source note</button></> : <div className={styles.empty}><h2>Nothing due now</h2><p>Import cards from a note or create one when you need it.</p></div>}</section>}
      {section === 'import' && <section className={styles.panel} aria-label="Import cards"><h2>Import from Markdown</h2><p>Preview the cards before adding them. Existing cards and source Markdown are left intact.</p><label>Source note<select value={noteId} onChange={(event) => { setNoteId(event.target.value); setCandidates([]); setScanned(false); }}>{workspace.notes.map((note) => <option key={note.id} value={note.id}>{note.title} · {note.path}</option>)}</select></label><label className={styles.check}><input type="checkbox" checked={includeHeadings} onChange={(event) => { setIncludeHeadings(event.target.checked); setCandidates([]); setScanned(false); }} /> Include headings and their sections</label><button type="button" disabled={busy || !noteId} onClick={() => { void scan(); }}>Preview cards</button><p className={styles.hint}>Recognizes Front/Back, Q/A, [!flashcard] callouts, and {'{{c1::cloze}}'}. Accepted AI flashcard suggestions in a note can be previewed here too.</p>{scanned && !candidates.length && <p role="status">No new cards found in this note.</p>}{candidates.length > 0 && <><h3>{candidates.length} new candidates</h3><div className={styles.candidates}>{candidates.map((candidate) => <label key={candidate.sourceKey} className={styles.candidate}><input type="checkbox" checked={selected.has(candidate.sourceKey)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(candidate.sourceKey); else next.delete(candidate.sourceKey); return next; })} /><span><strong>{candidate.front}</strong><small>{candidate.back}</small></span></label>)}</div><button type="button" disabled={busy || readOnly || !selected.size} onClick={() => { void importCards(); }}>Add {selected.size} selected cards</button></>}</section>}
      {section === 'create' && <form className={styles.panel} onSubmit={(event) => { void create(event); }} aria-label="Create study card"><h2>Create a card</h2><label>Source note<select value={noteId} required onChange={(event) => setNoteId(event.target.value)}>{workspace.notes.map((note) => <option key={note.id} value={note.id}>{note.title} · {note.path}</option>)}</select></label><label>Card type<select value={kind} onChange={(event) => setKind(event.target.value as StudyCard['kind'])}><option value="frontBack">Front and back</option><option value="questionAnswer">Question and answer</option><option value="cloze">Cloze</option></select></label><label>{kind === 'questionAnswer' ? 'Question' : 'Front'}<textarea required maxLength={5000} rows={3} value={front} onChange={(event) => setFront(event.target.value)} /></label><label>{kind === 'questionAnswer' ? 'Answer' : 'Back'}<textarea required maxLength={5000} rows={3} value={back} onChange={(event) => setBack(event.target.value)} /></label><button type="submit" disabled={busy || readOnly || !noteId}>Create card</button></form>}
      {section === 'library' && <section className={styles.panel} aria-label="Card library"><h2>Card library</h2>{cards.length ? <ul className={styles.library}>{cards.map((card) => <li key={card.id}><div><strong>{card.front}</strong><p>{card.back}</p><small>{sourceTitle(card)} · Due {new Date(card.dueAt).toLocaleString()} · {card.history.length} reviews</small></div><div><button type="button" disabled={!hasSource(card)} onClick={() => onOpenNote(card.sourceNoteId, card.sourceLine ?? undefined)}>Source</button><button type="button" disabled={busy || readOnly} onClick={() => { void remove(card); }}>Remove</button></div></li>)}</ul> : <p>No cards yet. Use Import from note or Create card above to build a study set.</p>}</section>}
    </div>
  </main>;
}
