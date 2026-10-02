// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DexieVaultRepository } from '@noor-note/storage';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecoveryCenter } from '../src/components/RecoveryCenter';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

describe('Recovery Center controls', () => {
  it('previews a deleted note, restores a copy, and leaves the original in Trash', async () => {
    const name = `noor-recovery-ui-${crypto.randomUUID()}`;
    const repository = new DexieVaultRepository(name);
    try {
      const vault = await repository.initialize();
      const note = await repository.createNote(vault.id, null, 'Lost', '# Important content');
      await repository.deleteNote(note.id);
      render(<RecoveryCenter vaultId={vault.id} repository={repository} beforeChange={async () => undefined} onChanged={async () => undefined} onOpenNote={() => undefined} onOpenTrash={() => undefined} onOpenNavigation={() => undefined} />);
      const deleted = await screen.findByRole('region', { name: 'Deleted notes and attachments' });
      await waitFor(() => expect(within(deleted).getByText('Lost')).toBeTruthy());
      fireEvent.click(within(deleted).getByRole('button', { name: 'Preview' }));
      expect(await screen.findByText('# Important content')).toBeTruthy();
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Restore as copy' }));
      await waitFor(async () => expect((await repository.listTree(vault.id)).notes).toHaveLength(1));
      expect((await repository.listTrash(vault.id)).notes.map((item) => item.id)).toContain(note.id);
      vi.stubGlobal('confirm', () => true);
      fireEvent.click(within(deleted).getByRole('button', { name: 'Delete forever' }));
      await waitFor(async () => expect((await repository.listTrash(vault.id)).notes).toHaveLength(0));
      expect((await repository.listTree(vault.id)).notes).toHaveLength(1);
    } finally { repository.close(); await Dexie.delete(name); }
  });

  it('requires confirmation before restoring an unsaved draft and keeps a revision', async () => {
    const name = `noor-recovery-draft-ui-${crypto.randomUUID()}`;
    const repository = new DexieVaultRepository(name);
    try {
      const vault = await repository.initialize();
      const note = await repository.createNote(vault.id, null, 'Draft', 'Saved text');
      localStorage.setItem(`noor-note-draft:${note.id}`, JSON.stringify({ vaultId: vault.id, title: 'Draft', markdown: 'Recovered text', updatedAt: Date.now() + 1000 }));
      const confirm = vi.fn(() => false);
      vi.stubGlobal('confirm', confirm);
      render(<RecoveryCenter vaultId={vault.id} repository={repository} beforeChange={async () => undefined} onChanged={async () => undefined} onOpenNote={() => undefined} onOpenTrash={() => undefined} onOpenNavigation={() => undefined} />);
      const drafts = await screen.findByRole('region', { name: 'Unsaved recovery snapshots' });
      await waitFor(() => expect(within(drafts).getByText('Draft')).toBeTruthy());
      fireEvent.click(within(drafts).getByRole('button', { name: 'Restore' }));
      await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
      expect((await repository.getNote(note.id))?.markdown).toBe('Saved text');
      confirm.mockReturnValue(true);
      fireEvent.click(within(drafts).getByRole('button', { name: 'Restore' }));
      await waitFor(async () => expect((await repository.getNote(note.id))?.markdown).toBe('Recovered text'));
      expect((await repository.listRevisions(note.id)).length).toBe(2);
      expect(localStorage.getItem(`noor-note-draft:${note.id}`)).toBeNull();
    } finally { repository.close(); await Dexie.delete(name); }
  });
});
