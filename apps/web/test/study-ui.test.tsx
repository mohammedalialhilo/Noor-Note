// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DexieVaultRepository } from '@noor-note/storage';
import type { useVaultWorkspace } from '../src/hooks/useVaultWorkspace';
import { StudyView } from '../src/components/StudyView';

afterEach(cleanup);

describe('Study view', () => {
  it('previews note cards, imports them, reveals answers, and records a review', async () => {
    const name = `noor-note-study-ui-${crypto.randomUUID()}`;
    const repository = new DexieVaultRepository(name);
    try {
      const vault = await repository.initialize();
      const note = await repository.createNote(vault.id, null, 'Biology', 'Q:: Cell?\nA:: Basic unit');
      const tree = await repository.listTree(vault.id);
      const workspace = { repository, activeVault: vault, selectedNote: note, notes: tree.notes, flushPending: async () => undefined } as unknown as ReturnType<typeof useVaultWorkspace>;
      const open = vi.fn();
      render(<StudyView workspace={workspace} initialDraft={null} onOpenNote={open} onOpenNavigation={vi.fn()} readOnly={false} />);
      fireEvent.click(screen.getByRole('button', { name: 'Import from note' }));
      fireEvent.click(screen.getByRole('button', { name: 'Preview cards' }));
      expect(await screen.findByText('1 new candidates')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Add 1 selected cards' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Show answer' }));
      expect(screen.getByText('Basic unit')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Good' }));
      await waitFor(() => expect(screen.getByText('Nothing due now')).toBeTruthy());
      expect(screen.getByText('Reviews in 30 days').parentElement?.querySelector('strong')?.textContent).toBe('1');
    } finally { repository.close(); await Dexie.delete(name); }
  });
});
