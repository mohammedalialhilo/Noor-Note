'use client';

import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Menu, RotateCcw, Sparkles } from 'lucide-react';
import type { AiRequestPlan } from '@noor-note/ai';
import type { TagChange, VaultNote } from '@noor-note/core';
import type { useVaultWorkspace } from '../hooks/useVaultWorkspace';
import { aiGateway } from '../lib/ai-runtime';
import { currentAiPolicy } from '../lib/ai-policy-storage';
import { discoverOrganization, planOrganizationChanges, type OrganizationSuggestion } from '../lib/organization';
import { organizationPrompt, parseOrganizationAi } from '../lib/organization-ai';
import styles from './OrganizationReview.module.css';

interface Props { workspace: ReturnType<typeof useVaultWorkspace>; onOpenNote: (id: string) => void; onOpenNavigation: (event: MouseEvent<HTMLButtonElement>) => void; onOpenSettings: () => void }
type Undo = { kind: 'edits'; changes: TagChange[]; applied: VaultNote[] } | { kind: 'move'; noteId: string; fromFolderId: string | null; afterPath: string; afterRevision: number } | { kind: 'index'; noteId: string; afterRevision: number };

export function OrganizationReview({ workspace, onOpenNote, onOpenNavigation, onOpenSettings }: Props) {
  const [notes, setNotes] = useState<VaultNote[]>([]);
  const [suggestions, setSuggestions] = useState<OrganizationSuggestion[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [batchPreview, setBatchPreview] = useState(false);
  const [undo, setUndo] = useState<Undo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reviewPlan, setReviewPlan] = useState<AiRequestPlan | null>(null);
  const [aiNoteId, setAiNoteId] = useState('');
  const [scanRevisions, setScanRevisions] = useState<{ id: string; revision: number }[]>([]);
  const resolveReview = useRef<((approved: boolean) => void) | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { resolveReview.current?.(false); controller.current?.abort(); }, []);
  const repository = workspace.repository;
  const vaultId = workspace.activeVault?.id;
  const policy = currentAiPolicy();
  const provider = aiGateway.listProviders().find((item) => item.capabilities.includes('chat') && item.execution === 'onDevice');
  const fail = (caught: unknown) => setError(caught instanceof Error ? caught.message : 'The action could not be completed.');
  const resetAfterWrite = async (text: string) => { setSuggestions([]); setPreview(null); setBatchPreview(false); setMessage(`${text} Scan again for current suggestions.`); await workspace.refreshActive(); };

  const scan = async () => {
    if (!repository || !vaultId) return;
    setBusy(true); setError(null); setMessage(null); setPreview(null); setBatchPreview(false);
    try {
      await workspace.flushPending();
      const tree = await repository.listTree(vaultId);
      const entries = tree.notes.slice(0, 150);
      const loaded: VaultNote[] = [];
      for (let index = 0; index < entries.length; index += 25) {
        const batch = await Promise.all(entries.slice(index, index + 25).map((entry) => repository.getNote(entry.id)));
        loaded.push(...batch.filter((note): note is VaultNote => Boolean(note)));
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
      setNotes(loaded); setScanRevisions(tree.notes.map((note) => ({ id: note.id, revision: note.revision }))); setSuggestions(discoverOrganization(loaded, tree.folders));
      setAiNoteId((current) => loaded.some((note) => note.id === current) ? current : loaded[0]?.id ?? '');
      if (tree.notes.length > entries.length) setMessage(`Scanned the first ${entries.length} notes. This version limits each scan to keep the workspace responsive.`);
    } catch (caught) { fail(caught); } finally { setBusy(false); }
  };

  const apply = async (items: OrganizationSuggestion[]) => {
    if (!repository || !vaultId || !items.length) return;
    setBusy(true); setError(null);
    try {
      await workspace.flushPending();
      if (items.length === 1 && items[0]!.action.kind === 'move') {
        const item = items[0]!, source = notes.find((note) => note.id === item.noteId)!;
        const action = item.action;
        if (action.kind !== 'move') throw new Error('Invalid move suggestion.');
        const current = await repository.getNote(source.id);
        if (!current || current.revision !== source.revision || current.path !== source.path) throw new Error('The note changed after the preview. Scan again.');
        const moved = await repository.moveNote(source.id, action.folderId);
        setUndo({ kind: 'move', noteId: source.id, fromFolderId: source.folderId, afterPath: moved.path, afterRevision: moved.revision });
        await resetAfterWrite('Note moved.'); return;
      }
      if (items.length === 1 && items[0]!.action.kind === 'index') {
        const action = items[0]!.action;
        const indexed = action.noteIds.map((id) => notes.find((note) => note.id === id)).filter((note): note is VaultNote => Boolean(note));
        if (indexed.length !== action.noteIds.length) throw new Error('Some index notes are unavailable. Scan again.');
        const markdown = `# ${action.title}\n\n${indexed.map((note) => `- [[${note.title}]]<!-- noor-note-id:${note.id} -->`).join('\n')}\n`;
        const created = await repository.createNote(vaultId, action.folderId, action.title, markdown);
        setUndo({ kind: 'index', noteId: created.id, afterRevision: created.revision });
        await resetAfterWrite('Index note created.'); return;
      }
      const changes = planOrganizationChanges(items, notes);
      if (!changes.length) throw new Error('These suggestions no longer change the notes. Scan again.');
      const applied = await repository.applyVaultNoteEdits(vaultId, changes, scanRevisions);
      setUndo({ kind: 'edits', changes, applied });
      await resetAfterWrite(`${items.length} suggestion${items.length === 1 ? '' : 's'} accepted.`);
    } catch (caught) { fail(caught); } finally { setBusy(false); }
  };
  const undoLast = async () => {
    if (!undo || !repository || !vaultId) return;
    setBusy(true); setError(null);
    try {
      await workspace.flushPending();
      if (undo.kind === 'edits') {
        const reversed = undo.changes.map((change) => { const current = undo.applied.find((note) => note.id === change.noteId)!; return { ...change, before: change.after, after: change.before, revision: current.revision }; });
        const tree = await repository.listTree(vaultId);
        await repository.applyVaultNoteEdits(vaultId, reversed, tree.notes.map((note) => ({ id: note.id, revision: note.revision })));
      } else {
        const current = await repository.getNote(undo.noteId);
        if (!current || current.revision !== undo.afterRevision || undo.kind === 'move' && current.path !== undo.afterPath) throw new Error('This note changed after acceptance. Review it before undoing.');
        if (undo.kind === 'move') await repository.moveNote(current.id, undo.fromFolderId);
        else await repository.deleteNote(current.id);
      }
      setUndo(null); setMessage('Last accepted change undone.'); await workspace.refreshActive();
    } catch (caught) { fail(caught); } finally { setBusy(false); }
  };
  const askAi = async () => {
    if (!vaultId || !provider) return;
    const note = notes.find((item) => item.id === aiNoteId);
    if (!note) { setError('Scan and select a note first.'); return; }
    const abort = new AbortController(); controller.current = abort; setBusy(true); setError(null);
    try {
      const output = await aiGateway.runChat({ providerId: provider.id, prompt: organizationPrompt,
        scope: { kind: 'currentNote', vaultId, noteId: note.id }, content: [{ vaultId, noteId: note.id, title: note.title, path: note.path, markdown: note.markdown.slice(0, 4000) }],
        getPolicy: currentAiPolicy, signal: abort.signal,
        review: (plan) => { setReviewPlan(plan); return new Promise<boolean>((resolve) => { resolveReview.current = resolve; }); },
      });
      const generated = parseOrganizationAi(output.text, { ...note, markdown: note.markdown.slice(0, 4000) });
      setSuggestions((current) => [...current, ...generated.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setMessage(generated.length ? `${generated.length} grounded model suggestions added for review.` : 'The model returned no grounded suggestions.');
    } catch (caught) { if (!abort.signal.aborted) fail(caught); }
    finally { controller.current = null; resolveReview.current = null; setReviewPlan(null); setBusy(false); }
  };
  const selected = suggestions.find((item) => item.id === preview);
  let selectedChanges: TagChange[] = [];
  let batchChanges: TagChange[] = [];
  try { if (selected && !['move', 'index'].includes(selected.action.kind)) selectedChanges = planOrganizationChanges([selected], notes); } catch { /* stale previews are rejected on apply */ }
  const safe = suggestions.filter((item) => item.safeForBatch);
  try { if (batchPreview && safe.length) batchChanges = planOrganizationChanges(safe, notes); } catch { /* UI reports no valid batch */ }
  return <main className={styles.root}>
    <header className={styles.header}><button className={styles.mobileMenu} type="button" aria-label="Open navigation" onClick={onOpenNavigation}><Menu size={20} /></button><div><span className={styles.eyebrow}>NOOR NOTE</span><h1>Organize knowledge</h1></div><button type="button" onClick={() => { void scan(); }} disabled={busy || !repository}>Scan vault</button></header>
    <div className={styles.content}>
      <p className={styles.intro}>Review local suggestions before changing any note. The optional model runs on this device only after you approve the exact note content. Notes are never deleted, merged, or rewritten automatically.</p>
      <section className={styles.ai}><div><Sparkles size={18} /><strong>Optional AI suggestions</strong></div><p>Ask the local model for grounded tags, properties, tasks, and possible contradictions in one note. A small model may return no usable suggestions.</p><label>Note <select value={aiNoteId} onChange={(event) => setAiNoteId(event.target.value)} disabled={busy}>{notes.map((note) => <option key={note.id} value={note.id}>{note.title}</option>)}</select></label><button type="button" disabled={busy || !notes.length || !provider || policy.mode !== 'explicit' || !policy.allow.currentNote} onClick={() => { void askAi(); }}>Review AI request</button>{(policy.mode !== 'explicit' || !policy.allow.currentNote) && <button type="button" onClick={onOpenSettings}>Enable AI in Settings</button>}</section>
      {reviewPlan && <section className={styles.review} aria-label="AI request review"><h2>Approve this request</h2><p>{reviewPlan.provider.name} · {reviewPlan.provider.model} · {reviewPlan.provider.execution === 'onDevice' ? 'On this device' : reviewPlan.provider.recipient}</p><p>Scope: current note · {reviewPlan.content[0]?.path}</p><details><summary>Application task and untrusted note content</summary><pre>{reviewPlan.prompt}</pre><pre>{reviewPlan.content[0]?.markdown}</pre></details><button type="button" onClick={() => { resolveReview.current?.(false); resolveReview.current = null; }}>Decline</button><button type="button" onClick={() => { resolveReview.current?.(true); resolveReview.current = null; }}>Approve and generate</button></section>}
      {busy && <p role="status">Working on the local vault…</p>}{error && <p role="alert" className={styles.error}>{error}</p>}{message && <p role="status">{message}</p>}
      <div className={styles.toolbar}><span>{suggestions.length} suggestions</span><button type="button" disabled={busy || !safe.length} onClick={() => { setBatchPreview(true); setPreview(null); }}>Preview {safe.length} safe items</button>{undo && <button type="button" disabled={busy} onClick={() => { void undoLast(); }}><RotateCcw size={15} /> Undo last acceptance</button>}</div>
      {batchPreview && <section className={styles.preview}><h2>Safe batch preview</h2><p>Only note links, tags, properties, and task checkboxes are included. Each note is saved once in an atomic vault edit.</p>{batchChanges.map((change) => <details key={change.noteId}><summary>{change.path}</summary><div className={styles.diff}><div><strong>Before</strong><pre>{change.before}</pre></div><div><strong>After</strong><pre>{change.after}</pre></div></div></details>)}<button type="button" onClick={() => setBatchPreview(false)}>Cancel</button><button type="button" disabled={busy || !batchChanges.length} onClick={() => { void apply(safe); }}>Accept all safe items</button></section>}
      <div className={styles.list}>{suggestions.map((item) => <article key={item.id} className={styles.card}><div className={styles.cardTop}><span className={styles.kind}>{item.kind.replace('-', ' ')}</span><span>{item.source === 'ai' ? 'Local AI' : 'Local scan'}</span></div><h2>{item.title}</h2><p>{item.reason}</p><blockquote>{item.evidence}</blockquote><div className={styles.actions}><button type="button" onClick={() => onOpenNote(item.noteId)}>Open source</button><button type="button" onClick={() => { setPreview(preview === item.id ? null : item.id); setBatchPreview(false); }}>Preview</button><button type="button" onClick={() => { setSuggestions((current) => current.filter((candidate) => candidate.id !== item.id)); if (preview === item.id) setPreview(null); }}>Reject</button></div>{preview === item.id && <div className={styles.preview}><h3>Planned change</h3>{item.action.kind === 'move' ? <p>Move note from {notes.find((note) => note.id === item.noteId)?.path} to folder {workspace.folders.find((folder) => folder.id === (item.action.kind === 'move' ? item.action.folderId : ''))?.path}. Existing note content remains the same.</p> : item.action.kind === 'index' ? <pre>{`# ${item.action.title}\n\n${item.action.noteIds.map((id) => { const note = notes.find((entry) => entry.id === id); return note ? `- [[${note.title}]]<!-- noor-note-id:${note.id} -->` : ''; }).join('\n')}`}</pre> : selectedChanges.length ? <div className={styles.diff}><div><strong>Before</strong><pre>{selectedChanges[0]!.before}</pre></div><div><strong>After</strong><pre>{selectedChanges[0]!.after}</pre></div></div> : <p>This suggestion no longer changes the note. Scan again.</p>}<button type="button" disabled={busy || !(['move', 'index'].includes(item.action.kind) || selectedChanges.length)} onClick={() => { void apply([item]); }}>Accept</button></div>}</article>)}</div>
      {!suggestions.length && !busy && <p className={styles.empty}>Scan the vault to find organization opportunities. Suggestions are not applied until you review and accept them.</p>}
    </div>
  </main>;
}
