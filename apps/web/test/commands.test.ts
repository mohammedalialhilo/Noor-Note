import { describe, expect, it, vi } from 'vitest';
import { CommandRegistry, commandRegistry, type CommandContext } from '../src/lib/commands';

function context(): CommandContext {
  const noop = () => undefined;
  return { hasNote: false, hasEditor: false, hasTab: false, hasClosedTab: false, hasSplit: false, openQuickSwitcher: noop, openPalette: noop, createNote: noop, focusSearch: noop, showNotes: noop, showDashboard: noop, showTasks: noop, showStudy: noop, showActivity: noop, showTags: noop, showGlobalGraph: noop, showLocalGraph: noop, showBases: noop, showCanvas: noop, showTrash: noop, showSettings: noop, insertTemplate: noop, createFromTemplate: noop, applyTemplateProperties: noop, previewTemplate: noop, createDailyNote: noop, showPeriodNotes: noop, importFiles: noop, exportVault: noop, closeTab: noop, restoreTab: noop, nextTab: noop, previousTab: noop, pinTab: noop, splitVertical: noop, splitHorizontal: noop, closePane: noop, duplicateNote: noop, openAudioRecorder: noop, openNoteComposer: noop, openAiNoteAction: noop, manageWorkspaces: noop, saveWorkspace: noop, loadWorkspace: noop, duplicateWorkspace: noop, renameWorkspace: noop, deleteWorkspace: noop, setStartupWorkspace: noop, manageBookmarks: noop, bookmarkCurrentNote: noop, toggleFavoriteNote: noop, togglePinnedNote: noop, runEditorAction: noop };
}

describe('command registry', () => {
  it('registers core navigation, file, tab, and pane actions', () => {
    expect(commandRegistry.get('navigation.quick-switcher')?.defaultShortcut).toBe('Mod+O');
    expect(commandRegistry.get('navigation.command-palette')?.defaultShortcut).toBe('Mod+P');
    expect(commandRegistry.get('navigation.activity')?.name).toBe('Show shared activity');
    expect(commandRegistry.get('files.export')?.name).toBe('Open Export Center');
    expect(commandRegistry.get('editor.present')?.name).toBe('Present current note');
    expect(commandRegistry.get('tabs.close')?.available?.(context())).toBe(false);
  });

  it('supports plugin registrations, subscriptions, availability, and unregistering', async () => {
    const registry = new CommandRegistry();
    const notify = vi.fn();
    const handler = vi.fn();
    const unsubscribe = registry.subscribe(notify);
    const unregister = registry.register({ id: 'plugin.example.run', name: 'Run example', category: 'Plugin', defaultShortcut: 'Mod+G', available: (state) => state.hasNote, handler });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(await registry.execute('plugin.example.run', context())).toBe(false);
    expect(await registry.execute('plugin.example.run', { ...context(), hasNote: true })).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(() => registry.register({ id: 'plugin.example.other', name: 'Other', category: 'Plugin', defaultShortcut: 'Mod+G', handler })).toThrow(/Shortcut already registered/);
    unregister(); unsubscribe();
    expect(registry.getSnapshot()).toEqual([]);
  });
});
