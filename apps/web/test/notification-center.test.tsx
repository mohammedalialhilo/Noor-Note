// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { NoorNotification } from '@noor-note/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotificationCenter } from '../src/components/NotificationCenter';

afterEach(cleanup);

describe('notification center', () => {
  it('filters unread items, marks them read, and opens their source', () => {
    const item: NoorNotification = { id: crypto.randomUUID(), kind: 'sync_issue', title: 'Sync needs attention',
      body: 'Open settings', vaultId: crypto.randomUUID(), destination: { kind: 'settings', section: 'sync' },
      createdAt: new Date().toISOString(), readAt: null, origin: 'local' };
    const onMarkRead = vi.fn(async () => undefined), onMarkUnread = vi.fn(async () => undefined), onNavigate = vi.fn(), onMarkAllRead = vi.fn(async () => undefined);
    const onFilterChange = vi.fn();
    const onLoadMore = vi.fn(async () => undefined);
    const props = { open: true, onOpenChange: vi.fn(), error: null, loading: false, unreadCount: 1,
      hasMore: true, loadingMore: false, onLoadMore,
      onFilterChange, onRefresh: vi.fn(async () => undefined), onMarkRead, onMarkUnread, onMarkAllRead, onNavigate };
    const view = render(<NotificationCenter {...props} items={[item]} filter="all" />);
    fireEvent.change(screen.getByLabelText('Filter notifications'), { target: { value: 'unread' } });
    expect(onFilterChange).toHaveBeenCalledWith('unread');
    view.rerender(<NotificationCenter {...props} items={[item]} filter="unread" />);
    fireEvent.click(screen.getByRole('button', { name: 'Load older notifications' }));
    expect(onLoadMore).toHaveBeenCalledOnce();
    expect(screen.getByText('Sync needs attention')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    expect(onMarkAllRead).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Open source for Sync needs attention' }));
    expect(onNavigate).toHaveBeenCalledWith(item);
    expect(onMarkRead).toHaveBeenCalledWith(item);
    view.rerender(<NotificationCenter {...props} items={[{ ...item, readAt: new Date().toISOString() }]} filter="all" unreadCount={0} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mark Sync needs attention unread' }));
    expect(onMarkUnread).toHaveBeenCalledOnce();
  });
});
