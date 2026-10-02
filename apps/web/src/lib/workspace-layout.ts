import { z } from 'zod';
import { calendarViewSchema, periodKindSchema, workspaceSchema, type Workspace } from '@noor-note/core';
import type { VaultRepository } from '@noor-note/storage';
import { createEditorPane, findEditorPane, firstEditorPane, type EditorLayoutNode } from './editor-layout';

const uuid = z.uuid();
const tabSchema = z.object({ id: uuid, noteId: uuid, pinned: z.boolean() }).strict();
const editorNodeSchema: z.ZodType<EditorLayoutNode> = z.lazy(() => z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pane'), id: uuid, tabs: z.array(tabSchema).max(50), activeTabId: uuid.nullable() }).strict(),
  z.object({ kind: z.literal('split'), id: uuid, direction: z.enum(['vertical', 'horizontal']), children: z.tuple([editorNodeSchema, editorNodeSchema]) }).strict(),
]));
const resourceTabsSchema = z.object({ ids: z.array(uuid).max(30), activeId: uuid.nullable() }).strict();
export const calendarLayoutSchema = z.object({
  view: calendarViewSchema, anchor: z.iso.date(), section: z.enum(['calendar', 'periodic']), periodKind: periodKindSchema,
  folderId: uuid.nullable(), tag: z.string().max(100).nullable(), property: z.string().max(100).nullable(),
  taskStatus: z.enum(['all', 'open', 'done']), baseId: uuid.nullable(),
}).strict();
export type CalendarLayout = z.infer<typeof calendarLayoutSchema>;
export const workspaceLayoutSchema = z.object({
  version: z.literal(1), view: z.enum(['dashboard', 'notes', 'periods', 'tasks', 'study', 'tags', 'graph', 'bases', 'canvas', 'chat', 'organize', 'activity', 'recovery', 'trash', 'settings']),
  editor: z.object({ root: editorNodeSchema, activePaneId: uuid, selectedNoteId: uuid.nullable(), closedTabs: z.array(z.object({ paneId: uuid, tab: tabSchema }).strict()).max(30).default([]) }).strict(),
  sidebars: z.object({ navigationOpen: z.boolean(), inspectorOpen: z.boolean(), navigationWidth: z.number().int().min(180).max(420), noteListWidth: z.number().int().min(220).max(600), inspectorWidth: z.number().int().min(180).max(520) }).strict(),
  graph: z.object({ scope: z.enum(['global', 'local']), filters: z.object({ showTags: z.boolean(), showAttachments: z.boolean(), showLinks: z.boolean(), showEmbeds: z.boolean(), showTagEdges: z.boolean(), hideOrphans: z.boolean() }).strict(), query: z.string().max(200), depth: z.number().int().min(1).max(4), direction: z.enum(['both', 'inbound', 'outbound']), grouping: z.enum(['type', 'folder']), nodeSize: z.enum(['uniform', 'connections']) }).strict(),
  canvasTabs: resourceTabsSchema, baseTabs: resourceTabsSchema,
  calendar: calendarLayoutSchema,
}).strict();
export type WorkspaceLayout = z.infer<typeof workspaceLayoutSchema>;

export function defaultWorkspaceLayout(noteId?: string | null): WorkspaceLayout {
  const root = createEditorPane(noteId ?? undefined);
  const today = new Date();
  const anchor = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return { version: 1, view: 'notes', editor: { root, activePaneId: root.id, selectedNoteId: noteId ?? null, closedTabs: [] },
    sidebars: { navigationOpen: false, inspectorOpen: true, navigationWidth: 244, noteListWidth: 308, inspectorWidth: 232 },
    graph: { scope: 'global', filters: { showTags: false, showAttachments: false, showLinks: true, showEmbeds: true, showTagEdges: true, hideOrphans: false }, query: '', depth: 2, direction: 'both', grouping: 'type', nodeSize: 'connections' }, canvasTabs: { ids: [], activeId: null }, baseTabs: { ids: [], activeId: null },
    calendar: { view: 'month', anchor, section: 'calendar', periodKind: 'daily', folderId: null, tag: null, property: null, taskStatus: 'all', baseId: null },
  };
}

export function parseWorkspaceLayout(input: unknown): WorkspaceLayout {
  const layout = workspaceLayoutSchema.parse(input);
  let panes = 0;
  const ids = new Set<string>();
  const visit = (node: EditorLayoutNode, depth: number) => {
    if (depth > 6 || ids.has(node.id)) throw new Error('Workspace pane tree is invalid');
    ids.add(node.id);
    if (node.kind === 'split') { visit(node.children[0], depth + 1); visit(node.children[1], depth + 1); return; }
    panes++;
    if (panes > 16) throw new Error('Workspace has too many panes');
    if (node.activeTabId && !node.tabs.some((tab) => tab.id === node.activeTabId)) throw new Error('Workspace active tab is missing');
    for (const tab of node.tabs) { if (ids.has(tab.id)) throw new Error('Workspace tab ID is duplicated'); ids.add(tab.id); }
  };
  visit(layout.editor.root, 0);
  if (!findEditorPane(layout.editor.root, layout.editor.activePaneId)) throw new Error('Workspace active pane is missing');
  for (const tabs of [layout.canvasTabs, layout.baseTabs]) {
    if (new Set(tabs.ids).size !== tabs.ids.length || tabs.activeId && !tabs.ids.includes(tabs.activeId)) throw new Error('Workspace resource tabs are invalid');
  }
  return layout;
}

export function reconcileWorkspaceLayout(layout: WorkspaceLayout, noteIds: ReadonlySet<string>, canvasIds: ReadonlySet<string>, baseIds: ReadonlySet<string>): WorkspaceLayout {
  const prune = (node: EditorLayoutNode): EditorLayoutNode => {
    if (node.kind === 'split') return { ...node, children: [prune(node.children[0]), prune(node.children[1])] };
    const tabs = node.tabs.filter((tab) => noteIds.has(tab.noteId));
    return { ...node, tabs, activeTabId: tabs.some((tab) => tab.id === node.activeTabId) ? node.activeTabId : tabs[0]?.id ?? null };
  };
  const root = prune(layout.editor.root);
  const pane = findEditorPane(root, layout.editor.activePaneId) ?? firstEditorPane(root);
  const selectedNoteId = pane.tabs.find((tab) => tab.id === pane.activeTabId)?.noteId ?? null;
  const resources = (tabs: WorkspaceLayout['canvasTabs'], valid: ReadonlySet<string>) => {
    const ids = tabs.ids.filter((id) => valid.has(id));
    return { ids, activeId: tabs.activeId && ids.includes(tabs.activeId) ? tabs.activeId : ids[0] ?? null };
  };
  return { ...layout, editor: { root, activePaneId: pane.id, selectedNoteId, closedTabs: layout.editor.closedTabs.filter((entry) => noteIds.has(entry.tab.noteId)) }, canvasTabs: resources(layout.canvasTabs, canvasIds), baseTabs: resources(layout.baseTabs, baseIds) };
}

export function remapWorkspaceLayout(layout: WorkspaceLayout, noteIds: ReadonlyMap<string, string>, canvasIds: ReadonlyMap<string, string>, baseIds: ReadonlyMap<string, string>, folderIds: ReadonlyMap<string, string>): WorkspaceLayout {
  const remapEditor = (node: EditorLayoutNode): EditorLayoutNode => node.kind === 'split' ? { ...node, children: [remapEditor(node.children[0]), remapEditor(node.children[1])] } : { ...node, tabs: node.tabs.flatMap((tab) => { const noteId = noteIds.get(tab.noteId); return noteId ? [{ ...tab, noteId }] : []; }) };
  const resources = (tabs: WorkspaceLayout['canvasTabs'], ids: ReadonlyMap<string, string>) => ({ ids: tabs.ids.flatMap((id) => { const mapped = ids.get(id); return mapped ? [mapped] : []; }), activeId: tabs.activeId ? ids.get(tabs.activeId) ?? null : null });
  const mapped = { ...layout, editor: { ...layout.editor, root: remapEditor(layout.editor.root), selectedNoteId: layout.editor.selectedNoteId ? noteIds.get(layout.editor.selectedNoteId) ?? null : null, closedTabs: layout.editor.closedTabs.flatMap((entry) => { const noteId = noteIds.get(entry.tab.noteId); return noteId ? [{ ...entry, tab: { ...entry.tab, noteId } }] : []; }) }, canvasTabs: resources(layout.canvasTabs, canvasIds), baseTabs: resources(layout.baseTabs, baseIds), calendar: { ...layout.calendar, folderId: layout.calendar.folderId ? folderIds.get(layout.calendar.folderId) ?? null : null, baseId: layout.calendar.baseId ? baseIds.get(layout.calendar.baseId) ?? null : null } };
  return reconcileWorkspaceLayout(mapped, new Set(noteIds.values()), new Set(canvasIds.values()), new Set(baseIds.values()));
}

const liveKey = (vaultId: string) => `noor-note:current-layout:${vaultId}`;
const startupKey = (vaultId: string) => `noor-note:startup-workspace:${vaultId}`;
export function readCurrentLayout(vaultId: string): WorkspaceLayout | null {
  try { const text = localStorage.getItem(liveKey(vaultId)); return text ? parseWorkspaceLayout(JSON.parse(text) as unknown) : null; } catch { return null; }
}
export function writeCurrentLayout(vaultId: string, layout: WorkspaceLayout): void { localStorage.setItem(liveKey(vaultId), JSON.stringify(parseWorkspaceLayout(layout))); }
export function readStartupWorkspaceId(vaultId: string): string | null {
  try { const value = localStorage.getItem(startupKey(vaultId)); return value && uuid.safeParse(value).success ? value : null; } catch { return null; }
}
export function writeStartupWorkspaceId(vaultId: string, id: string | null): void {
  if (id) localStorage.setItem(startupKey(vaultId), uuid.parse(id)); else localStorage.removeItem(startupKey(vaultId));
}

export class WorkspacesStore {
  constructor(private readonly repository: VaultRepository, private readonly vaultId: string) {}
  async list(): Promise<Workspace[]> {
    const rows = await this.repository.listObjects('workspace', this.vaultId);
    return rows.flatMap((row) => {
      const result = workspaceSchema.safeParse(row);
      if (!result.success) return [];
      try { parseWorkspaceLayout(result.data.layout); return [result.data]; } catch { return []; }
    }).sort((a, b) => a.name.localeCompare(b.name));
  }
  async create(name: string, layout: WorkspaceLayout): Promise<Workspace> {
    const timestamp = new Date().toISOString();
    const workspace = workspaceSchema.parse({ id: crypto.randomUUID(), vaultId: this.vaultId, name: name.trim(), layout: parseWorkspaceLayout(layout), createdAt: timestamp, updatedAt: timestamp });
    await this.repository.putObject('workspace', workspace);
    return workspace;
  }
  async save(workspace: Workspace, layout: WorkspaceLayout): Promise<Workspace> {
    if (workspace.vaultId !== this.vaultId) throw new Error('Workspace belongs to another vault');
    const updated = workspaceSchema.parse({ ...workspace, layout: parseWorkspaceLayout(layout), updatedAt: new Date().toISOString() });
    await this.repository.putObject('workspace', updated);
    return updated;
  }
  async rename(workspace: Workspace, name: string): Promise<Workspace> {
    if (workspace.vaultId !== this.vaultId) throw new Error('Workspace belongs to another vault');
    const updated = workspaceSchema.parse({ ...workspace, name: name.trim(), updatedAt: new Date().toISOString() });
    await this.repository.putObject('workspace', updated);
    return updated;
  }
  async duplicate(workspace: Workspace): Promise<Workspace> {
    if (workspace.vaultId !== this.vaultId) throw new Error('Workspace belongs to another vault');
    return this.create(`${workspace.name} copy`, parseWorkspaceLayout(workspace.layout));
  }
  async delete(workspace: Workspace): Promise<void> {
    if (workspace.vaultId !== this.vaultId) throw new Error('Workspace belongs to another vault');
    await this.repository.deleteObject(workspace.id);
  }
}
