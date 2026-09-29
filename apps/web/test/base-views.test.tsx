// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { evaluateBaseFormulas, formulaField, makeVaultNote, newBaseView } from '@noor-note/core';
import type { NoteEntry } from '@noor-note/storage';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BaseViewPanel } from '../src/components/BaseViews';

afterEach(cleanup);

async function fixture(): Promise<NoteEntry> {
  const note = await makeVaultNote({ vaultId: crypto.randomUUID(), title: 'Alpha', markdown: '---\nstatus: To do\nlocation: 59.3, 18.1\n---\n# Alpha' });
  const { markdown: _markdown, ...entry } = note;
  void _markdown;
  return { ...entry, excerpt: 'Research note', tags: [], links: [], tasks: [], taskCount: 0 };
}

describe('Base views', () => {
  it('renders all nine views from the same note summary', async () => {
    const note = await fixture();
    for (const kind of ['table', 'list', 'cards', 'gallery', 'kanban', 'calendar', 'map', 'timeline', 'gantt'] as const) {
      const { container, unmount } = render(<BaseViewPanel notes={[note]} view={newBaseView(kind)} fields={['title', 'property:status', 'property:location']} folders={[]} attachments={[]} repository={null} onOpen={vi.fn()} onPatchView={vi.fn(async () => undefined)} onEdit={vi.fn(async () => true)} onMoveGroup={vi.fn(async () => true)} onBulkEdit={vi.fn(async () => true)} onBulkTrash={vi.fn(async () => true)} />);
      expect(container.textContent).toContain('Alpha');
      unmount();
    }
  });

  it('sends table edits and Kanban moves to note mutation callbacks', async () => {
    const note = await fixture();
    const onEdit = vi.fn(async () => true);
    const onMoveGroup = vi.fn(async () => true);
    const props = { notes: [note], fields: ['title', 'property:status'], folders: [], attachments: [], repository: null, onOpen: vi.fn(), onPatchView: vi.fn(async () => undefined), onEdit, onMoveGroup, onBulkEdit: vi.fn(async () => true), onBulkTrash: vi.fn(async () => true) };
    const table = newBaseView('table');
    table.visibleFields = ['title', 'property:status'];
    const { unmount } = render(<BaseViewPanel {...props} view={table} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit status for Alpha' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit status for Alpha' }), { target: { value: 'Done' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith(note, 'property:status', 'Done'));
    unmount();
    render(<BaseViewPanel {...props} view={newBaseView('kanban')} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Move Alpha to lane' }), { target: { value: 'In progress' } });
    await waitFor(() => expect(onMoveGroup).toHaveBeenCalledWith(note, 'property:status', 'To do', 'In progress'));
  });

  it('renders a computed column as a named read-only value', async () => {
    const note = await fixture();
    const id = crypto.randomUUID(), field = formulaField(id);
    const computed = evaluateBaseFormulas([note], [{ id, name: 'Status label', expression: 'upper(status)' }]);
    const view = newBaseView('table');
    view.visibleFields = ['title', field];
    view.columnOrder = ['title', field];
    render(<BaseViewPanel notes={[note]} view={view} fields={['title', field]} folders={[]} computed={computed} formulaLabels={{ [field]: 'Status label' }} attachments={[]} repository={null} onOpen={vi.fn()} onPatchView={vi.fn(async () => undefined)} onEdit={vi.fn(async () => true)} onMoveGroup={vi.fn(async () => true)} onBulkEdit={vi.fn(async () => true)} onBulkTrash={vi.fn(async () => true)} />);
    expect(screen.getByRole('button', { name: 'Status label' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'TO DO' }).hasAttribute('disabled')).toBe(true);
  });
});
