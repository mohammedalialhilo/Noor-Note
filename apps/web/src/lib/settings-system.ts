import { z } from 'zod';
import { defaultEditorPreferences, type EditorPreferences } from './editor-preferences';

export const settingsCategories = [
  { id: 'general', label: 'General', scope: 'device and vault' },
  { id: 'appearance', label: 'Appearance', scope: 'device' },
  { id: 'editor', label: 'Editor', scope: 'device' },
  { id: 'files-links', label: 'Files & Links', scope: 'vault' },
  { id: 'search', label: 'Search', scope: 'vault' },
  { id: 'graph', label: 'Graph', scope: 'vault workspace' },
  { id: 'canvas', label: 'Canvas', scope: 'vault workspace' },
  { id: 'bases', label: 'Bases', scope: 'vault' },
  { id: 'tasks', label: 'Tasks', scope: 'vault' },
  { id: 'calendar', label: 'Calendar', scope: 'vault workspace' },
  { id: 'templates', label: 'Templates', scope: 'vault' },
  { id: 'daily-notes', label: 'Daily Notes', scope: 'vault' },
  { id: 'ai', label: 'AI', scope: 'device' },
  { id: 'sync', label: 'Sync', scope: 'account and vault' },
  { id: 'collaboration', label: 'Collaboration', scope: 'account and vault' },
  { id: 'plugins', label: 'Plugins', scope: 'device' },
  { id: 'themes', label: 'Themes', scope: 'device' },
  { id: 'publishing', label: 'Publishing', scope: 'account and vault' },
  { id: 'privacy', label: 'Privacy', scope: 'device and vault' },
  { id: 'security', label: 'Security', scope: 'account and vault' },
  { id: 'backup', label: 'Backup', scope: 'vault' },
  { id: 'advanced', label: 'Advanced', scope: 'device and vault' },
  { id: 'about', label: 'About Noor Note', scope: 'device' },
] as const;

export type SettingsCategory = (typeof settingsCategories)[number]['id'];

export const editorPreferencesSchema = z.object({
  lineNumbers: z.boolean(), spellcheck: z.boolean(), wordWrap: z.boolean(),
  focusMode: z.boolean(), typewriterMode: z.boolean(),
  fontFamily: z.enum(['sans', 'serif', 'mono']),
  fontSize: z.number().finite().min(11).max(28),
  lineHeight: z.number().finite().min(1.2).max(2.5),
}).strict();

const deviceSettingsSchema = z.object({ version: z.literal(1), editor: editorPreferencesSchema }).strict();
export type DeviceSettings = z.infer<typeof deviceSettingsSchema>;
export const DEVICE_SETTINGS_KEY = 'noor-note:settings:device';
export const LEGACY_EDITOR_KEY = 'noor-note-editor-preferences';

export function parseEditorPreferences(value: unknown): EditorPreferences {
  if (typeof value !== 'object' || value === null) return defaultEditorPreferences;
  const record = value as Record<string, unknown>;
  const boolean = (key: keyof EditorPreferences) => typeof record[key] === 'boolean' ? record[key] as boolean : defaultEditorPreferences[key] as boolean;
  const number = (key: 'fontSize' | 'lineHeight', min: number, max: number) => typeof record[key] === 'number' && Number.isFinite(record[key]) ? Math.min(max, Math.max(min, record[key])) : defaultEditorPreferences[key];
  return editorPreferencesSchema.parse({
    lineNumbers: boolean('lineNumbers'), spellcheck: boolean('spellcheck'), wordWrap: boolean('wordWrap'),
    focusMode: boolean('focusMode'), typewriterMode: boolean('typewriterMode'),
    fontFamily: record.fontFamily === 'serif' || record.fontFamily === 'mono' ? record.fontFamily : 'sans',
    fontSize: number('fontSize', 11, 28), lineHeight: number('lineHeight', 1.2, 2.5),
  });
}

/** Upgrade known older documents; leave future versions untouched rather than overwriting them. */
export function migrateDeviceSettings(current: unknown, legacyEditor?: unknown): DeviceSettings | null {
  const parsed = deviceSettingsSchema.safeParse(current);
  if (parsed.success) return parsed.data;
  if (typeof current === 'object' && current !== null && 'version' in current) return null;
  return { version: 1, editor: parseEditorPreferences(legacyEditor) };
}

export function readDeviceSettings(storage: Pick<Storage, 'getItem' | 'setItem'>): DeviceSettings | null {
  let current: unknown;
  let legacy: unknown;
  let raw: string | null;
  try {
    raw = storage.getItem(DEVICE_SETTINGS_KEY);
    current = raw === null ? undefined : JSON.parse(raw) as unknown;
  } catch { return null; }
  const parsed = deviceSettingsSchema.safeParse(current);
  if (parsed.success) return parsed.data;
  if (raw !== null) return null;
  try {
    const legacyRaw = storage.getItem(LEGACY_EDITOR_KEY);
    legacy = legacyRaw === null ? undefined : JSON.parse(legacyRaw) as unknown;
  } catch { legacy = undefined; }
  const settings = migrateDeviceSettings(current, legacy);
  if (settings) {
    try { storage.setItem(DEVICE_SETTINGS_KEY, JSON.stringify(settings)); } catch { /* Session remains usable. */ }
  }
  return settings;
}

export function writeDeviceSettings(storage: Pick<Storage, 'setItem'>, settings: DeviceSettings): void {
  storage.setItem(DEVICE_SETTINGS_KEY, JSON.stringify(deviceSettingsSchema.parse(settings)));
}
