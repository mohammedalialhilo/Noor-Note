// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { attachmentSchema, makeVaultNote, pdfReferenceLink } from '@noor-note/core';
import { toNoteEntry } from '@noor-note/storage';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarkdownReadingView } from '../src/components/MarkdownReadingView';

afterEach(cleanup);

describe('Markdown reading view', () => {
  it('renders GFM and wiki links from a display copy while preserving Markdown', async () => {
    const vaultId = crypto.randomUUID();
    const markdown = '# Intro\n\n## **Formatted**\n\n- [ ] Follow up\n\n| Key | Value |\n| --- | --- |\n| A | B |\n\n[[Other#Section|Alias]]\n\nA footnote[^1].\n\n[^1]: Source.';
    const note = await makeVaultNote({ vaultId, title: 'Current', markdown });
    const other = await makeVaultNote({ vaultId, title: 'Other', markdown: '# Section' });
    const onOpenNote = vi.fn();
    const { container } = render(<MarkdownReadingView note={note} notes={[toNoteEntry(note), toNoteEntry(other)]} attachments={[]} repository={null} onOpenNote={onOpenNote} />);
    expect(screen.getByRole('heading', { name: 'Intro' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Formatted' }).id).toBe('formatted');
    expect(container.querySelector('table')?.textContent).toContain('Value');
    expect(container.querySelector('input[type=checkbox]')).toBeTruthy();
    expect(container.querySelector('[data-footnotes]')).toBeTruthy();
    screen.getByRole('button', { name: 'Alias' }).click();
    expect(onOpenNote).toHaveBeenCalledWith(other.id, 'Section');
    expect(note.markdown).toBe(markdown);
  });

  it('opens pinned links after a rename and offers to create a missing note', async () => {
    const vaultId = crypto.randomUUID();
    const target = await makeVaultNote({ vaultId, title: 'Renamed', markdown: '' });
    const source = await makeVaultNote({ vaultId, title: 'Source', markdown: `[[Old]]<!-- noor-note-id:${target.id} --> and [[Missing]]` });
    const onOpenNote = vi.fn();
    const onCreateMissing = vi.fn();
    render(<MarkdownReadingView note={source} notes={[toNoteEntry(source), toNoteEntry(target)]} attachments={[]} repository={null} onOpenNote={onOpenNote} onCreateMissing={onCreateMissing} />);
    screen.getByRole('button', { name: 'Old' }).click();
    screen.getByRole('button', { name: /Missing/ }).click();
    expect(onOpenNote).toHaveBeenCalledWith(target.id, undefined);
    expect(onCreateMissing).toHaveBeenCalledWith('Missing');
  });

  it('opens a stable PDF annotation reference in the native reader', async () => {
    const vaultId = crypto.randomUUID();
    const annotationId = crypto.randomUUID();
    const attachment = attachmentSchema.parse({ id: crypto.randomUUID(), vaultId, folderId: null, path: '/Source.pdf', name: 'Source.pdf', mime: 'application/pdf', size: 3, storage: 'indexeddb', createdAt: '2026-09-24T12:00:00.000Z', updatedAt: '2026-09-24T12:00:00.000Z', deletedAt: null, trashGroupId: null });
    const note = await makeVaultNote({ vaultId, title: 'Quote', markdown: pdfReferenceLink('/Quote.md', attachment, 5, annotationId, 'Source PDF') });
    const onOpenPdf = vi.fn();
    render(<MarkdownReadingView note={note} notes={[toNoteEntry(note)]} attachments={[attachment]} repository={null} onOpenNote={vi.fn()} onOpenPdf={onOpenPdf} />);
    screen.getByRole('button', { name: 'Source PDF' }).click();
    expect(onOpenPdf).toHaveBeenCalledWith(attachment.id, 5, annotationId);
  });
});
