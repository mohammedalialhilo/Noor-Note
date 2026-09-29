// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { makeVaultNote, type Folder } from '@noor-note/core';
import { toNoteEntry } from '@noor-note/storage';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuickSwitcher } from '../src/components/QuickSwitcher';
import { canCreateMissingNote, quickSwitcherEntries, readRecentNotes, recordRecentNote } from '../src/lib/quick-switcher';

afterEach(() => { cleanup(); localStorage.clear(); });

describe('quick switcher', () => {
  it('ranks recent notes, fuzzy note matches, and folders', async () => {
    const vaultId = crypto.randomUUID();
    const alpha = toNoteEntry(await makeVaultNote({ vaultId, title: 'Project Alpha', markdown: '' }));
    const beta = toNoteEntry(await makeVaultNote({ vaultId, title: 'Project Beta', markdown: '' }));
    const folder: Folder = { id: crypto.randomUUID(), vaultId, parentId: null, name: 'Research', path: '/Research', createdAt: alpha.createdAt, updatedAt: alpha.updatedAt, deletedAt: null, trashGroupId: null };
    expect(quickSwitcherEntries([alpha, beta], [folder], '', [beta.id])[0]?.id).toBe(beta.id);
    expect(quickSwitcherEntries([alpha, beta], [folder], 'prja', []).some((entry) => entry.id === alpha.id)).toBe(true);
    expect(quickSwitcherEntries([alpha, beta], [folder], 'resear', []).some((entry) => entry.id === folder.id)).toBe(true);
    expect(canCreateMissingNote('Project Alpha', [alpha, beta])).toBe(false);
    expect(canCreateMissingNote('New idea', [alpha, beta])).toBe(true);
    expect(recordRecentNote(vaultId, alpha.id)).toEqual([alpha.id]);
    expect(readRecentNotes(vaultId)).toEqual([alpha.id]);
  });

  it('opens a note in a new tab, a split, and creates a missing note from the keyboard', async () => {
    const note = toNoteEntry(await makeVaultNote({ vaultId: crypto.randomUUID(), title: 'Project Alpha', markdown: '' }));
    const onOpenNote = vi.fn(async () => true);
    const onCreate = vi.fn(async () => true);
    const onOpenChange = vi.fn();
    const { rerender } = render(<QuickSwitcher open onOpenChange={onOpenChange} notes={[note]} folders={[]} recentIds={[]} onOpenNote={onOpenNote} onOpenFolder={vi.fn()} onCreate={onCreate} />);
    const input = screen.getByRole('searchbox', { name: 'Find a note or folder' });
    fireEvent.change(input, { target: { value: 'Project' } });
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(onOpenNote).toHaveBeenCalledWith(note.id, 'tab'));
    rerender(<QuickSwitcher open onOpenChange={onOpenChange} notes={[note]} folders={[]} recentIds={[]} onOpenNote={onOpenNote} onOpenFolder={vi.fn()} onCreate={onCreate} />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find a note or folder' }), { target: { value: 'Project' } });
    fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Find a note or folder' }), { key: 'Enter', altKey: true });
    await waitFor(() => expect(onOpenNote).toHaveBeenCalledWith(note.id, 'split'));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find a note or folder' }), { target: { value: 'New idea' } });
    fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Find a note or folder' }), { key: 'Enter' });
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('New idea'));
  });
});
