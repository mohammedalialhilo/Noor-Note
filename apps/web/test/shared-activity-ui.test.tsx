// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { NoteEntry } from '@noor-note/storage';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SharedActivity } from '../src/components/SharedActivity';

const mockAccount = vi.hoisted(() => ({ client: null as SupabaseClient | null, user: null as User | null }));
vi.mock('../src/auth/AuthProvider', () => ({ useAccount: () => mockAccount }));
afterEach(() => { cleanup(); mockAccount.client = null; mockAccount.user = null; });

describe('shared activity', () => {
  it('filters server events by user, kind, date, and note and opens a source note', async () => {
    const vaultId = crypto.randomUUID(), noteId = crypto.randomUUID(), actorId = crypto.randomUUID();
    const event = {
      id: crypto.randomUUID(), vault_id: vaultId, actor_id: actorId, actor_email: 'editor@example.test',
      event_kind: 'note_renamed', note_id: noteId, target_user_id: null,
      details: { title: 'Roadmap', previousTitle: 'Plan' }, occurred_at: '2026-09-30T12:00:00+00:00',
    };
    const query = {
      eq: vi.fn(), gte: vi.fn(), lt: vi.fn(), order: vi.fn(),
      range: vi.fn(async () => ({ data: [event], error: null })),
    };
    for (const key of ['eq', 'gte', 'lt', 'order'] as const) query[key].mockReturnValue(query);
    const client = {
      from: vi.fn(() => ({ select: () => query })),
      rpc: vi.fn(async (name: string) => ({
        data: name === 'noor_list_activity_actors'
          ? [{ actor_id: actorId, actor_email: 'editor@example.test' }]
          : [{ note_id: noteId, title: 'Roadmap' }], error: null,
      })),
      realtime: { setAuth: vi.fn(async () => undefined) },
      channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })),
      removeChannel: vi.fn(async () => undefined),
    } as unknown as SupabaseClient;
    mockAccount.client = client;
    mockAccount.user = { id: crypto.randomUUID() } as User;
    const openNote = vi.fn();
    render(<SharedActivity vaultId={vaultId} enabled notes={[{ id: noteId, title: 'Roadmap' } as NoteEntry]}
      onOpenNote={openNote} onOpenSettings={vi.fn()} onOpenNavigation={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Renamed Plan to Roadmap')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('User'), { target: { value: actorId } });
    fireEvent.change(screen.getByLabelText('Event'), { target: { value: 'note_renamed' } });
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-09-30' } });
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: noteId } });
    await waitFor(() => {
      expect(query.eq).toHaveBeenCalledWith('actor_id', actorId);
      expect(query.eq).toHaveBeenCalledWith('event_kind', 'note_renamed');
      expect(query.eq).toHaveBeenCalledWith('note_id', noteId);
      expect(query.gte).toHaveBeenCalledWith('occurred_at', expect.any(String));
      expect(query.lt).toHaveBeenCalledWith('occurred_at', expect.any(String));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open note' }));
    expect(openNote).toHaveBeenCalledWith(noteId);
  });
});
