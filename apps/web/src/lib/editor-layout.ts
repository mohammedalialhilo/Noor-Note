export interface EditorTab { id: string; noteId: string; pinned: boolean }
export interface EditorPaneNode { kind: 'pane'; id: string; tabs: EditorTab[]; activeTabId: string | null }
export interface EditorSplitNode { kind: 'split'; id: string; direction: 'vertical' | 'horizontal'; children: [EditorLayoutNode, EditorLayoutNode] }
export type EditorLayoutNode = EditorPaneNode | EditorSplitNode;

const id = () => crypto.randomUUID();
export function createEditorPane(noteId?: string): EditorPaneNode {
  const tab = noteId ? { id: id(), noteId, pinned: false } : null;
  return { kind: 'pane', id: id(), tabs: tab ? [tab] : [], activeTabId: tab?.id ?? null };
}
export function findEditorPane(root: EditorLayoutNode, paneId: string): EditorPaneNode | null {
  if (root.kind === 'pane') return root.id === paneId ? root : null;
  return findEditorPane(root.children[0], paneId) ?? findEditorPane(root.children[1], paneId);
}
export function firstEditorPane(root: EditorLayoutNode): EditorPaneNode { return root.kind === 'pane' ? root : firstEditorPane(root.children[0]); }
export function mapEditorPane(root: EditorLayoutNode, paneId: string, map: (pane: EditorPaneNode) => EditorPaneNode): EditorLayoutNode {
  if (root.kind === 'pane') return root.id === paneId ? map(root) : root;
  return { ...root, children: [mapEditorPane(root.children[0], paneId, map), mapEditorPane(root.children[1], paneId, map)] };
}
export function openEditorTab(root: EditorLayoutNode, paneId: string, noteId: string, duplicate = false): EditorLayoutNode {
  return mapEditorPane(root, paneId, (pane) => {
    const existing = duplicate ? null : pane.tabs.find((tab) => tab.noteId === noteId);
    if (existing) return { ...pane, activeTabId: existing.id };
    const tab = { id: id(), noteId, pinned: false };
    return { ...pane, tabs: [...pane.tabs, tab], activeTabId: tab.id };
  });
}
export function activateEditorTab(root: EditorLayoutNode, paneId: string, tabId: string): EditorLayoutNode {
  return mapEditorPane(root, paneId, (pane) => pane.tabs.some((tab) => tab.id === tabId) ? { ...pane, activeTabId: tabId } : pane);
}
export function closeEditorTab(root: EditorLayoutNode, paneId: string, tabId: string): { root: EditorLayoutNode; closed: EditorTab | null } {
  let closed: EditorTab | null = null;
  const next = mapEditorPane(root, paneId, (pane) => {
    const index = pane.tabs.findIndex((tab) => tab.id === tabId);
    if (index < 0) return pane;
    closed = pane.tabs[index]!;
    const tabs = pane.tabs.filter((tab) => tab.id !== tabId);
    return { ...pane, tabs, activeTabId: pane.activeTabId === tabId ? tabs[Math.min(index, tabs.length - 1)]?.id ?? null : pane.activeTabId };
  });
  return { root: next, closed };
}
export function pinEditorTab(root: EditorLayoutNode, paneId: string, tabId: string): EditorLayoutNode {
  return mapEditorPane(root, paneId, (pane) => ({ ...pane, tabs: pane.tabs.map((tab) => tab.id === tabId ? { ...tab, pinned: !tab.pinned } : tab) }));
}
export function reorderEditorTab(root: EditorLayoutNode, paneId: string, sourceId: string, targetId: string): EditorLayoutNode {
  return mapEditorPane(root, paneId, (pane) => {
    const source = pane.tabs.findIndex((tab) => tab.id === sourceId);
    const target = pane.tabs.findIndex((tab) => tab.id === targetId);
    if (source < 0 || target < 0 || source === target) return pane;
    const tabs = [...pane.tabs];
    const [item] = tabs.splice(source, 1);
    tabs.splice(target, 0, item!);
    return { ...pane, tabs };
  });
}
export function splitEditorPane(root: EditorLayoutNode, paneId: string, direction: EditorSplitNode['direction'], noteId?: string): { root: EditorLayoutNode; newPaneId: string } {
  const pane = findEditorPane(root, paneId);
  if (!pane) return { root, newPaneId: paneId };
  const active = pane.tabs.find((tab) => tab.id === pane.activeTabId);
  const sibling = createEditorPane(noteId ?? active?.noteId);
  const replace = (node: EditorLayoutNode): EditorLayoutNode => {
    if (node.kind === 'pane') return node.id === paneId ? { kind: 'split', id: id(), direction, children: [node, sibling] } : node;
    return { ...node, children: [replace(node.children[0]), replace(node.children[1])] };
  };
  return { root: replace(root), newPaneId: sibling.id };
}
export function closeEditorPane(root: EditorLayoutNode, paneId: string): EditorLayoutNode {
  if (root.kind === 'pane') return root;
  if (root.children[0].kind === 'pane' && root.children[0].id === paneId) return root.children[1];
  if (root.children[1].kind === 'pane' && root.children[1].id === paneId) return root.children[0];
  return { ...root, children: [closeEditorPane(root.children[0], paneId), closeEditorPane(root.children[1], paneId)] };
}
export function removeNoteFromEditorLayout(root: EditorLayoutNode, noteId: string): EditorLayoutNode {
  if (root.kind === 'split') return { ...root, children: [removeNoteFromEditorLayout(root.children[0], noteId), removeNoteFromEditorLayout(root.children[1], noteId)] };
  const tabs = root.tabs.filter((tab) => tab.noteId !== noteId);
  return { ...root, tabs, activeTabId: tabs.some((tab) => tab.id === root.activeTabId) ? root.activeTabId : tabs.at(-1)?.id ?? null };
}
