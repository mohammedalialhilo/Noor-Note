// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { makeVaultNote, type TagChange } from '@noor-note/core';
import type { VaultRepository } from '@noor-note/storage';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PropertyPanel } from '../src/components/PropertyPanel';
import { TagManager } from '../src/components/TagManager';

afterEach(() => { cleanup(); });

describe('metadata controls', () => {
  it('saves a boolean property from the structured panel without YAML editing', async () => {
    const note = await makeVaultNote({ vaultId: crypto.randomUUID(), title: 'Note', markdown: '# Note' });
    const onUpdate = vi.fn(async () => note);
    const repository = { listObjects: async () => [] } as unknown as VaultRepository;
    render(<PropertyPanel note={note} repository={repository} onUpdate={onUpdate} onApplyDefaults={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add property' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'reviewed' } });
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'boolean' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save property' }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(note.id, 'reviewed', false, 'boolean', undefined));
  });

  it('requires a preview before applying a tag rename', async () => {
    const note = await makeVaultNote({ vaultId: crypto.randomUUID(), title: 'Note', markdown: '#work' });
    const changes: TagChange[] = [{ noteId: note.id, title: note.title, path: note.path, before: note.markdown, after: '#projects', revision: note.revision, count: 1 }];
    const onPreview = vi.fn(async () => ({ changes, expectedRevisions: [{ id: note.id, revision: note.revision }] }));
    const onApply = vi.fn(async () => [note]);
    render(<TagManager tree={[{ name: 'work', fullName: 'work', count: 1, children: [] }]} noteCount={1} onFilter={vi.fn()} onPreview={onPreview} onApply={onApply} />);
    fireEvent.click(screen.getByRole('button', { name: 'Manage work' }));
    fireEvent.change(screen.getByLabelText('New tag name'), { target: { value: 'projects' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview affected notes' }));
    await waitFor(() => expect(screen.getByText(/1 reference in 1 note/)).toBeTruthy());
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm changes' }));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith(changes, [{ id: note.id, revision: note.revision }]));
  });
});
