import { describe, expect, it } from 'vitest';
import { activateEditorTab, closeEditorPane, closeEditorTab, createEditorPane, findEditorPane, firstEditorPane, openEditorTab, pinEditorTab, reorderEditorTab, splitEditorPane } from '../src/lib/editor-layout';

describe('editor tabs and panes', () => {
  it('opens, pins, reorders, duplicates, closes, and restores a tab identity', () => {
    const first = createEditorPane('note-a');
    const opened = openEditorTab(first, first.id, 'note-b');
    const pane = findEditorPane(opened, first.id)!;
    const secondTab = pane.tabs[1]!;
    const pinned = pinEditorTab(opened, first.id, secondTab.id);
    expect(findEditorPane(pinned, first.id)?.tabs[1]?.pinned).toBe(true);
    const reordered = reorderEditorTab(pinned, first.id, secondTab.id, pane.tabs[0]!.id);
    expect(findEditorPane(reordered, first.id)?.tabs[0]?.id).toBe(secondTab.id);
    const duplicate = openEditorTab(reordered, first.id, 'note-b', true);
    expect(findEditorPane(duplicate, first.id)?.tabs.filter((tab) => tab.noteId === 'note-b')).toHaveLength(2);
    const closed = closeEditorTab(duplicate, first.id, secondTab.id);
    expect(closed.closed?.noteId).toBe('note-b');
    expect(findEditorPane(activateEditorTab(closed.root, first.id, pane.tabs[0]!.id), first.id)?.activeTabId).toBe(pane.tabs[0]!.id);
  });

  it('creates nested vertical and horizontal panes that can display one shared note', () => {
    const original = createEditorPane('same-note');
    const vertical = splitEditorPane(original, original.id, 'vertical');
    expect(findEditorPane(vertical.root, vertical.newPaneId)?.tabs[0]?.noteId).toBe('same-note');
    const nested = splitEditorPane(vertical.root, vertical.newPaneId, 'horizontal');
    expect(findEditorPane(nested.root, nested.newPaneId)?.tabs[0]?.noteId).toBe('same-note');
    expect(firstEditorPane(closeEditorPane(nested.root, original.id)).tabs[0]?.noteId).toBe('same-note');
  });
});
