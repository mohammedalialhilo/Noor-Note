// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeVaultNote, type VaultNote } from '@noor-note/core';
import { toNoteEntry, type VaultRepository } from '@noor-note/storage';
import { OrganizationReview } from '../src/components/OrganizationReview';
import type { useVaultWorkspace } from '../src/hooks/useVaultWorkspace';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('organization review', () => {
  it('shows an exact preview, applies only after acceptance, then undoes with a revision check', async () => {
    const vaultId = crypto.randomUUID();
    let current = await makeVaultNote({ vaultId, title: 'Plan', markdown: 'Due: 2026-10-01' });
    const applyVaultNoteEdits = vi.fn(async (_id: string, changes: { before: string; after: string; revision: number }[]) => {
      expect(changes).toHaveLength(1);
      expect(changes[0]!.before).toBe(current.markdown);
      expect(changes[0]!.revision).toBe(current.revision);
      current = { ...current, markdown: changes[0]!.after, revision: current.revision + 1 } as VaultNote;
      return [current];
    });
    const repository = { getNote: async () => current, listTree: async () => ({ vault: { id: vaultId }, notes: [toNoteEntry(current)], folders: [], attachments: [] }), applyVaultNoteEdits } as unknown as VaultRepository;
    const workspace = { activeVault: { id: vaultId }, notes: [toNoteEntry(current)], folders: [], repository, flushPending: async () => undefined, refreshActive: async () => undefined } as unknown as ReturnType<typeof useVaultWorkspace>;
    render(<OrganizationReview workspace={workspace} onOpenNote={() => undefined} onOpenNavigation={() => undefined} onOpenSettings={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Scan vault' }));
    const card = (await screen.findByText('Add due property')).closest('article')!;
    expect(applyVaultNoteEdits).not.toHaveBeenCalled();
    fireEvent.click(within(card).getByRole('button', { name: 'Preview' }));
    expect(within(card).getByText('Before')).toBeTruthy();
    expect(within(card).getByText('After')).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(applyVaultNoteEdits).toHaveBeenCalledTimes(1));
    expect(current.markdown).toContain('due:');
    fireEvent.click(await screen.findByRole('button', { name: /Undo last acceptance/ }));
    await waitFor(() => expect(applyVaultNoteEdits).toHaveBeenCalledTimes(2));
    expect(current.markdown).toBe('Due: 2026-10-01');
  });
});
