'use client';

import { defaultKeymap, history, historyKeymap, isolateHistory, redo, undo } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { Compartment, EditorState } from '@codemirror/state';
import { openSearchPanel, searchKeymap } from '@codemirror/search';
import { EditorView, highlightActiveLine, keymap, lineNumbers, placeholder } from '@codemirror/view';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ensureBlockId, fuzzyNotes } from '@noor-note/core';
import type { NoteEntry } from '@noor-note/storage';
import { defaultEditorPreferences, type EditorPreferences } from '../lib/editor-preferences';
import styles from './MarkdownEditor.module.css';

export { defaultEditorPreferences, type EditorPreferences } from '../lib/editor-preferences';
export type SlashCommand = 'heading' | 'checklist' | 'bullets' | 'numbers' | 'quote' | 'callout' | 'code' | 'table' | 'image' | 'attachment' | 'divider' | 'math' | 'mermaid';
const slashCommands: { id: SlashCommand; label: string; insert: string }[] = [
  { id: 'heading', label: 'Heading', insert: '## Heading' }, { id: 'checklist', label: 'Checklist', insert: '- [ ] Task' },
  { id: 'bullets', label: 'Bullet list', insert: '- Item' }, { id: 'numbers', label: 'Numbered list', insert: '1. Item' },
  { id: 'quote', label: 'Quote', insert: '> Quote' }, { id: 'callout', label: 'Callout', insert: '> [!NOTE] Title\n> Content' },
  { id: 'code', label: 'Code block', insert: '```text\n\n```' }, { id: 'table', label: 'Table', insert: '| Column | Column |\n| --- | --- |\n| Value | Value |' },
  { id: 'image', label: 'Image', insert: '' }, { id: 'attachment', label: 'Attachment', insert: '' },
  { id: 'divider', label: 'Divider', insert: '---' }, { id: 'math', label: 'Math', insert: '$$\n\n$$' },
  { id: 'mermaid', label: 'Mermaid diagram', insert: '```mermaid\ngraph LR\n  A --> B\n```' },
];
const noorHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--nn-syntax-heading)', fontWeight: '700' },
  { tag: [tags.link, tags.url], color: 'var(--nn-syntax-link)' },
  { tag: tags.monospace, color: 'var(--nn-syntax-code)' },
  { tag: tags.keyword, color: 'var(--nn-syntax-keyword)' },
  { tag: tags.string, color: 'var(--nn-syntax-string)' },
  { tag: tags.comment, color: 'var(--nn-syntax-comment)' },
  { tag: [tags.meta, tags.processingInstruction], color: 'var(--nn-syntax-meta)' },
  { tag: tags.strong, color: 'var(--nn-syntax-strong)', fontWeight: '700' },
]);

export interface MarkdownEditorHandle {
  focus(): void; surroundSelection(before: string, after?: string, fallback?: string): void; insertLinePrefix(prefix: string): void;
  insertText(text: string): void; replaceRange(expectedMarkdown: string, from: number, to: number, insert: string): boolean; undoIfCurrent(expectedMarkdown: string): boolean; getMarkdown(): string; getCursorOffset(): number; getSelectedText(): string; getSelectionRange(): { from: number; to: number; text: string } | null; goToLine(line: number): void; selectRange(from: number, to: number): void; undo(): void; redo(): void; find(): void; makeBlockLink(note: Pick<NoteEntry, 'id' | 'title'>): string | null;
}
interface MarkdownEditorProps {
  value: string; onChange(value: string): void; label: string; preferences?: EditorPreferences; readOnly?: boolean;
  collaboration?: { text: Y.Text; awareness: Awareness };
  onCursorChange?: (line: number, column: number) => void; onAttachmentRequest?: (kind: 'image' | 'attachment') => void;
  suggestions?: NoteEntry[];
}

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(function MarkdownEditor(
  { value, onChange, label, preferences = defaultEditorPreferences, collaboration, onCursorChange, onAttachmentRequest, suggestions = [], readOnly = false }, ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onCursorRef = useRef(onCursorChange);
  const onAttachmentRef = useRef(onAttachmentRequest);
  const prefsRef = useRef(preferences);
  const initialRef = useRef(value);
  const labelRef = useRef(label);
  const collaborationRef = useRef(collaboration);
  const undoManagerRef = useRef<Y.UndoManager | null>(null);
  const wrapCompartment = useRef(new Compartment());
  const linesCompartment = useRef(new Compartment());
  const spellCompartment = useRef(new Compartment());
  const readOnlyCompartment = useRef(new Compartment());
  const readOnlyRef = useRef(readOnly);
  const [selectionOpen, setSelectionOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [linkQuery, setLinkQuery] = useState<string | null>(null);
  const [linkIndex, setLinkIndex] = useState(0);
  const slashRef = useRef<{ query: string; index: number } | null>(null);
  const linkRef = useRef<{ query: string; index: number } | null>(null);
  const suggestionsRef = useRef(suggestions);
  onChangeRef.current = onChange;
  onCursorRef.current = onCursorChange;
  onAttachmentRef.current = onAttachmentRequest;
  prefsRef.current = preferences;
  suggestionsRef.current = suggestions;
  slashRef.current = slashQuery === null ? null : { query: slashQuery, index: slashIndex };
  linkRef.current = linkQuery === null ? null : { query: linkQuery, index: linkIndex };
  const filtered = slashCommands.filter((item) => slashQuery !== null && item.label.toLowerCase().includes(slashQuery.toLowerCase()));
  const linkMatches = linkQuery === null ? [] : fuzzyNotes(linkQuery, suggestions);

  const surround = (before: string, after = before, fallback = 'text') => {
    const view = viewRef.current;
    if (!view) return;
    const selection = view.state.selection.main;
    const selected = view.state.sliceDoc(selection.from, selection.to) || fallback;
    view.dispatch({ changes: { from: selection.from, to: selection.to, insert: `${before}${selected}${after}` }, selection: { anchor: selection.from + before.length, head: selection.from + before.length + selected.length } });
    view.focus();
  };
  const insertSlash = (command: SlashCommand) => {
    const view = viewRef.current;
    if (!view) return;
    const head = view.state.selection.main.head;
    const line = view.state.doc.lineAt(head);
    const marker = view.state.sliceDoc(line.from, head).match(/^(\s*)\/[\p{L}-]*$/u);
    const item = slashCommands.find((candidate) => candidate.id === command);
    if (!marker || !item) return;
    view.dispatch({ changes: { from: line.from + marker[1]!.length, to: head, insert: item.insert } });
    setSlashQuery(null);
    view.focus();
    if (command === 'image' || command === 'attachment') onAttachmentRef.current?.(command);
  };
  const slashActionRef = useRef(insertSlash);
  slashActionRef.current = insertSlash;
  const insertLink = (note: NoteEntry) => {
    const view = viewRef.current;
    if (!view) return;
    const head = view.state.selection.main.head;
    const line = view.state.doc.lineAt(head);
    const marker = view.state.sliceDoc(line.from, head).match(/\[\[([^\]\n]{0,80})$/u);
    if (!marker) return;
    view.dispatch({ changes: { from: head - marker[0].length, to: head, insert: `[[${note.title}]]<!-- noor-note-id:${note.id} -->` } });
    setLinkQuery(null);
    view.focus();
  };
  const linkActionRef = useRef(insertLink);
  linkActionRef.current = insertLink;

  useEffect(() => {
    if (!hostRef.current) return;
    const shared = collaborationRef.current;
    const undoManager = shared ? new Y.UndoManager(shared.text) : null;
    undoManagerRef.current = undoManager;
    const state = EditorState.create({ doc: shared ? shared.text.toString() : initialRef.current, extensions: [
      ...(shared && undoManager ? [keymap.of([...yUndoManagerKeymap, ...defaultKeymap, ...searchKeymap]), yCollab(shared.text, shared.awareness, { undoManager })] : [history(), keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap])]),
      markdown({ codeLanguages: languages }), syntaxHighlighting(noorHighlightStyle), highlightActiveLine(),
      wrapCompartment.current.of(prefsRef.current.wordWrap ? EditorView.lineWrapping : []),
      linesCompartment.current.of(prefsRef.current.lineNumbers ? lineNumbers() : []),
      spellCompartment.current.of(EditorView.contentAttributes.of({ 'aria-label': labelRef.current, 'aria-readonly': String(readOnlyRef.current), spellcheck: String(prefsRef.current.spellcheck), tabindex: '0' })),
      readOnlyCompartment.current.of(EditorState.readOnly.of(readOnlyRef.current)),
      placeholder('Start writing in Markdown…'),
      EditorView.domEventHandlers({ keydown: (event) => {
        const link = linkRef.current;
        if (link) {
          const matches = fuzzyNotes(link.query, suggestionsRef.current);
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setLinkIndex((index) => Math.max(0, Math.min(matches.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))); return true; }
          if (event.key === 'Enter' && matches.length) { event.preventDefault(); linkActionRef.current(matches[Math.min(link.index, matches.length - 1)]!); return true; }
          if (event.key === 'Escape') { event.preventDefault(); setLinkQuery(null); return true; }
        }
        const slash = slashRef.current;
        if (!slash) return false;
        const matches = slashCommands.filter((item) => item.label.toLowerCase().includes(slash.query.toLowerCase()));
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); setSlashIndex((index) => Math.max(0, Math.min(matches.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))); return true;
        }
        if (event.key === 'Enter' && matches.length) { event.preventDefault(); slashActionRef.current(matches[Math.min(slash.index, matches.length - 1)]!.id); return true; }
        if (event.key === 'Escape') { event.preventDefault(); setSlashQuery(null); return true; }
        return false;
      } }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !collaborationRef.current) onChangeRef.current(update.state.doc.toString());
        if (update.selectionSet || update.docChanged) {
          const selection = update.state.selection.main;
          const position = update.state.doc.lineAt(selection.head);
          onCursorRef.current?.(position.number, selection.head - position.from + 1);
          setSelectionOpen(!selection.empty);
          const before = update.state.sliceDoc(position.from, selection.head);
          const match = selection.empty ? before.match(/^\s*\/([\p{L}-]*)$/u) : null;
          setSlashQuery(match ? match[1] ?? '' : null);
          const wikiMatch = selection.empty ? before.match(/\[\[([^\]\n]{0,80})$/u) : null;
          setLinkQuery(wikiMatch ? wikiMatch[1] ?? '' : null);
          if (!wikiMatch) setLinkIndex(0);
          if (prefsRef.current.typewriterMode && update.selectionSet) update.view.dispatch({ effects: EditorView.scrollIntoView(selection.head, { y: 'center' }) });
        }
      }),
      EditorView.theme({
        '&': { height: '100%', backgroundColor: 'var(--nn-editor-bg)', color: 'var(--nn-editor-text)' }, '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit' },
        '.cm-content': { minHeight: '100%', padding: '4px 2px 90px', caretColor: 'var(--nn-editor-caret)' },
        '.cm-line': { padding: '0' }, '.cm-focused': { outline: 'none' },
        '.cm-gutters': { backgroundColor: 'transparent', border: '0', color: 'var(--nn-text-faint)' },
        '.cm-activeLine': { backgroundColor: 'var(--nn-surface-tint)' },
        '.cm-selectionBackground': { backgroundColor: 'var(--nn-editor-selection) !important' },
      }),
    ] });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    return () => { view.destroy(); undoManager?.destroy(); undoManagerRef.current = null; viewRef.current = null; };
  }, []);

  useEffect(() => {
    readOnlyRef.current = readOnly;
    viewRef.current?.dispatch({ effects: readOnlyCompartment.current.reconfigure(EditorState.readOnly.of(readOnly)) });
  }, [readOnly]);
  useEffect(() => {
    const view = viewRef.current;
    if (view && !collaboration && view.state.doc.toString() !== value) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value, collaboration]);
  useEffect(() => {
    viewRef.current?.dispatch({ effects: [
      wrapCompartment.current.reconfigure(preferences.wordWrap ? EditorView.lineWrapping : []),
      linesCompartment.current.reconfigure(preferences.lineNumbers ? lineNumbers() : []),
      spellCompartment.current.reconfigure(EditorView.contentAttributes.of({ 'aria-label': label, 'aria-readonly': String(readOnly), spellcheck: String(preferences.spellcheck), tabindex: '0' })),
    ] });
  }, [label, preferences.lineNumbers, preferences.spellcheck, preferences.wordWrap, readOnly]);

  useImperativeHandle(ref, () => ({
    focus() { viewRef.current?.focus(); }, surroundSelection: surround,
    insertLinePrefix(prefix) { const view = viewRef.current; if (!view) return; const line = view.state.doc.lineAt(view.state.selection.main.from); view.dispatch({ changes: { from: line.from, insert: prefix } }); view.focus(); },
    insertText(text) { const view = viewRef.current; if (!view) return; view.dispatch(view.state.replaceSelection(text)); view.focus(); },
    replaceRange(expectedMarkdown, from, to, insert) { const view = viewRef.current; if (!view || view.state.doc.toString() !== expectedMarkdown || from < 0 || to < from || to > expectedMarkdown.length) return false; view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, annotations: isolateHistory.of('full') }); view.focus(); return true; },
    undoIfCurrent(expectedMarkdown) { const view = viewRef.current; if (!view || view.state.doc.toString() !== expectedMarkdown) return false; if (undoManagerRef.current) { undoManagerRef.current.undo(); return true; } return undo(view); },
    getMarkdown() { return viewRef.current?.state.doc.toString() ?? initialRef.current; },
    getCursorOffset() { return viewRef.current?.state.selection.main.head ?? 0; },
    getSelectedText() { const view = viewRef.current; if (!view) return ''; const selection = view.state.selection.main; return view.state.sliceDoc(selection.from, selection.to); },
    getSelectionRange() { const view = viewRef.current; if (!view) return null; const { from, to } = view.state.selection.main; return from < to ? { from, to, text: view.state.sliceDoc(from, to) } : null; },
    goToLine(line) { const view = viewRef.current; if (!view) return; const position = view.state.doc.line(Math.max(1, Math.min(view.state.doc.lines, line))).from; view.dispatch({ selection: { anchor: position }, effects: EditorView.scrollIntoView(position, { y: 'start' }) }); view.focus(); },
    selectRange(from, to) { const view = viewRef.current; if (!view) return; const start = Math.max(0, Math.min(from, view.state.doc.length)); const end = Math.max(start, Math.min(to, view.state.doc.length)); view.dispatch({ selection: { anchor: start, head: end }, effects: EditorView.scrollIntoView(start, { y: 'center' }) }); view.focus(); },
    undo() { if (undoManagerRef.current) undoManagerRef.current.undo(); else if (viewRef.current) undo(viewRef.current); }, redo() { if (undoManagerRef.current) undoManagerRef.current.redo(); else if (viewRef.current) redo(viewRef.current); },
    find() { if (viewRef.current) openSearchPanel(viewRef.current); },
    makeBlockLink(note) {
      const view = viewRef.current;
      if (!view) return null;
      const current = view.state.doc.lineAt(view.state.selection.main.head);
      try {
        const result = ensureBlockId(view.state.doc.toString(), current.number);
        if (result.markdown !== view.state.doc.toString()) {
          const nextLine = result.markdown.split('\n')[current.number - 1]!;
          view.dispatch({ changes: { from: current.from, to: current.to, insert: nextLine } });
        }
        return `[[${note.title}^${result.id}]]<!-- noor-note-id:${note.id} -->`;
      } catch { return null; }
    },
  }));

  const family = preferences.fontFamily === 'serif' ? 'Georgia, serif' : preferences.fontFamily === 'mono' ? 'ui-monospace, Consolas, monospace' : 'Inter, ui-sans-serif, system-ui, sans-serif';
  return <div className={`${styles.root} ${preferences.focusMode ? styles.focus : ''}`} style={{ fontFamily: family, fontSize: preferences.fontSize, lineHeight: preferences.lineHeight }}>
    {!readOnly && selectionOpen && <div className={styles.selection} role="toolbar" aria-label="Selection formatting">
      <button type="button" onClick={() => surround('**')}>Bold</button><button type="button" onClick={() => surround('*')}>Italic</button>
      <button type="button" onClick={() => surround('~~')}>Strike</button><button type="button" onClick={() => surround('[', '](https://)', 'link')}>Link</button>
      <button type="button" onClick={() => surround('`')}>Code</button><button type="button" onClick={() => surround('==')}>Highlight</button>
    </div>}
    <div ref={hostRef} className="markdown-editor" />
    {slashQuery !== null && filtered.length > 0 && <div className={styles.slash} role="listbox" aria-label="Insert block">
      {filtered.map((item, index) => <button key={item.id} type="button" role="option" aria-selected={index === slashIndex} onMouseDown={(event) => event.preventDefault()} onClick={() => insertSlash(item.id)}>{item.label}</button>)}
    </div>}
    {linkQuery !== null && linkMatches.length > 0 && <div className={styles.slash} role="listbox" aria-label="Link to note">
      {linkMatches.map((note, index) => <button key={note.id} type="button" role="option" aria-selected={index === linkIndex} onMouseDown={(event) => event.preventDefault()} onClick={() => insertLink(note)}>{note.title || 'Untitled note'} <small>{note.path}</small></button>)}
    </div>}
  </div>;
});
