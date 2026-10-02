'use client';

import { Bell, CheckCheck, RefreshCw } from 'lucide-react';
import { Dialog } from '@noor-note/ui';
import type { NoorNotification } from '@noor-note/core';
import type { NotificationFilter } from '../lib/notifications';
import styles from './NotificationCenter.module.css';

const labels: Record<NoorNotification['kind'], string> = {
  sync_issue: 'Sync issue', collaboration_invite: 'Invitation', mention: 'Mention',
  comment_reply: 'Comment reply', share_changed: 'Sharing', backup_failure: 'Backup failure', app_update: 'App update',
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: NoorNotification[];
  filter: NotificationFilter;
  onFilterChange: (filter: NotificationFilter) => void;
  unreadCount: number;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => Promise<void>;
  error: string | null;
  loading: boolean;
  onRefresh: () => Promise<void>;
  onMarkRead: (item: NoorNotification) => Promise<void>;
  onMarkUnread: (item: NoorNotification) => Promise<void>;
  onMarkAllRead: () => Promise<void>;
  onNavigate: (item: NoorNotification) => void;
}

export function NotificationCenter({ open, onOpenChange, items, filter, onFilterChange, unreadCount, hasMore, loadingMore, onLoadMore, error, loading, onRefresh, onMarkRead, onMarkUnread, onMarkAllRead, onNavigate }: Props) {
  return <Dialog title="Notifications" description="Important events from Noor Note and shared vaults." open={open} onOpenChange={onOpenChange} contentClassName={styles.dialog}>
    <div className={styles.controls}>
      <label>Show <select aria-label="Filter notifications" value={filter} onChange={(event) => onFilterChange(event.target.value as NotificationFilter)}>
        <option value="all">All</option><option value="unread">Unread</option>
        {Object.entries(labels).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
      </select></label>
      <button type="button" onClick={() => { void onRefresh(); }} aria-label="Refresh notifications"><RefreshCw size={16} /></button>
      <button type="button" disabled={!unreadCount} onClick={() => { void onMarkAllRead(); }}><CheckCheck size={16} /> Mark all read</button>
    </div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.list} aria-label="Notification list">
      {!items.length && (loading ? <p role="status">Loading notifications…</p> : <div className={styles.empty}><Bell size={27} /><strong>{filter === 'all' ? 'All caught up' : 'No notifications match this filter'}</strong><p>Invites, replies, mentions, and important app issues will appear here.</p></div>)}
      {items.map((item) => <article key={`${item.origin}:${item.id}`} className={`${styles.item} ${item.readAt ? '' : styles.unread}`}>
        <div className={styles.itemTop}><span>{labels[item.kind]}{!item.readAt && <span className="sr-only">, unread</span>}</span><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time></div>
        <h3>{item.title}</h3><p>{item.body}</p>
        <div className={styles.actions}>
          <button type="button" aria-label={`Open source for ${item.title}`} onClick={() => { onNavigate(item); if (!item.readAt) void onMarkRead(item); onOpenChange(false); }}>Open source</button>
          {!item.readAt && <button type="button" aria-label={`Mark ${item.title} read`} onClick={() => { void onMarkRead(item); }}>Mark read</button>}
          {item.readAt && <button type="button" aria-label={`Mark ${item.title} unread`} onClick={() => { void onMarkUnread(item); }}>Mark unread</button>}
        </div>
      </article>)}
      {hasMore && <button type="button" className={styles.more} disabled={loadingMore} onClick={() => { void onLoadMore(); }}>{loadingMore ? 'Loading…' : 'Load older notifications'}</button>}
    </div>
  </Dialog>;
}
