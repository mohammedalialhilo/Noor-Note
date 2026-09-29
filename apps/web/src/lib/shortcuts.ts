import { z } from 'zod';
import type { CommandDefinition } from './commands';

export type ShortcutOverrides = Record<string, string | null>;
const storageKey = 'noor-note-shortcuts-v1';
const storedSchema = z.record(z.string(), z.string().max(80).nullable());
const modifierOrder = ['Mod', 'Ctrl', 'Meta', 'Alt', 'Shift'] as const;

export function normalizeShortcut(value: string): string | null {
  const parts = value.split('+').map((part) => part.trim()).filter(Boolean);
  const key = parts.at(-1);
  const modifiers = parts.slice(0, -1);
  if (!key || !/^(?:[A-Z0-9]|F(?:[1-9]|1[0-2])|Arrow(?:Up|Down|Left|Right)|Enter|Backspace|Delete|Escape|Tab|Space)$/u.test(key)) return null;
  if (!modifiers.length || modifiers.some((modifier) => !modifierOrder.includes(modifier as typeof modifierOrder[number])) || new Set(modifiers).size !== modifiers.length || modifiers.includes('Mod') && (modifiers.includes('Ctrl') || modifiers.includes('Meta'))) return null;
  return [...modifierOrder.filter((modifier) => modifiers.includes(modifier)), key].join('+');
}
export function shortcutFromEvent(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): string | null {
  if (['Control', 'Meta', 'Alt', 'Shift'].includes(event.key)) return null;
  const key = event.key.length === 1 ? event.key.toLocaleUpperCase() : event.key === ' ' ? 'Space' : event.key;
  const modifiers = [event.ctrlKey || event.metaKey ? 'Mod' : null, event.altKey ? 'Alt' : null, event.shiftKey ? 'Shift' : null].filter((part): part is string => Boolean(part));
  return normalizeShortcut([...modifiers, key].join('+'));
}
export function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const expected = normalizeShortcut(shortcut);
  if (!expected || event.isComposing) return false;
  if (expected.startsWith('Ctrl+') || expected.startsWith('Meta+')) {
    const key = event.key.length === 1 ? event.key.toLocaleUpperCase() : event.key === ' ' ? 'Space' : event.key;
    const parts = [event.ctrlKey ? 'Ctrl' : null, event.metaKey ? 'Meta' : null, event.altKey ? 'Alt' : null, event.shiftKey ? 'Shift' : null, key].filter((part): part is string => Boolean(part));
    return normalizeShortcut(parts.join('+')) === expected;
  }
  return shortcutFromEvent(event) === expected;
}
export function readShortcutOverrides(): ShortcutOverrides {
  try {
    const parsed = storedSchema.parse(JSON.parse(localStorage.getItem(storageKey) ?? '{}'));
    return Object.entries(parsed).reduce<ShortcutOverrides>((result, [id, value]) => {
      if (value === null) result[id] = null;
      else { const normalized = normalizeShortcut(value); if (normalized) result[id] = normalized; }
      return result;
    }, {});
  } catch { return {}; }
}
export function writeShortcutOverrides(overrides: ShortcutOverrides): void {
  const parsed = storedSchema.parse(overrides);
  localStorage.setItem(storageKey, JSON.stringify(parsed));
}
export function effectiveShortcut(command: CommandDefinition, overrides: ShortcutOverrides): string | null {
  return Object.hasOwn(overrides, command.id) ? overrides[command.id] ?? null : command.defaultShortcut ?? null;
}
export function shortcutConflict(commands: CommandDefinition[], overrides: ShortcutOverrides, id: string, shortcut: string): CommandDefinition | null {
  const normalized = normalizeShortcut(shortcut);
  if (!normalized) throw new Error('Press a modifier and a supported key');
  return commands.find((command) => command.id !== id && effectiveShortcut(command, overrides) === normalized) ?? null;
}
