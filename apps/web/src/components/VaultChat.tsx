'use client';

import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { ArrowLeft, BookOpenText, Download, Menu, Plus, Send, Trash2 } from 'lucide-react';
import { aiScopeAllowed, insufficientVaultEvidence, vaultChatPrompt, vaultChatUserQuestion, verifyGroundedAnswer, type AiRequestPlan, type ChatSource } from '@noor-note/ai';
import { baseSchema, type Base } from '@noor-note/core';
import type { useVaultWorkspace } from '../hooks/useVaultWorkspace';
import { aiGateway } from '../lib/ai-runtime';
import { currentAiPolicy } from '../lib/ai-policy-storage';
import { ChatHistoryStore, type ChatMessage, type ChatSession } from '../lib/chat-history';
import { downloadText } from '../lib/workspace';
import { SearchClient } from '../lib/search-client';
import { resolveChatCandidates, retrieveChatContext, type ChatScopeChoice } from '../lib/vault-chat-retrieval';
import styles from './VaultChat.module.css';

interface Props {
  workspace: ReturnType<typeof useVaultWorkspace>;
  onOpenSource: (source: ChatSource) => void;
  onOpenNavigation: (event: MouseEvent<HTMLButtonElement>) => void;
  onOpenSettings: () => void;
}

function CitedAnswer({ text, sources, onOpenSource }: { text: string; sources: ChatSource[]; onOpenSource: (source: ChatSource) => void }) {
  const byId = new Map(sources.map((source) => [source.id, source]));
  return <div className={styles.answer}>{text.split(/(\[S\d+\])/gu).map((part, index) => {
    const source = byId.get(part.slice(1, -1));
    return source && part === `[${source.id}]` ? <button type="button" className={styles.inlineCitation} key={index} onClick={() => onOpenSource(source)} aria-label={`Open ${source.title}, ${source.heading ?? `line ${source.line}`}`}>{part}</button> : <span key={index}>{part}</span>;
  })}</div>;
}

export function VaultChat({ workspace, onOpenSource, onOpenNavigation, onOpenSettings }: Props) {
  const vaultId = workspace.activeVault?.id ?? '';
  const [scopeKind, setScopeKind] = useState<ChatScopeChoice['kind']>(workspace.selectedNote ? 'currentNote' : 'vaultRetrieval');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectionFilter, setSelectionFilter] = useState('');
  const [folderId, setFolderId] = useState('');
  const [baseId, setBaseId] = useState('');
  const [bases, setBases] = useState<Base[]>([]);
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());
  const [saveHistory, setSaveHistory] = useState(false);
  const [reviewPlan, setReviewPlan] = useState<AiRequestPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const history = useRef<ChatHistoryStore | null>(null);
  const search = useRef<SearchClient | null>(null);
  const controller = useRef<AbortController | null>(null);
  const resolveReview = useRef<((approved: boolean) => void) | null>(null);
  const policy = currentAiPolicy();
  const provider = aiGateway.listProviders().find((item) => item.id === 'noor.local-smollm2');

  useEffect(() => {
    const repository = workspace.repository;
    if (!repository || !vaultId) return;
    let live = true;
    history.current = new ChatHistoryStore();
    search.current = new SearchClient();
    void Promise.all([history.current.list(vaultId), repository.listObjects('base', vaultId)]).then(([saved, objects]) => {
      if (!live) return;
      setSessions(saved);
      setBases(objects.map((item) => baseSchema.parse(item)).filter((item) => !item.deletedAt));
    }).catch((caught: unknown) => { if (live) setError(caught instanceof Error ? caught.message : 'Could not load chat resources.'); });
    return () => { live = false; resolveReview.current?.(false); controller.current?.abort(); history.current?.close(); history.current = null; search.current?.close(); search.current = null; };
  }, [vaultId, workspace.repository]);

  const newChat = () => { setSessionId(crypto.randomUUID()); setMessages([]); setQuestion(''); setError(null); setConfirmClear(false); };
  const persist = async (next: ChatMessage[], enabled = saveHistory) => {
    if (!enabled || !history.current || !vaultId || !next.length) return;
    const existing = sessions.find((item) => item.id === sessionId);
    const now = new Date().toISOString();
    const session: ChatSession = { id: sessionId, vaultId, title: next.find((item) => item.role === 'user')?.text.slice(0, 100) ?? 'Chat', createdAt: existing?.createdAt ?? now, updatedAt: now, messages: next };
    await history.current.save(session);
    setSessions((current) => [session, ...current.filter((item) => item.id !== session.id)]);
  };
  const choice = (): ChatScopeChoice => scopeKind === 'currentNote' ? { kind: 'currentNote', noteId: workspace.selectedNote?.id ?? '' }
    : scopeKind === 'selectedNotes' ? { kind: 'selectedNotes', noteIds: selectedIds }
    : scopeKind === 'folderResults' ? { kind: 'folderResults', folderId }
    : scopeKind === 'baseResults' ? { kind: 'baseResults', baseId }
    : { kind: 'vaultRetrieval' };
  const scopeAllowed = (kind: ChatScopeChoice['kind']) => aiScopeAllowed(policy, kind);
  const send = async () => {
    const prompt = question.trim();
    const repository = workspace.repository;
    if (!prompt || busy || !repository || !vaultId) return;
    if (messages.length >= 98) { setError('This chat is full. Start a new chat to continue.'); return; }
    if (!provider || !scopeAllowed(scopeKind)) { setError('Enable explicitly invoked AI and this content scope in Settings.'); return; }
    if (scopeKind === 'currentNote' && !workspace.selectedNote || scopeKind === 'selectedNotes' && !selectedIds.length || scopeKind === 'folderResults' && !folderId || scopeKind === 'baseResults' && !baseId) { setError('Choose a source for this scope.'); return; }
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true); setError(null);
    const user: ChatMessage = { id: crypto.randomUUID(), role: 'user', text: prompt, createdAt: new Date().toISOString() };
    const withQuestion = [...messages, user];
    const previousQuestion = [...messages].reverse().find((item) => item.role === 'user')?.text;
    const retrievalQuestion = previousQuestion && /\b(it|its|this|that|those|they|them|their)\b/iu.test(prompt) ? `${previousQuestion} ${prompt}`.slice(0, 500) : prompt;
    setMessages(withQuestion); setQuestion('');
    try {
      search.current ??= new SearchClient();
      const lookup = (query: string) => search.current!.search(repository, vaultId, query, 100);
      const selectedChoice = choice();
      const candidates = await resolveChatCandidates({ choice: selectedChoice, notes: workspace.notes, folders: workspace.folders, bases, search: lookup });
      const retrieval = await retrieveChatContext({ vaultId, question: retrievalQuestion, choice: selectedChoice, candidates, repository, search: lookup, currentNote: workspace.selectedNote });
      let answer = insufficientVaultEvidence;
      let sources: ChatSource[] = [];
      if (retrieval.sources.length) {
        const previous = messages.flatMap((item, index) => item.role === 'user' && messages[index + 1]?.role === 'assistant' ? [{ question: item.text, answer: messages[index + 1]!.text }] : []);
        const completion = await aiGateway.runChat({
          providerId: provider.id, prompt: vaultChatPrompt, userInstruction: vaultChatUserQuestion(prompt, previous), scope: retrieval.scope, content: retrieval.content,
          getPolicy: currentAiPolicy, signal: abort.signal,
          review: (plan) => { setReviewPlan(plan); return new Promise<boolean>((resolve) => { resolveReview.current = resolve; }); },
        });
        const verified = verifyGroundedAnswer(completion.text, retrieval.sources);
        answer = verified.text; sources = verified.cited;
      }
      if (!abort.signal.aborted) {
        const assistant: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', text: answer, sources, createdAt: new Date().toISOString() };
        const next = [...withQuestion, assistant];
        setMessages(next);
        await persist(next);
      }
    } catch (caught) { if (!abort.signal.aborted) { setError(caught instanceof Error ? caught.message : 'Could not answer the question.'); setQuestion(prompt); } }
    finally { resolveReview.current = null; setReviewPlan(null); controller.current = null; setBusy(false); }
  };
  const cancel = () => { resolveReview.current?.(false); resolveReview.current = null; controller.current?.abort(); setReviewPlan(null); setBusy(false); };
  const removeSession = async (id: string) => {
    try { await history.current?.remove(vaultId, id); setSessions((current) => current.filter((item) => item.id !== id)); if (sessionId === id) { setSessionId(crypto.randomUUID()); setMessages([]); } setError(null); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not delete chat history.'); }
  };
  const clearAll = async () => {
    try { await history.current?.clear(vaultId); setSessions([]); setSessionId(crypto.randomUUID()); setMessages([]); setConfirmClear(false); setError(null); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not delete chat history.'); }
  };
  const filteredChoices = workspace.notes.filter((note) => `${note.title} ${note.path}`.toLocaleLowerCase().includes(selectionFilter.toLocaleLowerCase())).slice(0, 60);
  const openSource = (source: ChatSource) => {
    if (!workspace.notes.some((item) => item.id === source.noteId)) { setError('That cited note is no longer available in this vault.'); return; }
    setError(null); onOpenSource(source);
  };
  const exportChats = () => {
    const saved = sessions.find((item) => item.id === sessionId);
    const current = messages.length ? [{ id: sessionId, vaultId, title: messages.find((item) => item.role === 'user')?.text.slice(0, 100) ?? 'Chat', createdAt: saved?.createdAt ?? messages[0]!.createdAt, updatedAt: messages.at(-1)!.createdAt, messages }] : [];
    downloadText('noor-note-chat-history.json', JSON.stringify({ version: 1, vaultId, sessions: [...sessions.filter((item) => item.id !== sessionId), ...current] }, null, 2), 'application/json');
  };

  return <main className={styles.root} aria-label="Chat with your vault">
    <header className={styles.header}><button type="button" className={styles.mobileMenu} aria-label="Open navigation" onClick={onOpenNavigation}><Menu size={20} /></button><div><span className={styles.eyebrow}>NOOR NOTE AI</span><h1>Chat with your vault</h1></div><div className={styles.headerActions}><button type="button" disabled={busy || !sessions.length && !messages.length} onClick={exportChats}><Download size={16} /> Export chats</button><button type="button" disabled={busy} onClick={newChat}><Plus size={16} /> New chat</button></div></header>
    <div className={styles.layout}>
      <aside className={styles.controls} aria-label="Chat sources and history">
        <label>Source scope<select aria-label="Source scope" value={scopeKind} disabled={busy} onChange={(event) => setScopeKind(event.target.value as ChatScopeChoice['kind'])}><option value="currentNote">Current note</option><option value="selectedNotes">Selected notes</option><option value="folderResults">Folder</option><option value="baseResults">Base</option><option value="vaultRetrieval">Entire vault</option></select></label>
        {scopeKind === 'currentNote' && <p className={styles.helper}>{workspace.selectedNote?.path ?? 'Open a note to use this scope.'}</p>}
        {scopeKind === 'selectedNotes' && <div className={styles.selection}><label>Find notes<input value={selectionFilter} disabled={busy} onChange={(event) => setSelectionFilter(event.target.value)} placeholder="Filter notes" /></label><div className={styles.noteChoices}>{filteredChoices.map((note) => <label key={note.id}><input type="checkbox" checked={selectedIds.includes(note.id)} disabled={busy || selectedIds.length >= 20 && !selectedIds.includes(note.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, note.id].slice(0, 20) : current.filter((id) => id !== note.id))} /><span>{note.title}</span></label>)}</div><small>{selectedIds.length} selected, up to 20</small></div>}
        {scopeKind === 'folderResults' && <label>Folder<select value={folderId} disabled={busy} onChange={(event) => setFolderId(event.target.value)}><option value="">Choose a folder</option>{workspace.folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.path}</option>)}</select></label>}
        {scopeKind === 'baseResults' && <label>Base<select value={baseId} disabled={busy} onChange={(event) => setBaseId(event.target.value)}><option value="">Choose a Base</option>{bases.map((base) => <option key={base.id} value={base.id}>{base.title}</option>)}</select></label>}
        {scopeKind === 'vaultRetrieval' && <p className={styles.helper}>Searches this vault locally and reviews only matching passages.</p>}
        {!scopeAllowed(scopeKind) && <div className={styles.permission}><p>AI is disabled for this source scope.</p><button type="button" onClick={onOpenSettings}>Open AI settings</button></div>}
        <label className={styles.saveToggle}><input type="checkbox" checked={saveHistory} disabled={busy} onChange={(event) => { setSaveHistory(event.target.checked); if (event.target.checked && messages.length) void persist(messages, true).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Could not save chat history.')); }} /> Save this conversation on this device</label>
        <div className={styles.historyHeader}><strong>Saved chats</strong>{sessions.length > 0 && <button type="button" disabled={busy} onClick={() => setConfirmClear(true)}>Delete all</button>}</div>
        {confirmClear && <div className={styles.confirm}><p>Delete all saved chats in this vault?</p><button type="button" disabled={busy} onClick={() => setConfirmClear(false)}>Cancel</button><button type="button" disabled={busy} onClick={() => { void clearAll(); }}>Delete all</button></div>}
        <div className={styles.sessions}>{sessions.map((session) => <div className={styles.session} key={session.id}><button type="button" disabled={busy} onClick={() => { setSessionId(session.id); setMessages(session.messages); setSaveHistory(true); setError(null); }}>{session.title}</button><button type="button" disabled={busy} aria-label={`Delete chat ${session.title}`} onClick={() => { void removeSession(session.id); }}><Trash2 size={15} /></button></div>)}</div>
      </aside>
      <section className={styles.conversation} aria-label="Conversation">
        <div className={styles.messages} role="log" aria-live="polite">{messages.length ? messages.map((message) => <article className={`${styles.message} ${message.role === 'user' ? styles.user : styles.assistant}`} key={message.id}><strong>{message.role === 'user' ? 'You' : 'Noor Note'}</strong>{message.role === 'user' ? <p>{message.text}</p> : <><CitedAnswer text={message.text} sources={message.sources} onOpenSource={openSource} />{message.sources.length > 0 && <div className={styles.sources}><span>Sources</span>{message.sources.map((source) => <button type="button" key={source.id} onClick={() => openSource(source)}><BookOpenText size={14} /> {source.title}{source.heading ? ` / ${source.heading}` : ` / line ${source.line}`}{source.blockId ? ` ^${source.blockId}` : ''}{workspace.notes.find((item) => item.id === source.noteId)?.revision !== source.revision ? ' · changed since answer' : ''}</button>)}</div>}</>}</article>) : <div className={styles.empty}><BookOpenText size={30} /><h2>Ask about your notes</h2><p>Choose a source scope, then ask a question. Noor Note retrieves a few passages and shows exactly what the local model will read.</p></div>}</div>
        {reviewPlan && <section className={styles.review} aria-label="AI request review"><h2>Review source passages</h2><p>{reviewPlan.provider.name} · {reviewPlan.provider.model} · {reviewPlan.provider.execution === 'onDevice' ? 'On this device' : reviewPlan.provider.recipient}</p><p>Scope: {reviewPlan.scope.kind}. Only the passages below will be supplied.</p><details open><summary>Application task, user request, and untrusted passages</summary><pre>{reviewPlan.prompt}</pre>{reviewPlan.userInstruction && <pre>{reviewPlan.userInstruction}</pre>}{reviewPlan.content.map((item) => <div key={item.noteId}><strong>{item.path}</strong><pre>{item.markdown}</pre></div>)}</details><div className={styles.actions}><button type="button" onClick={() => { resolveReview.current?.(false); resolveReview.current = null; }}>Decline</button><button type="button" onClick={() => { resolveReview.current?.(true); resolveReview.current = null; setReviewPlan(null); }}>Approve and ask</button></div></section>}
        {busy && !reviewPlan && <p className={styles.status} role="status">Retrieving passages or running the local model… <button type="button" onClick={cancel}>Cancel</button></p>}
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <form className={styles.composer} onSubmit={(event) => { event.preventDefault(); void send(); }}><label htmlFor="vault-chat-question">Question</label><textarea id="vault-chat-question" value={question} maxLength={500} rows={3} disabled={busy} onChange={(event) => setQuestion(event.target.value)} placeholder="What do my notes say about…?" /><div><small>Local model first use downloads about 182 MB. Answers require source citations; chat history is optional.</small><button type="submit" disabled={busy || messages.length >= 98 || !question.trim() || !scopeAllowed(scopeKind)}><Send size={16} /> Ask</button></div></form>
      </section>
    </div>
    <button type="button" className={styles.back} onClick={onOpenSettings}><ArrowLeft size={15} /> AI settings</button>
  </main>;
}
