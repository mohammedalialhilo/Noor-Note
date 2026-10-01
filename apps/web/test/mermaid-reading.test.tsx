// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { makeVaultNote } from '@noor-note/core';
import { toNoteEntry } from '@noor-note/storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const renderMermaidSvg = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/mermaid-diagrams', () => ({ renderMermaidSvg }));

import { MarkdownReadingView } from '../src/components/MarkdownReadingView';

beforeEach(() => {
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:noor-diagram');
    static revokeObjectURL = vi.fn();
  });
  renderMermaidSvg.mockReset();
  renderMermaidSvg.mockResolvedValue('<svg xmlns="http://www.w3.org/2000/svg" />');
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Mermaid Markdown preview', () => {
  it('renders a fenced diagram as an isolated image and preserves its source', async () => {
    const markdown = 'Before\n\n```mermaid\nflowchart LR\nA --> B\n```\n\nAfter';
    const note = await makeVaultNote({ vaultId: crypto.randomUUID(), title: 'Diagram', markdown });
    const { container } = render(<MarkdownReadingView note={note} notes={[toNoteEntry(note)]} attachments={[]} repository={null} onOpenNote={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('img', { name: 'Mermaid diagram' })).toBeTruthy());
    expect(container.querySelector('figure img')).toBeTruthy();
    expect(container.querySelector('pre img')).toBeNull();
    expect(screen.getByText('Diagram source')).toBeTruthy();
    expect(container.querySelector('details code')?.textContent).toBe('flowchart LR\nA --> B');
    expect(note.markdown).toBe(markdown);
  });

  it('shows a readable error and the source when rendering fails', async () => {
    renderMermaidSvg.mockRejectedValue(new Error('Mermaid configuration directives are unavailable in notes.'));
    const note = await makeVaultNote({ vaultId: crypto.randomUUID(), title: 'Diagram', markdown: '```mermaid\n%%{init:{}}%%\nflowchart LR\nA-->B\n```' });
    render(<MarkdownReadingView note={note} notes={[toNoteEntry(note)]} attachments={[]} repository={null} onOpenNote={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('configuration directives'));
    expect(screen.getByText(/%%\{init/)).toBeTruthy();
  });
});
