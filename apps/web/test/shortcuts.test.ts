// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { commandRegistry } from '../src/lib/commands';
import { effectiveShortcut, matchesShortcut, normalizeShortcut, readShortcutOverrides, shortcutConflict, shortcutFromEvent, writeShortcutOverrides } from '../src/lib/shortcuts';

afterEach(() => localStorage.clear());

describe('keyboard shortcuts', () => {
  it('normalizes platform modifiers and matches keyboard events', () => {
    expect(normalizeShortcut('Shift+Mod+O')).toBe('Mod+Shift+O');
    expect(shortcutFromEvent(new KeyboardEvent('keydown', { key: 'o', ctrlKey: true }))).toBe('Mod+O');
    expect(shortcutFromEvent(new KeyboardEvent('keydown', { key: 'o', metaKey: true }))).toBe('Mod+O');
    expect(matchesShortcut(new KeyboardEvent('keydown', { key: 'o', ctrlKey: true }), 'Mod+O')).toBe(true);
    expect(matchesShortcut(new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, shiftKey: true }), 'Mod+O')).toBe(false);
    expect(normalizeShortcut('O')).toBeNull();
  });

  it('persists removal and custom assignments and detects collisions', () => {
    const commands = commandRegistry.getSnapshot();
    const quick = commandRegistry.get('navigation.quick-switcher')!;
    expect(shortcutConflict(commands, {}, 'navigation.quick-switcher', 'Mod+P')?.id).toBe('navigation.command-palette');
    const overrides = { 'navigation.quick-switcher': 'Mod+Shift+O', 'navigation.command-palette': null };
    writeShortcutOverrides(overrides);
    expect(readShortcutOverrides()).toEqual(overrides);
    expect(effectiveShortcut(quick, readShortcutOverrides())).toBe('Mod+Shift+O');
    localStorage.setItem('noor-note-shortcuts-v1', '{"navigation.quick-switcher":"Shift+Mod+O"}');
    expect(readShortcutOverrides()['navigation.quick-switcher']).toBe('Mod+Shift+O');
    localStorage.setItem('noor-note-shortcuts-v1', '{"bad":"not a shortcut"}');
    expect(readShortcutOverrides()).toEqual({});
  });
});
