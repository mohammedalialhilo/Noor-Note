// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { makeVaultNote, markPeriodMarkdown, periodKey, vaultSettingsSchema } from '@noor-note/core';
import { toNoteEntry } from '@noor-note/storage';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PeriodNotesView } from '../src/components/PeriodNotesView';
import type { useVaultWorkspace } from '../src/hooks/useVaultWorkspace';

afterEach(cleanup);

describe('period notes view', () => {
  it('opens an existing daily note from the calendar', async () => {
    const vaultId = crypto.randomUUID();
    const now = new Date();
    const date = new Date(now.getFullYear(), now.getMonth(), 15);
    const key = periodKey('daily', date);
    const note = await makeVaultNote({ vaultId, title: key, markdown: markPeriodMarkdown('# Day', 'daily', date) });
    const onOpenNote = vi.fn();
    const workspace = { activeVault: { id: vaultId, settings: vaultSettingsSchema.parse({}) }, notes: [toNoteEntry(note)], openPeriodNote: vi.fn(async () => note) } as unknown as ReturnType<typeof useVaultWorkspace>;
    render(<PeriodNotesView workspace={workspace} kind="daily" onKindChange={vi.fn()} onOpenNote={onOpenNote} onOpenNavigation={vi.fn()} onSettings={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: `${key}, note exists` }));
    await waitFor(() => expect(onOpenNote).toHaveBeenCalledWith(note.id));
    expect(workspace.openPeriodNote).toHaveBeenCalledWith('daily', date, false);
  });

  it('auto-creates only the selected period once across refreshes', async () => {
    const vaultId = crypto.randomUUID();
    const settings = vaultSettingsSchema.parse({});
    settings.periodNotes.weekly.autoCreate = true;
    const created = await makeVaultNote({ vaultId, title: 'Weekly note' });
    const openPeriodNote = vi.fn(async () => created);
    const workspace = { activeVault: { id: vaultId, settings }, notes: [], openPeriodNote } as unknown as ReturnType<typeof useVaultWorkspace>;
    const props = { kind: 'weekly' as const, onKindChange: vi.fn(), onOpenNote: vi.fn(), onOpenNavigation: vi.fn(), onSettings: vi.fn() };
    const { rerender } = render(<PeriodNotesView workspace={workspace} {...props} />);
    await waitFor(() => expect(openPeriodNote).toHaveBeenCalledTimes(1));
    rerender(<PeriodNotesView workspace={{ ...workspace, activeVault: { ...workspace.activeVault! } }} {...props} />);
    expect(openPeriodNote).toHaveBeenCalledTimes(1);
  });
});
