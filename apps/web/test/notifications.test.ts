import { describe, expect, it } from 'vitest';
import { notificationFilter, parseCloudNotifications } from '../src/lib/notifications';

describe('notifications', () => {
  it('validates the recipient and maps comment targets to real destinations', () => {
    const userId = crypto.randomUUID(), vaultId = crypto.randomUUID(), noteId = crypto.randomUUID();
    const row = { id: crypto.randomUUID(), recipient_id: userId, vault_id: vaultId, kind: 'mention',
      title: 'You were mentioned', body: 'A comment mentioned you.', target_kind: 'note', target_id: noteId,
      expires_at: null, created_at: new Date().toISOString(), read_at: null };
    const [item] = parseCloudNotifications([row], userId);
    expect(item?.destination).toEqual({ kind: 'note', vaultId, noteId });
    expect(notificationFilter([item!], 'unread')).toHaveLength(1);
    expect(notificationFilter([{ ...item!, readAt: new Date().toISOString() }], 'unread')).toHaveLength(0);
    expect(() => parseCloudNotifications([row], crypto.randomUUID())).toThrow('recipient mismatch');
    expect(parseCloudNotifications([{ ...row, kind: 'collaboration_invite', expires_at: new Date(Date.now() - 1000).toISOString() }], userId)).toEqual([]);
  });
});
