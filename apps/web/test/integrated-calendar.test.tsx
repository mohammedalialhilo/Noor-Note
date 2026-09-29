// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { makeVaultNote, taskDate, vaultSettingsSchema } from '@noor-note/core';
import { toNoteEntry } from '@noor-note/storage';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IntegratedCalendar } from '../src/components/IntegratedCalendar';
import type { useVaultWorkspace } from '../src/hooks/useVaultWorkspace';

afterEach(cleanup);

describe('integrated calendar', () => {
  it('opens a daily note and moves a task due date through the source mutation', async () => {
    const vaultId = crypto.randomUUID();
    const today = taskDate(new Date());
    const note = await makeVaultNote({ vaultId, title: 'Plan', markdown: `- [ ] Ship @due(${today})` });
    const openPeriodNote = vi.fn(async () => note);
    const updateTask = vi.fn(async () => note);
    const workspace = { activeVault: { id: vaultId, name: 'Work', settings: vaultSettingsSchema.parse({}) }, vaults: [{ id: vaultId, name: 'Work' }], notes: [toNoteEntry(note)], folders: [], repository: null, openPeriodNote, updateTask, searchNotes: vi.fn() } as unknown as ReturnType<typeof useVaultWorkspace>;
    const onOpenNote = vi.fn();
    render(<IntegratedCalendar workspace={workspace} periodKind="daily" onPeriodKindChange={vi.fn()} onOpenNote={onOpenNote} onOpenNavigation={vi.fn()} onSettings={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: `Open or create daily note for ${today}` }));
    await waitFor(() => expect(onOpenNote).toHaveBeenCalledWith(note.id));
    fireEvent.click(screen.getByRole('button', { name: 'Change date for Ship' }));
    const tomorrow = taskDate(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + 1));
    fireEvent.change(screen.getByRole('dialog').querySelector('input[type="date"]')!, { target: { value: tomorrow } });
    fireEvent.click(screen.getByRole('button', { name: 'Save date' }));
    await waitFor(() => expect(updateTask).toHaveBeenCalledWith(note.id, expect.objectContaining({ line: 1 }), { dueDate: tomorrow }));
  });

  it('creates a portable event note through the calendar action', async () => {
    const vaultId = crypto.randomUUID();
    const created = await makeVaultNote({ vaultId, title: 'Planning' });
    const createCalendarEvent = vi.fn(async () => created);
    const workspace = { activeVault: { id: vaultId, name: 'Work', settings: vaultSettingsSchema.parse({}) }, vaults: [{ id: vaultId, name: 'Work' }], notes: [], folders: [], repository: null, createCalendarEvent, searchNotes: vi.fn() } as unknown as ReturnType<typeof useVaultWorkspace>;
    render(<IntegratedCalendar workspace={workspace} periodKind="daily" onPeriodKindChange={vi.fn()} onOpenNote={vi.fn()} onOpenNavigation={vi.fn()} onSettings={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'New event' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Planning' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create event' }));
    await waitFor(() => expect(createCalendarEvent).toHaveBeenCalledWith(expect.objectContaining({ title: 'Planning', date: taskDate(new Date()) }), null));
  });

  it('moves a structured item through its configured source date property', async () => {
    const vaultId = crypto.randomUUID();
    const today = taskDate(new Date());
    const note = await makeVaultNote({ vaultId, title: 'Review', markdown: `---\nreview_date: ${today}\n---\nBrief` });
    const moveCalendarDate = vi.fn(async () => note);
    const workspace = { activeVault: { id: vaultId, name: 'Work', settings: vaultSettingsSchema.parse({}) }, vaults: [{ id: vaultId, name: 'Work' }], notes: [toNoteEntry(note)], folders: [], repository: null, moveCalendarDate, searchNotes: vi.fn() } as unknown as ReturnType<typeof useVaultWorkspace>;
    render(<IntegratedCalendar workspace={workspace} periodKind="daily" onPeriodKindChange={vi.fn()} onOpenNote={vi.fn()} onOpenNavigation={vi.fn()} onSettings={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change date for Review' }));
    const tomorrow = taskDate(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + 1));
    fireEvent.change(screen.getByRole('dialog').querySelector('input[type="date"]')!, { target: { value: tomorrow } });
    fireEvent.click(screen.getByRole('button', { name: 'Save date' }));
    await waitFor(() => expect(moveCalendarDate).toHaveBeenCalledWith(note.id, 'review_date', today, tomorrow));
  });
});
