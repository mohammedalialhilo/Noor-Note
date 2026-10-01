'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { History, Menu, SlidersHorizontal } from 'lucide-react';
import type { NoteEntry } from '@noor-note/storage';
import { useAccount } from '../auth/AuthProvider';
import { activityKindSchema, activityPageSize, describeActivity, emptyActivityFilters, loadActivityOptions, loadActivityPage, type ActivityActor, type ActivityEvent, type ActivityFilters, type ActivityNote } from '../lib/activity';
import styles from './SharedActivity.module.css';

interface Props {
  vaultId: string; enabled: boolean; notes: NoteEntry[];
  onOpenNote: (noteId: string) => void; onOpenSettings: () => void;
  onOpenNavigation: (event: MouseEvent<HTMLButtonElement>) => void;
}
const kinds = {
  note_created: 'Note created', note_renamed: 'Note renamed', note_moved: 'Note moved', note_restored: 'Note restored',
  member_invited: 'Member invited', member_removed: 'Member removed', permission_changed: 'Permission changed',
  comment_added: 'Comment added', comment_resolved: 'Comment resolved', revision_restored: 'Revision restored',
} as const;

export function SharedActivity({ vaultId, enabled, notes, onOpenNote, onOpenSettings, onOpenNavigation }: Props) {
  const { client, user } = useAccount();
  const [filters, setFilters] = useState<ActivityFilters>(emptyActivityFilters);
  const [actors, setActors] = useState<ActivityActor[]>([]);
  const [noteOptions, setNoteOptions] = useState<ActivityNote[]>([]);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [nextPage, setNextPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const noteNames = useMemo(() => new Map(notes.map((note) => [note.id, note.title || 'Untitled note'])), [notes]);
  const refresh = useCallback(async () => {
    if (!client || !enabled) return;
    const sequence = ++requestSequence.current;
    if (filters.from && filters.to && filters.from > filters.to) { setError('Start date must be on or before end date.'); return; }
    setLoading(true); setError(null);
    try {
      const [items, options] = await Promise.all([loadActivityPage(client, vaultId, filters, 0), loadActivityOptions(client, vaultId)]);
      if (sequence !== requestSequence.current) return;
      setEvents(items); setActors(options.actors); setNoteOptions(options.notes);
      setHasMore(items.length === activityPageSize); setNextPage(1);
    } catch (cause) { if (sequence === requestSequence.current) setError(cause instanceof Error ? cause.message : 'Could not load shared activity.'); }
    finally { if (sequence === requestSequence.current) setLoading(false); }
  }, [client, enabled, filters, vaultId]);
  useEffect(() => { queueMicrotask(() => { void refresh(); }); }, [refresh]);
  useEffect(() => {
    if (!client || !enabled) return;
    let channel: RealtimeChannel | null = null, cancelled = false;
    void client.realtime.setAuth().then(() => {
      if (cancelled) return;
      channel = client.channel(`noor:activity:${vaultId}`, { config: { private: true } });
      channel.on('broadcast', { event: 'changed' }, () => { void refresh(); }).subscribe();
    }).catch(() => undefined);
    return () => { cancelled = true; if (channel) void client.removeChannel(channel); };
  }, [client, enabled, refresh, vaultId]);
  const loadMore = async () => {
    if (!client || !enabled || loadingMore) return;
    const sequence = requestSequence.current;
    setLoadingMore(true); setError(null);
    try {
      const items = await loadActivityPage(client, vaultId, filters, nextPage);
      if (sequence !== requestSequence.current) return;
      setEvents((current) => {
        const known = new Set(current.map((item) => item.id));
        return [...current, ...items.filter((item) => !known.has(item.id))];
      });
      setNextPage((page) => page + 1); setHasMore(items.length === activityPageSize);
    } catch (cause) { if (sequence === requestSequence.current) setError(cause instanceof Error ? cause.message : 'Could not load more activity.'); }
    finally { setLoadingMore(false); }
  };
  const update = <K extends keyof ActivityFilters>(key: K, value: ActivityFilters[K]) => setFilters((current) => ({ ...current, [key]: value }));
  return <main className={styles.root} aria-label="Shared activity">
    <header className={styles.header}><button type="button" className="icon-button mobile-menu" aria-label="Open navigation" onClick={onOpenNavigation}><Menu size={20} /></button><div><span className={styles.eyebrow}>SHARED WORKSPACE</span><h1><History size={23} /> Activity</h1><p>Meaningful changes across this vault</p></div></header>
    {!enabled || !client ? <section className={styles.empty}><History size={35} /><h2>Shared activity is available with cloud sync.</h2><p>Sign in and enable sync for this vault to see changes made by its members.</p><button type="button" onClick={onOpenSettings}>Open sync settings</button></section> : <>
      <section className={styles.filters} aria-label="Activity filters"><div className={styles.filterTitle}><SlidersHorizontal size={16} /><strong>Filter activity</strong><button type="button" onClick={() => setFilters(emptyActivityFilters)}>Clear filters</button></div>
        <div className={styles.filterGrid}>
          <label>User<select value={filters.actorId} onChange={(event) => update('actorId', event.target.value)}><option value="">Everyone</option>{actors.map((actor) => <option key={actor.actor_id} value={actor.actor_id}>{actor.actor_id === user?.id ? 'You' : actor.actor_email}</option>)}</select></label>
          <label>Event<select value={filters.kind} onChange={(event) => update('kind', event.target.value ? activityKindSchema.parse(event.target.value) : '')}><option value="">All events</option>{activityKindSchema.options.map((kind) => <option key={kind} value={kind}>{kinds[kind]}</option>)}</select></label>
          <label>From<input type="date" value={filters.from} onChange={(event) => update('from', event.target.value)} /></label>
          <label>To<input type="date" value={filters.to} onChange={(event) => update('to', event.target.value)} /></label>
          <label>Note<select value={filters.noteId} onChange={(event) => update('noteId', event.target.value)}><option value="">All notes</option>{noteOptions.map((item) => <option key={item.note_id} value={item.note_id}>{item.title || 'Untitled note'}</option>)}</select></label>
        </div>
      </section>
      {error && <p className={styles.error} role="alert">{error} <button type="button" onClick={() => { void refresh(); }}>Retry</button></p>}
      <section className={styles.feed} aria-label="Activity events" aria-busy={loading}>
        {loading && <p role="status">Loading activity…</p>}
        {!loading && !events.length && <div className={styles.empty}><History size={30} /><h2>No activity matches these filters.</h2><p>New shared events will appear here after they are saved.</p></div>}
        {!loading && events.map((event) => <article key={event.id} className={styles.event}><span className={styles.marker} aria-hidden="true" /><div className={styles.eventText}><p><strong>{event.actor_id === null ? 'Former member' : event.actor_id === user?.id ? 'You' : event.actor_email}</strong> {describeActivity(event, event.note_id ? noteNames.get(event.note_id) : undefined)}</p><div className={styles.meta}><time dateTime={event.occurred_at}>{new Date(event.occurred_at).toLocaleString()}</time><span>{kinds[event.event_kind]}</span>{event.note_id && noteNames.has(event.note_id) && <button type="button" onClick={() => onOpenNote(event.note_id!)}>Open note</button>}</div></div></article>)}
        {!loading && hasMore && <button type="button" className={styles.more} disabled={loadingMore} onClick={() => { void loadMore(); }}>{loadingMore ? 'Loading…' : 'Load more activity'}</button>}
      </section>
    </>}
  </main>;
}
