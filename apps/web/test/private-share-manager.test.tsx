// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { useVaultWorkspace } from '../src/hooks/useVaultWorkspace';
import type { useCloudSync } from '../src/hooks/useCloudSync';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrivateShareManager } from '../src/components/PrivateShareManager';

const account = vi.hoisted(() => ({ client: null as SupabaseClient | null, user: null as User | null }));
vi.mock('../src/auth/AuthProvider', () => ({ useAccount: () => account }));
afterEach(() => { cleanup(); account.client = null; account.user = null; });

describe('private share controls', () => {
  it('requires explicit approval, creates a one-time link, and revokes it', async () => {
    const vaultId = crypto.randomUUID(), noteId = crypto.randomUUID(), shareId = crypto.randomUUID(), token = 'c'.repeat(64);
    const listed: Array<Record<string, unknown>> = [];
    const query = { eq: vi.fn(), order: vi.fn(async () => ({ data: listed, error: null })) };
    query.eq.mockReturnValue(query);
    const rpc = vi.fn(async (name: string) => {
      if (name === 'noor_create_private_share') {
        listed.push({ id: shareId, vault_id: vaultId, note_id: noteId, title: 'Plan', password_required: true,
          expires_at: null, download_allowed: false, created_at: new Date().toISOString(), revoked_at: null });
        return { data: { id: shareId, token }, error: null };
      }
      listed[0]!.revoked_at = new Date().toISOString();
      return { data: true, error: null };
    });
    account.client = { from: vi.fn(() => ({ select: () => query })), rpc } as unknown as SupabaseClient;
    account.user = { id: crypto.randomUUID() } as User;
    const getNote = vi.fn(async () => ({ id: noteId, vaultId, path: '/Plan.md', title: 'Plan', markdown: `---\nsecret: hidden\n---\nShared body`, deletedAt: null }));
    const flushPending = vi.fn(async () => undefined);
    const workspace = { activeVault: { id: vaultId }, notes: [{ id: noteId, path: '/Plan.md', title: 'Plan', deletedAt: null }], repository: { getNote }, flushPending } as unknown as ReturnType<typeof useVaultWorkspace>;
    const sync = { enabled: true, encryption: 'none', role: 'owner' } as ReturnType<typeof useCloudSync>;
    render(<PrivateShareManager workspace={workspace} sync={sync} />);
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: noteId } });
    fireEvent.change(screen.getByLabelText('Optional password'), { target: { value: 'a sufficiently long secret' } });
    expect((screen.getByRole('button', { name: 'Create private link' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/I approve sharing this note body/u));
    fireEvent.click(screen.getByRole('button', { name: 'Create private link' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('noor_create_private_share', expect.objectContaining({
      p_vault_id: vaultId, p_note_id: noteId, p_markdown: 'Shared body', p_password: 'a sufficiently long secret', p_download_allowed: false,
    })));
    expect((await screen.findByLabelText('New private share link') as HTMLInputElement).value).toContain(`/s/${token}`);
    fireEvent.click(screen.getByRole('button', { name: 'Revoke now' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('noor_revoke_private_share', { p_share_id: shareId }));
    await waitFor(() => expect(screen.getByText(/Revoked · Password protected/u)).toBeTruthy());
    expect(screen.queryByLabelText('New private share link')).toBeNull();
    expect(flushPending).toHaveBeenCalledOnce();
  });
});
