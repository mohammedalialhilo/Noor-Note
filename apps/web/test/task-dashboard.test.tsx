// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { makeVaultNote, vaultSettingsSchema } from '@noor-note/core';
import { toNoteEntry } from '@noor-note/storage';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskDashboard } from '../src/components/TaskDashboard';
import type { useVaultWorkspace } from '../src/hooks/useVaultWorkspace';

afterEach(cleanup);

describe('task dashboard', () => {
  it('edits a checkbox through the source-note mutation callback', async () => {
    const vaultId = crypto.randomUUID();
    const note = await makeVaultNote({ vaultId, title: 'Project', markdown: '- [ ] Draft #work' });
    const updateTask = vi.fn(async () => note);
    const workspace = { activeVault: { id: vaultId, settings: vaultSettingsSchema.parse({}) }, notes: [toNoteEntry(note)], updateTask, assignTaskIds: vi.fn(async () => 1), updateVaultSettings: vi.fn() } as unknown as ReturnType<typeof useVaultWorkspace>;
    const onOpenNote = vi.fn();
    render(<TaskDashboard workspace={workspace} onOpenNote={onOpenNote} onOpenNavigation={vi.fn()} onOpenNotes={vi.fn()} />);
    expect(screen.getByText('Draft')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Project.*line 1/u }));
    expect(onOpenNote).toHaveBeenCalledWith(note.id, 1, null);
    fireEvent.click(screen.getByRole('button', { name: 'Assign task IDs' }));
    await waitFor(() => expect(workspace.assignTaskIds).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Task text'), { target: { value: 'Write draft' } });
    fireEvent.change(screen.getByLabelText('Due'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'high' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save task' }));
    await waitFor(() => expect(updateTask).toHaveBeenCalledWith(note.id, { id: null, line: 1, expectedText: 'Draft' }, expect.objectContaining({ text: 'Write draft', dueDate: '2026-10-01', priority: 'high', tags: ['work'] })));
  });

  it('saves a filtered custom view in vault settings', async () => {
    const vaultId = crypto.randomUUID();
    const settings = vaultSettingsSchema.parse({});
    const updateVaultSettings = vi.fn(async () => ({ id: vaultId }));
    const workspace = { activeVault: { id: vaultId, settings }, notes: [], updateTask: vi.fn(), assignTaskIds: vi.fn(), updateVaultSettings } as unknown as ReturnType<typeof useVaultWorkspace>;
    render(<TaskDashboard workspace={workspace} onOpenNote={vi.fn()} onOpenNavigation={vi.fn()} onOpenNotes={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Custom views' }));
    fireEvent.change(screen.getByLabelText('Filter tasks'), { target: { value: 'status:open priority:high' } });
    fireEvent.change(screen.getByLabelText('View name'), { target: { value: 'Focus' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save view' }));
    await waitFor(() => expect(updateVaultSettings).toHaveBeenCalledWith({ taskViews: [expect.objectContaining({ name: 'Focus', query: 'status:open priority:high' })] }));
  });

  it('guides an empty vault to notes and clears a task view with no matches', async () => {
    const vaultId = crypto.randomUUID();
    const workspace = { activeVault: { id: vaultId, settings: vaultSettingsSchema.parse({}) }, notes: [], updateTask: vi.fn(), assignTaskIds: vi.fn(), updateVaultSettings: vi.fn() } as unknown as ReturnType<typeof useVaultWorkspace>;
    const onOpenNotes = vi.fn();
    const view = render(<TaskDashboard workspace={workspace} onOpenNote={vi.fn()} onOpenNavigation={vi.fn()} onOpenNotes={onOpenNotes} />);
    expect(screen.getByText('No tasks yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open notes' }));
    expect(onOpenNotes).toHaveBeenCalledOnce();
    const note = await makeVaultNote({ vaultId, title: 'Plan', markdown: '- [ ] Prepare' });
    view.rerender(<TaskDashboard workspace={{ ...workspace, notes: [toNoteEntry(note)] }} onOpenNote={vi.fn()} onOpenNavigation={vi.fn()} onOpenNotes={onOpenNotes} />);
    fireEvent.click(screen.getByRole('button', { name: /Today/u }));
    expect(screen.getByText('No tasks match this view')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show all tasks' }));
    expect(screen.getByText('Prepare')).toBeTruthy();
  });
});
