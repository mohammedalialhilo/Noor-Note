// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { makeVaultNote } from '@noor-note/core';
import { toNoteEntry } from '@noor-note/storage';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotePresentation } from '../src/components/NotePresentation';

afterEach(cleanup);

describe('Markdown note presentation', () => {
  it('navigates derived slides, reveals speaker notes, and leaves the note unchanged', async () => {
    const markdown = '# First\n<!-- speaker-notes\nOpening cue\n-->\n<!-- slide -->\n## Second\n**Content**';
    const note = await makeVaultNote({ vaultId: crypto.randomUUID(), title: 'Talk', markdown });
    const onClose = vi.fn();
    render(<NotePresentation note={note} notes={[toNoteEntry(note)]} attachments={[]} repository={null} onClose={onClose} onOpenNote={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'First' })).toBeTruthy();
    expect(screen.getByText('Slide 1 of 2')).toBeTruthy();
    expect(screen.queryByText('Opening cue')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Speaker notes' }));
    expect(screen.getByText('Opening cue')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(screen.getByRole('heading', { name: 'Second' })).toBeTruthy();
    expect(screen.getByText('Slide 2 of 2')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Presentation progress' }).getAttribute('value')).toBe('2');
    fireEvent.keyDown(document, { key: 'Home' });
    expect(screen.getByRole('heading', { name: 'First' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Exit presentation' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(note.markdown).toBe(markdown);
  });

  it('requests fullscreen on the presentation and hides notes while fullscreen', async () => {
    const note = await makeVaultNote({ vaultId: crypto.randomUUID(), title: 'Talk', markdown: '# First\n<!-- speaker-notes\nPrivate cue\n-->' });
    let fullElement: Element | null = null;
    const priorElement = Object.getOwnPropertyDescriptor(document, 'fullscreenElement');
    const priorRequest = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'requestFullscreen');
    const priorExit = Object.getOwnPropertyDescriptor(document, 'exitFullscreen');
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullElement });
    const request = vi.fn(() => {
      fullElement = document.querySelector('[role="dialog"]');
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    });
    const exit = vi.fn(() => {
      fullElement = null;
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    });
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { configurable: true, value: request });
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit });
    try {
      render(<NotePresentation note={note} notes={[toNoteEntry(note)]} attachments={[]} repository={null} onClose={vi.fn()} onOpenNote={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Speaker notes' }));
      expect(screen.getByText('Private cue')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' }));
      expect(request).toHaveBeenCalledOnce();
      expect(screen.queryByText('Private cue')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Exit fullscreen' }));
      expect(exit).toHaveBeenCalledOnce();
    } finally {
      if (priorRequest) Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', priorRequest); else Reflect.deleteProperty(HTMLElement.prototype, 'requestFullscreen');
      if (priorExit) Object.defineProperty(document, 'exitFullscreen', priorExit); else Reflect.deleteProperty(document, 'exitFullscreen');
      if (priorElement) Object.defineProperty(document, 'fullscreenElement', priorElement); else Reflect.deleteProperty(document, 'fullscreenElement');
    }
  });
});
