import { normalizeShortcut } from './shortcuts';
import type { NoteRefactorRequest, PeriodKind } from '@noor-note/core';
import { noteActions, type NoteActionId } from '@noor-note/ai';

export type CommandCategory = 'Navigation' | 'Notes' | 'Tabs' | 'Panes' | 'Files' | 'Editor';
export type EditorCommandAction = 'source' | 'live' | 'reading' | 'present' | 'heading' | 'bold' | 'italic' | 'strike' | 'task' | 'list' | 'link' | 'inline-code' | 'undo' | 'redo' | 'find' | 'copy-block-link' | 'details' | 'settings' | 'focus' | 'download' | 'delete';
export interface CommandAvailability {
  hasNote: boolean;
  hasEditor: boolean;
  hasTab: boolean;
  hasClosedTab: boolean;
  hasSplit: boolean;
}
export interface CommandContext extends CommandAvailability {
  openQuickSwitcher: () => void;
  openPalette: () => void;
  createNote: () => void;
  focusSearch: () => void;
  showNotes: () => void;
  showDashboard: () => void;
  showTasks: () => void;
  showStudy: () => void;
  showActivity: () => void;
  showTags: () => void;
  showGlobalGraph: () => void;
  showLocalGraph: () => void;
  showBases: () => void;
  showCanvas: () => void;
  showTrash: () => void;
  showRecovery: () => void;
  showSettings: () => void;
  insertTemplate: () => void;
  createFromTemplate: () => void;
  applyTemplateProperties: () => void;
  previewTemplate: () => void;
  createDailyNote: () => void;
  showPeriodNotes: (kind: PeriodKind) => void;
  importFiles: () => void;
  exportVault: () => void;
  closeTab: () => void;
  restoreTab: () => void;
  nextTab: () => void;
  previousTab: () => void;
  pinTab: () => void;
  splitVertical: () => void;
  splitHorizontal: () => void;
  closePane: () => void;
  duplicateNote: () => void;
  openAudioRecorder: () => void;
  openNoteComposer: (kind: NoteRefactorRequest['kind']) => void;
  openAiNoteAction: (action: NoteActionId) => void;
  manageWorkspaces: () => void;
  saveWorkspace: () => void;
  loadWorkspace: () => void;
  duplicateWorkspace: () => void;
  renameWorkspace: () => void;
  deleteWorkspace: () => void;
  setStartupWorkspace: () => void;
  manageBookmarks: () => void;
  bookmarkCurrentNote: () => void;
  toggleFavoriteNote: () => void;
  togglePinnedNote: () => void;
  runEditorAction: (action: EditorCommandAction) => void;
}
export interface CommandDefinition {
  id: string;
  name: string;
  category: CommandCategory | string;
  handler: (context: CommandContext) => void | Promise<void>;
  defaultShortcut?: string;
  available?: (context: CommandAvailability) => boolean;
}

/** Shared by core commands and future plugin registrations. */
export class CommandRegistry {
  private readonly commands = new Map<string, CommandDefinition>();
  private readonly listeners = new Set<() => void>();
  private snapshot: CommandDefinition[] = [];
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  getSnapshot = (): CommandDefinition[] => this.snapshot;
  register(command: CommandDefinition): () => void {
    if (!/^[a-z][a-z0-9.-]+$/u.test(command.id) || this.commands.has(command.id)) throw new Error(`Invalid or duplicate command ID: ${command.id}`);
    if (command.defaultShortcut && normalizeShortcut(command.defaultShortcut) !== command.defaultShortcut) throw new Error(`Invalid default shortcut: ${command.defaultShortcut}`);
    if (command.defaultShortcut && [...this.commands.values()].some((existing) => existing.defaultShortcut === command.defaultShortcut)) throw new Error(`Shortcut already registered: ${command.defaultShortcut}`);
    this.commands.set(command.id, command);
    this.publish();
    return () => { if (this.commands.get(command.id) === command) { this.commands.delete(command.id); this.publish(); } };
  }
  get(id: string): CommandDefinition | undefined { return this.commands.get(id); }
  async execute(id: string, context: CommandContext): Promise<boolean> {
    const command = this.commands.get(id);
    if (!command || command.available && !command.available(context)) return false;
    await command.handler(context);
    return true;
  }
  private publish(): void {
    this.snapshot = [...this.commands.values()].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    for (const listener of this.listeners) listener();
  }
}

export const commandRegistry = new CommandRegistry();
const core: CommandDefinition[] = [
  { id: 'navigation.quick-switcher', name: 'Open quick switcher', category: 'Navigation', defaultShortcut: 'Mod+O', handler: (c) => c.openQuickSwitcher() },
  { id: 'navigation.command-palette', name: 'Open command palette', category: 'Navigation', defaultShortcut: 'Mod+P', handler: (c) => c.openPalette() },
  { id: 'navigation.palette-legacy', name: 'Open command palette (legacy shortcut)', category: 'Navigation', defaultShortcut: 'Mod+K', handler: (c) => c.openPalette() },
  { id: 'navigation.all-notes', name: 'Show all notes', category: 'Navigation', handler: (c) => c.showNotes() },
  { id: 'navigation.dashboard', name: 'Show dashboards', category: 'Navigation', handler: (c) => c.showDashboard() },
  { id: 'navigation.tasks', name: 'Show tasks', category: 'Navigation', handler: (c) => c.showTasks() },
  { id: 'navigation.study', name: 'Show study cards', category: 'Navigation', handler: (c) => c.showStudy() },
  { id: 'navigation.activity', name: 'Show shared activity', category: 'Navigation', handler: (c) => c.showActivity() },
  { id: 'navigation.tags', name: 'Show tags', category: 'Navigation', handler: (c) => c.showTags() },
  { id: 'navigation.graph', name: 'Show global graph', category: 'Navigation', handler: (c) => c.showGlobalGraph() },
  { id: 'navigation.local-graph', name: 'Show local graph', category: 'Navigation', available: (c) => c.hasNote, handler: (c) => c.showLocalGraph() },
  { id: 'navigation.bases', name: 'Show Bases', category: 'Navigation', handler: (c) => c.showBases() },
  { id: 'navigation.canvas', name: 'Show Canvas', category: 'Navigation', handler: (c) => c.showCanvas() },
  { id: 'navigation.trash', name: 'Open Trash', category: 'Navigation', handler: (c) => c.showTrash() },
  { id: 'navigation.recovery', name: 'Open Recovery Center', category: 'Navigation', handler: (c) => c.showRecovery() },
  { id: 'navigation.settings', name: 'Open settings', category: 'Navigation', handler: (c) => c.showSettings() },
  { id: 'workspaces.manage', name: 'Manage workspaces', category: 'Workspaces', handler: (c) => c.manageWorkspaces() },
  { id: 'workspaces.save', name: 'Save current workspace', category: 'Workspaces', handler: (c) => c.saveWorkspace() },
  { id: 'workspaces.load', name: 'Load workspace', category: 'Workspaces', handler: (c) => c.loadWorkspace() },
  { id: 'workspaces.duplicate', name: 'Duplicate workspace', category: 'Workspaces', handler: (c) => c.duplicateWorkspace() },
  { id: 'workspaces.rename', name: 'Rename workspace', category: 'Workspaces', handler: (c) => c.renameWorkspace() },
  { id: 'workspaces.delete', name: 'Delete workspace', category: 'Workspaces', handler: (c) => c.deleteWorkspace() },
  { id: 'workspaces.startup', name: 'Set startup workspace', category: 'Workspaces', handler: (c) => c.setStartupWorkspace() },
  { id: 'bookmarks.manage', name: 'Open bookmarks and recents', category: 'Bookmarks', handler: (c) => c.manageBookmarks() },
  { id: 'bookmarks.add-note', name: 'Bookmark current note', category: 'Bookmarks', available: (c) => c.hasNote, handler: (c) => c.bookmarkCurrentNote() },
  { id: 'bookmarks.favorite-note', name: 'Toggle favorite note', category: 'Bookmarks', available: (c) => c.hasNote, handler: (c) => c.toggleFavoriteNote() },
  { id: 'bookmarks.pin-note', name: 'Toggle pinned note', category: 'Bookmarks', available: (c) => c.hasNote, handler: (c) => c.togglePinnedNote() },
  { id: 'notes.new', name: 'Create note', category: 'Notes', defaultShortcut: 'Mod+N', handler: (c) => c.createNote() },
  { id: 'notes.search', name: 'Search notes', category: 'Notes', defaultShortcut: 'Mod+Shift+F', handler: (c) => c.focusSearch() },
  { id: 'notes.duplicate', name: 'Duplicate current note', category: 'Notes', available: (c) => c.hasNote, handler: (c) => c.duplicateNote() },
  { id: 'notes.record-audio', name: 'Record voice note', category: 'Notes', handler: (c) => c.openAudioRecorder() },
  ...([
    ['merge', 'Merge notes'], ['split', 'Split note by heading'], ['extract-selection', 'Extract selection to note'],
    ['extract-heading', 'Extract heading to note'], ['move-heading', 'Move heading to note'],
    ['duplicate-heading', 'Duplicate heading'], ['canvas-selection', 'Selection to Canvas cards'],
    ['moc', 'Create index note'],
  ] as const).map(([kind, name]): CommandDefinition => ({ id: `notes.compose.${kind}`, name, category: 'Notes', available: (c) => c.hasEditor, handler: (c) => c.openNoteComposer(kind) })),
  ...noteActions.map((action): CommandDefinition => ({ id: `ai.note.${action.id}`, name: `AI: ${action.name}`, category: 'AI', available: (c) => c.hasEditor, handler: (c) => c.openAiNoteAction(action.id) })),
  { id: 'templates.insert', name: 'Insert template', category: 'Templates', available: (c) => c.hasEditor, handler: (c) => c.insertTemplate() },
  { id: 'templates.create', name: 'Create note from template', category: 'Templates', handler: (c) => c.createFromTemplate() },
  { id: 'templates.properties', name: 'Apply template properties', category: 'Templates', available: (c) => c.hasEditor, handler: (c) => c.applyTemplateProperties() },
  { id: 'templates.preview', name: 'Preview template', category: 'Templates', handler: (c) => c.previewTemplate() },
  { id: 'templates.daily', name: 'Open or create daily note', category: 'Templates', handler: (c) => c.createDailyNote() },
  ...(['daily', 'weekly', 'monthly', 'quarterly', 'yearly'] as PeriodKind[]).map((kind): CommandDefinition => ({ id: `periods.${kind}`, name: `Show ${kind} notes`, category: 'Periodic notes', handler: (c) => c.showPeriodNotes(kind) })),
  { id: 'tabs.close', name: 'Close active tab', category: 'Tabs', defaultShortcut: 'Mod+W', available: (c) => c.hasTab, handler: (c) => c.closeTab() },
  { id: 'tabs.restore', name: 'Restore closed tab', category: 'Tabs', defaultShortcut: 'Mod+Shift+T', available: (c) => c.hasClosedTab, handler: (c) => c.restoreTab() },
  { id: 'tabs.next', name: 'Next tab', category: 'Tabs', available: (c) => c.hasTab, handler: (c) => c.nextTab() },
  { id: 'tabs.previous', name: 'Previous tab', category: 'Tabs', available: (c) => c.hasTab, handler: (c) => c.previousTab() },
  { id: 'tabs.pin', name: 'Pin or unpin active tab', category: 'Tabs', available: (c) => c.hasTab, handler: (c) => c.pinTab() },
  { id: 'panes.split-vertical', name: 'Split pane vertically', category: 'Panes', available: (c) => c.hasEditor, handler: (c) => c.splitVertical() },
  { id: 'panes.split-horizontal', name: 'Split pane horizontally', category: 'Panes', available: (c) => c.hasEditor, handler: (c) => c.splitHorizontal() },
  { id: 'panes.close', name: 'Close active pane', category: 'Panes', available: (c) => c.hasEditor && c.hasSplit, handler: (c) => c.closePane() },
  { id: 'files.import', name: 'Import files', category: 'Files', handler: (c) => c.importFiles() },
  { id: 'files.export', name: 'Open Export Center', category: 'Files', handler: (c) => c.exportVault() },
  ...([
    ['source', 'Switch to Source Mode'], ['live', 'Switch to Live Preview'], ['reading', 'Switch to Reading Mode'], ['present', 'Present current note'],
    ['heading', 'Insert heading'], ['bold', 'Bold selection'], ['italic', 'Italic selection'], ['strike', 'Strike selection'],
    ['task', 'Insert task'], ['list', 'Insert list'], ['link', 'Insert link'], ['inline-code', 'Inline code'],
    ['undo', 'Undo'], ['redo', 'Redo'], ['find', 'Find and replace'], ['copy-block-link', 'Copy block link'],
    ['details', 'Toggle note details'], ['settings', 'Toggle editor settings'], ['focus', 'Toggle focus mode'],
    ['download', 'Download current Markdown'], ['delete', 'Move current note to Trash'],
  ] as [EditorCommandAction, string][]).map(([action, name]): CommandDefinition => ({ id: `editor.${action}`, name, category: 'Editor', available: (c) => c.hasEditor, handler: (c) => c.runEditorAction(action) })),
];
for (const command of core) commandRegistry.register(command);
