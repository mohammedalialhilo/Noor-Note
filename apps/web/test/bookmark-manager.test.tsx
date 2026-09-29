// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NoteEntry } from '@noor-note/storage';
import { BookmarkManager } from '../src/components/BookmarkManager';

afterEach(cleanup);

describe('bookmark manager', () => {
  it('creates typed bookmarks and opens recent work', async () => {
    const noteId = crypto.randomUUID();
    const note = { id: noteId, title: 'Plan', path: '/Plan.md' } as NoteEntry;
    const onCreate = vi.fn(async () => true), onOpenNote = vi.fn(), onOpenSearch = vi.fn(), onRestoreClosed = vi.fn(), onToggleNoteFlag = vi.fn(async () => true);
    render(<BookmarkManager open onOpenChange={vi.fn()} bookmarks={[]} notes={[note]} bases={[]} canvases={[]} recentNoteIds={[noteId]} recentSearches={['tag:work']} closedTabs={[{ paneId: crypto.randomUUID(), tab: { id: crypto.randomUUID(), noteId, pinned: false } }]} onCreate={onCreate} onUpdate={vi.fn(async () => true)} onRemove={vi.fn(async () => true)} onOpen={vi.fn()} onToggleNoteFlag={onToggleNoteFlag} onOpenNote={onOpenNote} onOpenSearch={onOpenSearch} onRestoreClosed={onRestoreClosed} error={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'tag:work' }));
    expect(onOpenSearch).toHaveBeenCalledWith('tag:work');
    fireEvent.click(within(screen.getByRole('heading', { name: 'Recent notes' }).closest('section')!).getByRole('button', { name: 'Plan' }));
    expect(onOpenNote).toHaveBeenCalledWith(noteId);
    fireEvent.click(screen.getByRole('button', { name: /Add favorite Plan/ }));
    await waitFor(() => expect(onToggleNoteFlag).toHaveBeenCalledWith(noteId, 'favorite'));
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'url' } });
    fireEvent.change(screen.getByLabelText('Web URL'), { target: { value: 'https://example.org' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'url', url: 'https://example.org' })));
    fireEvent.click(within(screen.getByRole('heading', { name: 'Recently closed tabs' }).closest('section')!).getByRole('button', { name: 'Plan' }));
    expect(onRestoreClosed).toHaveBeenCalledWith(0);
  });
});
