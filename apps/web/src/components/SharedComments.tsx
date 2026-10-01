'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import type { RealtimeChannel } from '@supabase/supabase-js';
import * as Y from 'yjs';
import { useAccount } from '../auth/AuthProvider';
import { canComment, canEdit, canManage, type VaultRole } from '../lib/sharing';
import { commentAnchorSchema, resolveTextCommentAnchor, type CommentAnchor } from '../lib/comment-anchor';
import styles from './SharedComments.module.css';

const threadSchema = z.object({ id: z.uuid(), vault_id: z.uuid(), target_kind: z.enum(['note', 'canvas', 'pdf']), target_id: z.uuid(), anchor: commentAnchorSchema.nullable(), created_by: z.uuid(), created_at: z.iso.datetime({ offset: true }), resolved_at: z.iso.datetime({ offset: true }).nullable() });
const messageSchema = z.object({ id: z.uuid(), thread_id: z.uuid(), author_id: z.uuid(), body: z.string(), mentions: z.array(z.uuid()), created_at: z.iso.datetime({ offset: true }), edited_at: z.iso.datetime({ offset: true }).nullable(), deleted_at: z.iso.datetime({ offset: true }).nullable() });
type Thread = z.infer<typeof threadSchema>;
type Message = z.infer<typeof messageSchema>;
type TargetKind = Thread['target_kind'];
interface Props {
  vaultId: string; targetKind: TargetKind; targetId: string; role: VaultRole;
  draftAnchor?: CommentAnchor | null; onDraftUsed?: () => void;
  focusAnchorId?: string | null; markdown?: string; collaborativeText?: Y.Text;
  onNavigateText?: (from: number, to: number) => void; onNavigatePdf?: (page: number, annotationId: string) => void;
  onNavigateCanvas?: (nodeId: string) => void;
}

export function SharedComments({ vaultId, targetKind, targetId, role, draftAnchor, onDraftUsed, focusAnchorId, markdown, collaborativeText, onNavigateText, onNavigatePdf, onNavigateCanvas }: Props) {
  const { client, user } = useAccount();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [members, setMembers] = useState<{ user_id: string; email: string }[]>([]);
  const [body, setBody] = useState('');
  const [reply, setReply] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');
  const [showResolved, setShowResolved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registered, setRegistered] = useState(targetKind !== 'canvas');
  const refresh = useCallback(async () => {
    if (!client) return;
    const result = await client.from('noor_comment_threads').select('id,vault_id,target_kind,target_id,anchor,created_by,created_at,resolved_at')
      .eq('vault_id', vaultId).eq('target_kind', targetKind).eq('target_id', targetId).order('created_at');
    if (result.error) throw result.error;
    const parsed = z.array(threadSchema).parse(result.data);
    setThreads(parsed);
    if (!parsed.length) { setMessages([]); return; }
    const replies = await client.from('noor_comment_messages').select('id,thread_id,author_id,body,mentions,created_at,edited_at,deleted_at')
      .in('thread_id', parsed.map((item) => item.id)).order('created_at');
    if (replies.error) throw replies.error;
    setMessages(z.array(messageSchema).parse(replies.data));
  }, [client, vaultId, targetKind, targetId]);
  useEffect(() => { queueMicrotask(() => { void refresh().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Could not load comments.')); }); }, [refresh]);
  useEffect(() => {
    if (!client || !canComment(role)) return;
    void (async () => { const result = await client.rpc('noor_list_comment_participants', { p_vault: vaultId });
      if (!result.error) setMembers(z.array(z.object({ user_id: z.uuid(), email: z.email() })).parse(result.data));
    })().catch(() => undefined);
  }, [client, role, vaultId]);
  useEffect(() => {
    if (!client || targetKind !== 'canvas') return;
    void (async () => { const result = canEdit(role)
      ? await client.rpc('noor_register_comment_canvas', { p_vault: vaultId, p_canvas: targetId })
      : await client.rpc('noor_comment_canvas_available', { p_vault: vaultId, p_canvas: targetId });
      if (result.error) throw result.error;
      setRegistered(canEdit(role) || result.data === true);
    })().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Could not register Canvas comments.'));
  }, [client, role, targetKind, targetId, vaultId]);
  useEffect(() => {
    if (!client) return;
    let channel: RealtimeChannel | null = null;
    let cancelled = false;
    void client.realtime.setAuth().then(() => {
      if (cancelled) return;
      channel = client.channel(`noor:comments:${vaultId}`, { config: { private: true } });
      channel.on('broadcast', { event: 'changed' }, () => { void refresh().catch(() => undefined); }).subscribe();
    }).catch(() => undefined);
    return () => { cancelled = true; if (channel) void client.removeChannel(channel); };
  }, [client, vaultId, refresh]);
  const run = async (work: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await work(); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update comments.'); }
    finally { setBusy(false); }
  };
  const validBody = (value: string) => value.trim().length > 0 && value.trim().length <= 10000;
  const post = () => run(async () => {
    if (!client || !validBody(body)) return;
    const result = await client.rpc('noor_create_comment_thread', { p_vault: vaultId, p_kind: targetKind, p_target: targetId, p_anchor: draftAnchor ?? null, p_body: body.trim() });
    if (result.error) throw result.error;
    setBody(''); onDraftUsed?.();
  });
  const postReply = (threadId: string) => run(async () => {
    if (!client || !validBody(reply[threadId] ?? '')) return;
    const result = await client.rpc('noor_reply_comment', { p_thread: threadId, p_body: reply[threadId].trim() });
    if (result.error) throw result.error;
    setReply((current) => ({ ...current, [threadId]: '' }));
  });
  const edit = (id: string) => run(async () => {
    if (!client || !validBody(editBody)) return;
    const result = await client.rpc('noor_edit_comment', { p_message: id, p_body: editBody.trim() });
    if (result.error) throw result.error;
    setEditing(null);
  });
  const remove = (id: string) => run(async () => {
    if (!client || !window.confirm('Delete this comment? Replies will remain in the thread.')) return;
    const result = await client.rpc('noor_delete_comment', { p_message: id });
    if (result.error) throw result.error;
  });
  const resolve = (id: string, value: boolean) => run(async () => {
    if (!client) return;
    const result = await client.rpc('noor_set_comment_resolved', { p_thread: id, p_resolved: value });
    if (result.error) throw result.error;
  });
  const visible = useMemo(() => threads.filter((thread) => (showResolved || !thread.resolved_at) &&
    (focusAnchorId === undefined || focusAnchorId === null || (thread.anchor?.kind === 'pdf' && thread.anchor.annotationId === focusAnchorId)
      || (thread.anchor?.kind === 'canvas' && thread.anchor.nodeId === focusAnchorId))), [threads, showResolved, focusAnchorId]);
  const displayName = (id: string) => id === user?.id ? 'You' : members.find((item) => item.user_id === id)?.email ?? 'Member';
  const navigate = (anchor: CommentAnchor | null) => {
    if (anchor?.kind === 'text' && markdown !== undefined) { const range = resolveTextCommentAnchor(markdown, anchor, collaborativeText); if (range) onNavigateText?.(range.from, range.to); }
    if (anchor?.kind === 'pdf') onNavigatePdf?.(anchor.page, anchor.annotationId);
    if (anchor?.kind === 'canvas') onNavigateCanvas?.(anchor.nodeId);
  };
  const mentionOptions = (value: string) => {
    const match = value.match(/(?:^|\s)@([\w.+-]*)$/);
    return match ? members.filter((member) => member.email.toLowerCase().includes(match[1].toLowerCase())).slice(0, 6) : [];
  };
  const composer = (value: string, setValue: (value: string) => void, label: string, submit: () => void, submitLabel: string) => <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <label>{label}<textarea value={value} maxLength={10000} onChange={(event) => setValue(event.target.value)} /></label>
    {mentionOptions(value).length > 0 && <div role="group" aria-label="Mention a member">{mentionOptions(value).map((member) => <button key={member.user_id} type="button" onClick={() => setValue(value.replace(/@([\w.+-]*)$/, `@${member.email} `))}>@{member.email}</button>)}</div>}
    <button type="submit" disabled={busy || !validBody(value)}>{submitLabel}</button>
  </form>;
  return <section className={`${styles.root} details-section`} aria-label="Shared comments"><h3>Shared comments <span>{visible.length}</span></h3>
    {error && <p role="alert">{error}</p>}
    <label><input type="checkbox" checked={showResolved} onChange={(event) => setShowResolved(event.target.checked)} /> Show resolved</label>
    {visible.map((thread) => <article key={thread.id} className={styles.thread}>
      <div className={styles.heading}>{thread.anchor && <button type="button" disabled={thread.anchor.kind === 'text' && markdown !== undefined && !resolveTextCommentAnchor(markdown, thread.anchor, collaborativeText)} onClick={() => navigate(thread.anchor)}>{thread.anchor.kind === 'text' ? `“${thread.anchor.exact.slice(0, 80)}”${markdown !== undefined && !resolveTextCommentAnchor(markdown, thread.anchor, collaborativeText) ? ' (text changed)' : ''}` : thread.anchor.kind === 'canvas' ? 'Canvas card' : `PDF page ${thread.anchor.page}`}</button>}
        <span>{thread.resolved_at ? 'Resolved' : 'Open'}</span>
        {(canEdit(role) || thread.created_by === user?.id && canComment(role)) && <button type="button" disabled={busy} onClick={() => { void resolve(thread.id, !thread.resolved_at); }}>{thread.resolved_at ? 'Reopen' : 'Resolve'}</button>}
      </div>
      {messages.filter((message) => message.thread_id === thread.id).map((message) => <div className={styles.message} key={message.id}>
        <strong>{displayName(message.author_id)}</strong> <time dateTime={message.created_at}>{new Date(message.created_at).toLocaleString()}</time>
        {message.deleted_at ? <p><em>Comment deleted</em></p> : editing === message.id ? <div>{composer(editBody, setEditBody, 'Edit comment', () => { void edit(message.id); }, 'Save')}<button type="button" onClick={() => setEditing(null)}>Cancel</button></div> : <><p>{message.body}</p>{message.edited_at && <small>Edited</small>}{message.mentions.includes(user?.id ?? '') && <small> · Mentions you</small>}
          {message.author_id === user?.id && canComment(role) && <button type="button" onClick={() => { setEditing(message.id); setEditBody(message.body); }}>Edit</button>}
          {(message.author_id === user?.id && canComment(role) || canManage(role)) && <button type="button" disabled={busy} onClick={() => { void remove(message.id); }}>Delete</button>}</>}
      </div>)}
      {canComment(role) && !thread.resolved_at && composer(reply[thread.id] ?? '', (value) => setReply((current) => ({ ...current, [thread.id]: value })), 'Reply', () => { void postReply(thread.id); }, 'Reply')}
    </article>)}
    {canComment(role) && (targetKind !== 'canvas' || registered) && <div>{draftAnchor && <p>{draftAnchor.kind === 'text' ? `Comment on “${draftAnchor.exact.slice(0, 80)}”` : draftAnchor.kind === 'canvas' ? 'Comment on selected card' : `Comment on PDF page ${draftAnchor.page}`} <button type="button" onClick={onDraftUsed}>Clear target</button></p>}{composer(body, setBody, 'New comment', () => { void post(); }, 'Post comment')}</div>}
    {targetKind === 'canvas' && !registered && <p role="status">An editor must open this Canvas online before shared comments are available.</p>}
  </section>;
}
