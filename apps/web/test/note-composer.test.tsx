// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { makeVaultNote } from '@noor-note/core';
import { toNoteEntry } from '@noor-note/storage';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NoteComposer } from '../src/components/NoteComposer';
import type { useVaultWorkspace } from '../src/hooks/useVaultWorkspace';

afterEach(cleanup);

describe('note composer', () => {
  it('requires a reviewed preview before applying a merge', async () => {
    const vaultId = crypto.randomUUID();
    const source = await makeVaultNote({ vaultId, title: 'Source', markdown: '# Source\n\nText ^stable' });
    const target = await makeVaultNote({ vaultId, title: 'Target', markdown: '# Target' });
    const applyNoteRefactor = vi.fn(async () => ({ created: [], updated: [source, target] }));
    const repository = { listTree: vi.fn(async () => ({ notes: [toNoteEntry(source), toNoteEntry(target)], folders: [], attachments: [] })), getNote: vi.fn(async (id: string) => [source, target].find((note) => note.id === id)), applyNoteRefactor };
    const workspace = { activeVault: { id: vaultId }, notes: [toNoteEntry(source), toNoteEntry(target)], repository, flushPending: vi.fn(async () => undefined), refreshActive: vi.fn(async () => undefined) } as unknown as ReturnType<typeof useVaultWorkspace>;
    const onOpenNote = vi.fn();
    render(<NoteComposer action="merge" source={source} selection={null} workspace={workspace} onClose={vi.fn()} onOpenNote={onOpenNote} onOpenCanvas={vi.fn()} />);
    await screen.findByLabelText('Destination note');
    fireEvent.change(screen.getByLabelText('Destination note'), { target: { value: target.id } });
    expect(screen.queryByRole('button', { name: 'Apply changes' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }));
    await screen.findByText(/Merge.*into.*leave a link/);
    expect(applyNoteRefactor).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
    await waitFor(() => expect(applyNoteRefactor).toHaveBeenCalledTimes(1));
    expect(onOpenNote).toHaveBeenCalledWith(source.id);
  });
});
