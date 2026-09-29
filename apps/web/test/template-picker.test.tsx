// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { makeVaultNote, type Folder } from '@noor-note/core';
import { toNoteEntry } from '@noor-note/storage';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TemplatePicker } from '../src/components/TemplatePicker';
import type { useVaultWorkspace } from '../src/hooks/useVaultWorkspace';

afterEach(cleanup);

describe('template picker', () => {
  it('previews the final filename and creates a note from a selected Markdown template', async () => {
    const vaultId = crypto.randomUUID();
    const folder: Folder = { id: crypto.randomUUID(), vaultId, parentId: null, name: 'Templates', path: '/Templates', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), deletedAt: null, trashGroupId: null };
    const source = await makeVaultNote({ vaultId, folderId: folder.id, folderPath: folder.path, title: 'Starter', markdown: '# {{title}}\n{{filename}}' });
    const existing = await makeVaultNote({ vaultId, title: 'My note' });
    const created = await makeVaultNote({ vaultId, title: 'My note', path: '/My note (2).md', markdown: '# My note\nMy note (2).md' });
    const addNote = vi.fn(async () => created);
    const workspace = {
      activeVault: { settings: { templates: { folderId: folder.id } } },
      repository: { getNote: vi.fn(async () => source) },
      notes: [toNoteEntry(source), toNoteEntry(existing)], folders: [folder], attachments: [], selectedFolderId: null,
      addNote,
    } as unknown as ReturnType<typeof useVaultWorkspace>;
    const onCreated = vi.fn();
    render(<TemplatePicker action="create" workspace={workspace} note={null} selection="" onInsert={vi.fn()} onCreated={onCreated} onClose={vi.fn()} onSettings={vi.fn()} />);
    await screen.findByText(/Untitled note\.md/);
    fireEvent.change(screen.getByLabelText('Note title for variables'), { target: { value: 'My note' } });
    await waitFor(() => expect(screen.getByText(/My note \(2\)\.md/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Create note from template' }));
    await waitFor(() => expect(addNote).toHaveBeenCalledWith(null, { title: 'My note', templateId: source.id, selection: '', clipboard: '' }));
    expect(onCreated).toHaveBeenCalledWith(created.id);
  });
});
