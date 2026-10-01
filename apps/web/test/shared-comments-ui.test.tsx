// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SharedComments } from '../src/components/SharedComments';

const mockAccount = vi.hoisted(() => ({ client: null as SupabaseClient | null, user: null as User | null }));
vi.mock('../src/auth/AuthProvider', () => ({ useAccount: () => mockAccount }));
afterEach(() => { cleanup(); mockAccount.client = null; mockAccount.user = null; });

describe('shared comment panel', () => {
  it('posts an inline anchored thread and hides writing controls from viewers', async () => {
    const vaultId = crypto.randomUUID(), noteId = crypto.randomUUID(), userId = crypto.randomUUID();
    const rpc = vi.fn(async (name: string) => ({ data: name === 'noor_list_comment_participants' ? [] : null, error: null }));
    const query = { eq: vi.fn(), order: vi.fn(async () => ({ data: [], error: null })) };
    query.eq.mockReturnValue(query);
    const client = {
      from: vi.fn(() => ({ select: () => query })), rpc,
      realtime: { setAuth: vi.fn(async () => undefined) },
      channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })),
      removeChannel: vi.fn(async () => undefined),
    } as unknown as SupabaseClient;
    mockAccount.client = client;
    mockAccount.user = { id: userId } as User;
    const anchor = { kind: 'text' as const, exact: 'selected', prefix: 'before ', suffix: ' after', start: 7, end: 15 };
    const onDraftUsed = vi.fn();
    const view = render(<SharedComments vaultId={vaultId} targetKind="note" targetId={noteId} role="commenter" draftAnchor={anchor} onDraftUsed={onDraftUsed} markdown="before selected after" />);
    await waitFor(() => expect(screen.getByLabelText('New comment')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('New comment'), { target: { value: 'Please review @owner@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post comment' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('noor_create_comment_thread', expect.objectContaining({ p_vault: vaultId, p_kind: 'note', p_target: noteId, p_anchor: anchor, p_body: 'Please review @owner@example.test' })));
    await waitFor(() => expect(onDraftUsed).toHaveBeenCalled());
    view.rerender(<SharedComments vaultId={vaultId} targetKind="note" targetId={noteId} role="viewer" markdown="before selected after" />);
    expect(screen.queryByLabelText('New comment')).toBeNull();
  });
});
