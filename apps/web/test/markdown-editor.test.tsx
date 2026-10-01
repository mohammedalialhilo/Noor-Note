// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { makeVaultNote } from '@noor-note/core';
import { toNoteEntry } from '@noor-note/storage';
import { createRef } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MarkdownEditor, defaultEditorPreferences, type MarkdownEditorHandle } from '../src/components/MarkdownEditor';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';

beforeAll(() => {
  class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  document.createRange = (() => {
    const original = document.createRange.bind(document);
    return () => {
      const range = original();
      range.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () { /* no visible rectangles */ } }) as DOMRectList;
      range.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
      return range;
    };
  })();
});
afterEach(cleanup);

describe('CodeMirror Markdown editor', () => {
  it('lets commenters select source text without making it editable', () => {
    const ref = createRef<MarkdownEditorHandle>();
    const onChange = vi.fn();
    const { container } = render(<MarkdownEditor ref={ref} value="Before selected after" onChange={onChange} label="Read-only note source" readOnly />);
    expect(container.querySelector('.cm-content')?.getAttribute('aria-readonly')).toBe('true');
    expect(container.querySelector<HTMLElement>('.cm-content')?.tabIndex).toBeGreaterThanOrEqual(0);
    act(() => ref.current?.selectRange(7, 15));
    expect(ref.current?.getSelectionRange()).toEqual({ from: 7, to: 15, text: 'selected' });
    expect(screen.queryByRole('toolbar', { name: 'Selection formatting' })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
  it('binds CodeMirror edits and remote Yjs updates without replacing Markdown from a stale prop', () => {
    const doc = new Y.Doc();
    const text = doc.getText('markdown');
    text.insert(0, 'Start');
    const awareness = new Awareness(doc);
    const ref = createRef<MarkdownEditorHandle>();
    const onChange = vi.fn();
    const { container, rerender, unmount } = render(<MarkdownEditor ref={ref} value="Start" onChange={onChange} label="Shared source" collaboration={{ text, awareness }} />);
    act(() => ref.current?.insertText('Local '));
    expect(text.toString()).toContain('Local');
    act(() => { text.insert(text.length, ' remote'); });
    expect(container.querySelector('.cm-content')?.textContent).toContain('remote');
    rerender(<MarkdownEditor ref={ref} value="Start" onChange={onChange} label="Shared source" collaboration={{ text, awareness }} />);
    expect(text.toString()).toContain('Local');
    expect(text.toString()).toContain('remote');
    expect(onChange).not.toHaveBeenCalled();
    unmount(); awareness.destroy(); doc.destroy();
  });
  it('edits source with commands, retains undo history, and opens find and replace', () => {
    const ref = createRef<MarkdownEditorHandle>();
    const onChange = vi.fn();
    const { container } = render(<MarkdownEditor ref={ref} value="Original" onChange={onChange} label="Note source" />);
    expect(container.querySelector('.cm-content')?.getAttribute('aria-label')).toBe('Note source');
    act(() => ref.current?.insertText('New '));
    expect(onChange).toHaveBeenCalledWith('New Original');
    act(() => ref.current?.undo());
    expect(container.querySelector('.cm-content')?.textContent).toContain('Original');
    expect(container.querySelector('.cm-content')?.textContent).not.toContain('New');
    act(() => ref.current?.redo());
    expect(container.querySelector('.cm-content')?.textContent).toContain('New Original');
    act(() => ref.current?.find());
    expect(screen.getByRole('textbox', { name: 'Find' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Replace' })).toBeTruthy();
  });

  it('reconfigures wrapping, line numbers, and spellcheck without replacing Markdown', () => {
    const ref = createRef<MarkdownEditorHandle>();
    const onChange = vi.fn();
    const { container, rerender } = render(<MarkdownEditor ref={ref} value="# Heading" onChange={onChange} label="Note source" />);
    rerender(<MarkdownEditor ref={ref} value="# Heading" onChange={onChange} label="Note source" preferences={{ ...defaultEditorPreferences, lineNumbers: true, spellcheck: false, wordWrap: false }} />);
    expect(container.querySelector('.cm-lineNumbers')).toBeTruthy();
    expect(container.querySelector('.cm-content')?.getAttribute('spellcheck')).toBe('false');
    expect(container.querySelector('.cm-content')?.textContent).toContain('# Heading');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('suggests notes for wiki links and inserts a stable target ID', async () => {
    const target = await makeVaultNote({ vaultId: crypto.randomUUID(), title: 'Roadmap', markdown: '' });
    const ref = createRef<MarkdownEditorHandle>();
    const onChange = vi.fn();
    render(<MarkdownEditor ref={ref} value="" onChange={onChange} label="Note source" suggestions={[toNoteEntry(target)]} />);
    act(() => ref.current?.insertText('[[Road'));
    expect(screen.getByRole('listbox', { name: 'Link to note' })).toBeTruthy();
    act(() => screen.getByRole('option', { name: /Roadmap/ }).click());
    expect(onChange).toHaveBeenLastCalledWith(`[[Roadmap]]<!-- noor-note-id:${target.id} -->`);
  });

  it('assigns a block ID and creates a portable link to the current line', () => {
    const ref = createRef<MarkdownEditorHandle>();
    const onChange = vi.fn();
    render(<MarkdownEditor ref={ref} value="A block" onChange={onChange} label="Note source" />);
    let link: string | null | undefined;
    act(() => { link = ref.current?.makeBlockLink({ id: crypto.randomUUID(), title: 'Notes' }); });
    expect(link).toMatch(/^\[\[Notes\^b-[0-9a-f-]{36}\]\]<!-- noor-note-id:[0-9a-f-]{36} -->$/u);
    expect(onChange.mock.lastCall?.[0]).toMatch(/A block \^b-/u);
  });

  it('applies an AI preview as a separate undoable change and refuses stale source', () => {
    const ref = createRef<MarkdownEditorHandle>();
    const onChange = vi.fn();
    const { container } = render(<MarkdownEditor ref={ref} value="Alpha" onChange={onChange} label="Note source" />);
    expect(ref.current?.replaceRange('Wrong', 0, 5, 'Beta')).toBe(false);
    act(() => { expect(ref.current?.replaceRange('Alpha', 0, 5, 'Beta')).toBe(true); });
    expect(container.querySelector('.cm-content')?.textContent).toContain('Beta');
    expect(ref.current?.undoIfCurrent('Wrong')).toBe(false);
    act(() => { expect(ref.current?.undoIfCurrent('Beta')).toBe(true); });
    expect(container.querySelector('.cm-content')?.textContent).toContain('Alpha');
  });
});
