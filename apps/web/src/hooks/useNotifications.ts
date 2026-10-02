'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NoorNotification } from '@noor-note/core';
import { DexieNotificationStore, type LocalNotificationInput } from '@noor-note/storage';
import { countCloudUnread, loadCloudNotifications, markAllCloudNotificationsRead, markCloudNotificationRead, markCloudNotificationUnread, notificationFilter, notificationPageSize, type NotificationFilter } from '../lib/notifications';

export function useNotifications(client: SupabaseClient | null, userId: string | null, vaultId: string | null) {
  const storeRef = useRef<DexieNotificationStore | null>(null);
  const [local, setLocal] = useState<{ ownerKey: string; vaultId: string | null; items: NoorNotification[] }>({ ownerKey: '', vaultId: null, items: [] });
  const [cloud, setCloud] = useState<{ userId: string | null; filter: NotificationFilter; items: NoorNotification[]; total: number; nextOffset: number }>({ userId: null, filter: 'all', items: [], total: 0, nextOffset: 0 });
  const [cloudUnread, setCloudUnread] = useState<{ userId: string | null; count: number }>({ userId: null, count: 0 });
  const [filter, setFilter] = useState<NotificationFilter>('all');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const requestSequence = useRef(0);
  const ownerKey = userId ?? 'device';
  const store = useCallback(() => storeRef.current ?? (storeRef.current = new DexieNotificationStore()), []);
  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    const operations = await Promise.allSettled([
      Promise.resolve().then(() => store().list(ownerKey, vaultId)),
      client && userId ? loadCloudNotifications(client, userId, filter) : Promise.resolve({ items: [], total: 0 }),
      client && userId ? countCloudUnread(client, userId) : Promise.resolve(0),
    ]);
    if (sequence !== requestSequence.current) return;
    if (operations[0].status === 'fulfilled') setLocal({ ownerKey, vaultId, items: operations[0].value });
    if (operations[1].status === 'fulfilled') setCloud({ userId, filter, ...operations[1].value, nextOffset: notificationPageSize });
    if (operations[2].status === 'fulfilled') setCloudUnread({ userId, count: operations[2].value });
    const failed = operations.find((result) => result.status === 'rejected');
    setError(failed?.status === 'rejected' ? failed.reason instanceof Error ? failed.reason.message : 'Could not load notifications.' : null);
    setLoading(false);
  }, [client, filter, ownerKey, store, userId, vaultId]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void refresh(); });
    const check = () => { if (document.visibilityState === 'visible') void refresh(); };
    const timer = window.setInterval(check, 30_000);
    window.addEventListener('online', check);
    document.addEventListener('visibilitychange', check);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('online', check); document.removeEventListener('visibilitychange', check); };
  }, [refresh]);
  useEffect(() => () => { storeRef.current?.close(); storeRef.current = null; }, []);

  const recordLocal = useCallback(async (input: Omit<LocalNotificationInput, 'ownerKey'>, rearm = false) => {
    try {
      await store().record({ ...input, ownerKey }, rearm);
      setLocal({ ownerKey, vaultId, items: await store().list(ownerKey, vaultId) });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save notification.'); }
  }, [ownerKey, store, vaultId]);
  const markRead = useCallback(async (notification: NoorNotification) => {
    try {
      if (notification.origin === 'cloud') {
        if (!client || !userId) return;
        await markCloudNotificationRead(client, userId, notification.id);
      } else await store().markRead(ownerKey, notification.id);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not mark notification read.'); }
  }, [client, ownerKey, refresh, store, userId]);
  const markUnread = useCallback(async (notification: NoorNotification) => {
    try {
      if (notification.origin === 'cloud') {
        if (!client || !userId) return;
        await markCloudNotificationUnread(client, userId, notification.id);
      } else await store().markUnread(ownerKey, notification.id);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not mark notification unread.'); }
  }, [client, ownerKey, refresh, store, userId]);
  const markAllRead = useCallback(async () => {
    try {
      await Promise.all([store().markAllRead(ownerKey, vaultId), client && userId ? markAllCloudNotificationsRead(client, userId) : Promise.resolve()]);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not mark all notifications read.'); }
  }, [client, ownerKey, refresh, store, userId, vaultId]);
  const loadMore = useCallback(async () => {
    if (!client || !userId || loadingMore || cloud.userId !== userId || cloud.filter !== filter || cloud.nextOffset >= cloud.total) return;
    const sequence = requestSequence.current;
    setLoadingMore(true);
    try {
      const page = await loadCloudNotifications(client, userId, filter, cloud.nextOffset);
      if (sequence !== requestSequence.current) return;
      setCloud((current) => current.userId === userId && current.filter === filter ? {
        ...current, total: page.total, nextOffset: current.nextOffset + notificationPageSize,
        items: [...current.items, ...page.items.filter((item) => !current.items.some((known) => known.id === item.id))],
      } : current);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load older notifications.'); }
    finally { setLoadingMore(false); }
  }, [client, cloud, filter, loadingMore, userId]);
  const currentCloud = cloud.userId === userId && cloud.filter === filter ? cloud : { items: [] as NoorNotification[], total: 0, nextOffset: 0 };
  const items = [
    ...notificationFilter(local.ownerKey === ownerKey && local.vaultId === vaultId ? local.items : [], filter),
    ...currentCloud.items,
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  const localUnread = local.ownerKey === ownerKey && local.vaultId === vaultId ? local.items.filter((item) => !item.readAt).length : 0;
  const remoteUnread = cloudUnread.userId === userId ? cloudUnread.count : 0;
  return { items, filter, setFilter, unreadCount: localUnread + remoteUnread, hasMore: currentCloud.nextOffset < currentCloud.total, loadingMore, loadMore, error, loading, refresh, recordLocal, markRead, markUnread, markAllRead };
}
