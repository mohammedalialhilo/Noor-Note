// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { vaultSettingsSchema, type Folder } from '@noor-note/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PeriodNotesSettings } from '../src/components/PeriodNotesSettings';
import type { useVaultWorkspace } from '../src/hooks/useVaultWorkspace';

afterEach(cleanup);

describe('period note settings', () => {
  it('saves a period rule as one validated settings update', async () => {
    const vaultId = crypto.randomUUID();
    const folder: Folder = { id: crypto.randomUUID(), vaultId, parentId: null, name: 'Journal', path: '/Journal', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), deletedAt: null, trashGroupId: null };
    const settings = vaultSettingsSchema.parse({});
    const updateVaultSettings = vi.fn(async () => ({ id: vaultId }));
    const workspace = { activeVault: { id: vaultId, settings }, folders: [folder], notes: [], updateVaultSettings } as unknown as ReturnType<typeof useVaultWorkspace>;
    render(<PeriodNotesSettings workspace={workspace} />);
    const weekly = within(screen.getByRole('group', { name: 'Weekly' }));
    fireEvent.change(weekly.getByLabelText('Folder'), { target: { value: folder.id } });
    fireEvent.change(weekly.getByLabelText('Filename format'), { target: { value: 'GGGG-[Week]WW' } });
    fireEvent.click(weekly.getByLabelText('Auto-create when opened'));
    expect(updateVaultSettings).not.toHaveBeenCalled();
    fireEvent.click(weekly.getByRole('button', { name: 'Save weekly settings' }));
    await waitFor(() => expect(updateVaultSettings).toHaveBeenCalledWith({ periodNotes: expect.objectContaining({ weekly: expect.objectContaining({ folderId: folder.id, filenameFormat: 'GGGG-[Week]WW', autoCreate: true }) }) }));
  });
});
