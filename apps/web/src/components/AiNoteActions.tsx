'use client';

import { useEffect, useRef, useState } from 'react';
import { Dialog } from '@noor-note/ui';
import { noteActions, planNoteActionEdit, prepareNoteAction, type AiGateway, type AiRequestPlan, type NoteActionEdit, type NoteActionId, type NoteActionPlacement, type NoteActionSelection, type NoteActionSource, type PreparedNoteAction } from '@noor-note/ai';
import { studyCandidatesFromMarkdown, type StudyCandidate } from '@noor-note/core';
import { aiGateway } from '../lib/ai-runtime';
import { currentAiPolicy } from '../lib/ai-policy-storage';
import styles from './AiNoteActions.module.css';

interface Props {
  action: NoteActionId; source: NoteActionSource; selection: NoteActionSelection | null;
  onClose: () => void;
  onApplyEdit: (source: NoteActionSource, edit: NoteActionEdit) => boolean;
  onApplyTitle: (source: NoteActionSource, title: string) => boolean;
  onUndoEdit: (noteId: string, expectedMarkdown: string) => boolean;
  onUndoTitle: (noteId: string, expectedTitle: string, previousTitle: string) => boolean;
  onSaveStudyCards?: (source: NoteActionSource, candidates: StudyCandidate[]) => Promise<string[]>;
  onUndoStudyCards?: (ids: string[]) => Promise<void>;
  gateway?: AiGateway;
}

type Applied = { kind: 'markdown'; markdown: string } | { kind: 'title'; title: string; previousTitle: string } | { kind: 'study'; ids: string[] };

export function AiNoteActions({ action, source, selection, onClose, onApplyEdit, onApplyTitle, onUndoEdit, onUndoTitle, onSaveStudyCards, onUndoStudyCards, gateway = aiGateway }: Props) {
  const [chosen, setChosen] = useState<NoteActionId>(action);
  const [language, setLanguage] = useState('');
  const [reviewPlan, setReviewPlan] = useState<AiRequestPlan | null>(null);
  const [prepared, setPrepared] = useState<PreparedNoteAction | null>(null);
  const [output, setOutput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<Applied | null>(null);
  const controller = useRef<AbortController | null>(null);
  const resolveReview = useRef<((approved: boolean) => void) | null>(null);
  const selected = noteActions.find((item) => item.id === chosen)!;
  const policy = currentAiPolicy();
  const provider = gateway.listProviders().find((item) => item.capabilities.includes('chat'));

  useEffect(() => () => { resolveReview.current?.(false); controller.current?.abort(); }, []);
  const cancel = () => { resolveReview.current?.(false); resolveReview.current = null; controller.current?.abort(); onClose(); };
  const changeAction = (next: NoteActionId) => { setChosen(next); setPrepared(null); setReviewPlan(null); setOutput(''); setApplied(null); setError(null); };

  const request = async () => {
    if (!provider) { setError('No note AI provider is available.'); return; }
    let next: PreparedNoteAction;
    try { next = prepareNoteAction({ action: chosen, source, selection, language }); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not prepare this action.'); return; }
    const abort = new AbortController();
    controller.current = abort;
    setPrepared(next); setReviewPlan(null); setOutput(''); setError(null); setBusy(true);
    try {
      const completion = await gateway.runChat({
        providerId: provider.id, prompt: next.prompt, userInstruction: next.userInstruction, scope: next.scope, content: next.content,
        getPolicy: currentAiPolicy, signal: abort.signal,
        review: (plan) => { setReviewPlan(plan); return new Promise<boolean>((resolve) => { resolveReview.current = resolve; }); },
      });
      setOutput(completion.text);
    } catch (caught) {
      if (!abort.signal.aborted) setError(caught instanceof Error ? caught.message : 'AI generation failed.');
    } finally { resolveReview.current = null; setReviewPlan(null); setBusy(false); controller.current = null; }
  };
  const approve = () => { resolveReview.current?.(true); resolveReview.current = null; setReviewPlan(null); };
  const reject = () => { setOutput(''); setApplied(null); setError(null); setPrepared(null); };
  const apply = (placement: NoteActionPlacement) => {
    if (!prepared || !output.trim()) return;
    if (source.id !== prepared.content[0]?.noteId || source.markdown !== prepared.sourceMarkdown || source.title !== prepared.sourceTitle) { setError('The note changed after the request. Review the current note and run the action again.'); return; }
    try {
      const edit = planNoteActionEdit(prepared, output, placement);
      if ('title' in edit) {
        if (!onApplyTitle(source, edit.title)) throw new Error('The note is no longer ready for this change.');
        setApplied({ kind: 'title', title: edit.title, previousTitle: source.title });
      } else {
        if (!onApplyEdit(source, edit)) throw new Error('The editor changed. Generate the suggestion again.');
        setApplied({ kind: 'markdown', markdown: edit.after });
      }
      setError(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not apply the suggestion.'); }
  };
  const saveStudyCards = async () => {
    if (!prepared || !onSaveStudyCards || !output.trim()) return;
    if (source.id !== prepared.content[0]?.noteId || source.markdown !== prepared.sourceMarkdown || source.title !== prepared.sourceTitle) { setError('The note changed after the request. Generate the suggestion again.'); return; }
    const candidates = studyCandidatesFromMarkdown(output).map((item) => ({ ...item, sourceKind: 'ai' as const, sourceLine: null }));
    if (!candidates.length) { setError('No Q::/A:: study cards were found. Edit the suggestion into that format first.'); return; }
    setBusy(true); setError(null);
    try { const ids = await onSaveStudyCards(source, candidates); if (!ids.length) throw new Error('These study cards already exist.'); setApplied({ kind: 'study', ids }); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save study cards.'); }
    finally { setBusy(false); }
  };
  const undo = async () => {
    if (!applied) return;
    if (applied.kind === 'study') {
      if (!onUndoStudyCards) return;
      setBusy(true);
      try { await onUndoStudyCards(applied.ids); setApplied(null); setError(null); }
      catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not remove study cards.'); }
      finally { setBusy(false); }
      return;
    }
    const ok = applied.kind === 'title' ? onUndoTitle(source.id, applied.title, applied.previousTitle) : onUndoEdit(source.id, applied.markdown);
    if (!ok) { setError('The note changed after the AI edit. Use the editor history or inspect the latest content before undoing.'); return; }
    setApplied(null); setError(null);
  };
  let preview: NoteActionEdit | { title: string } | null = null;
  if (prepared && output.trim()) {
    try { preview = planNoteActionEdit(prepared, output); } catch { /* The apply action reports the specific error. */ }
  }

  return <Dialog open onOpenChange={(open) => { if (!open) cancel(); }} title="AI note actions" description="Review what the local model sees and preview every suggestion before changing a note." contentClassName={styles.dialog}>
    <div className={styles.form}>
      <label>Action<select value={chosen} disabled={busy || Boolean(applied)} onChange={(event) => changeAction(event.target.value as NoteActionId)}>{noteActions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <p className={styles.hint}>Source: {source.path}{selection ? ` · ${selection.text.length} selected characters` : ' · entire note'}</p>
      {chosen === 'translate' && <label>Target language<input value={language} maxLength={80} disabled={busy || Boolean(applied)} onChange={(event) => setLanguage(event.target.value)} placeholder="For example, Swedish" /></label>}
      <p className={styles.hint}>The local model is small and works best with English. First use downloads about 182 MB of model data; generation may take time. Note text stays on this device.</p>
      {!provider && <p role="alert" className={styles.error}>No note AI provider is available.</p>}
      {policy.mode !== 'explicit' || !policy.allow.currentNote ? <p className={styles.hint}>Enable explicitly invoked AI and the Current note scope in Settings before generating.</p> : null}
      {reviewPlan && <section className={styles.review} aria-label="AI request review"><h3>Review this request</h3><dl><dt>Provider</dt><dd>{reviewPlan.provider.name} · {reviewPlan.provider.model}</dd><dt>Destination</dt><dd>{reviewPlan.provider.execution === 'onDevice' ? 'This device; no note text sent to a server' : reviewPlan.provider.recipient}</dd><dt>Scope</dt><dd>{reviewPlan.scope.kind} · {source.path}</dd><dt>Application task</dt><dd>{reviewPlan.prompt}</dd>{reviewPlan.userInstruction && <><dt>User request</dt><dd>{reviewPlan.userInstruction}</dd></>}</dl><strong>Exact note text supplied (untrusted source data)</strong><pre>{reviewPlan.content.map((item) => item.markdown).join('\n')}</pre><div className={styles.buttons}><button type="button" onClick={() => { resolveReview.current?.(false); resolveReview.current = null; }}>Decline</button><button type="button" onClick={approve}>Approve and generate</button></div></section>}
      {busy && !reviewPlan && <p role="status">Loading or running the local model…</p>}
      {output && !applied && <section className={styles.result} aria-label="AI suggestion preview"><h3>Suggestion preview</h3><p className={styles.hint}>Generated text can be inaccurate. Edit and review it before applying.</p><textarea aria-label="Edit AI suggestion" value={output} onChange={(event) => setOutput(event.target.value)} rows={10} /><details><summary>Planned change</summary>{preview && 'title' in preview ? <p>Title: {source.title} → {preview.title}</p> : preview ? <div className={styles.diff}><div><strong>Before</strong><pre>{prepared?.sourceMarkdown}</pre></div><div><strong>After</strong><pre>{preview.after}</pre></div></div> : <p>Review the suggestion text.</p>}</details></section>}
      {applied && <p role="status" className={styles.success}>{applied.kind === 'study' ? `${applied.ids.length} study cards saved locally. You can undo this change.` : 'Suggestion applied to the local note. You can undo this change.'}</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.buttons}>
        <button type="button" onClick={cancel}>{busy ? 'Cancel request' : 'Close'}</button>
        {!busy && !output && !applied && <button type="button" disabled={!provider || policy.mode !== 'explicit' || !policy.allow.currentNote || selected.selectionRequired && !selection} onClick={() => { void request(); }}>Review request</button>}
        {output && !applied && <><button type="button" onClick={reject}>Reject</button><button type="button" onClick={() => apply(prepared?.placement ?? 'append')}>Accept</button>{chosen === 'generate-flashcards' && onSaveStudyCards && <button type="button" disabled={busy} onClick={() => { void saveStudyCards(); }}>Add as study cards</button>}{prepared?.placement !== 'title' && <button type="button" onClick={() => apply('insert-below')}>Insert below</button>}{selection && prepared?.placement !== 'title' && <button type="button" onClick={() => apply('replace')}>Replace selection</button>}</>}
        {applied && <button type="button" disabled={busy} onClick={() => { void undo(); }}>Undo</button>}
      </div>
    </div>
  </Dialog>;
}
