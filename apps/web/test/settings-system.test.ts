import { describe, expect, it } from 'vitest';
import { defaultEditorPreferences } from '../src/lib/editor-preferences';
import { DEVICE_SETTINGS_KEY, LEGACY_EDITOR_KEY, editorPreferencesSchema, migrateDeviceSettings, readDeviceSettings, settingsCategories, writeDeviceSettings } from '../src/lib/settings-system';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
  };
}

describe('settings system', () => {
  it('registers each requested category once with an explicit scope', () => {
    expect(settingsCategories).toHaveLength(23);
    expect(new Set(settingsCategories.map((item) => item.id)).size).toBe(settingsCategories.length);
    expect(settingsCategories.every((item) => item.scope.length > 0)).toBe(true);
  });

  it('migrates legacy editor preferences without losing valid choices', () => {
    const storage = memoryStorage();
    storage.setItem(LEGACY_EDITOR_KEY, JSON.stringify({ spellcheck: false, fontFamily: 'mono', fontSize: 300 }));
    expect(readDeviceSettings(storage)).toEqual({ version: 1, editor: { ...defaultEditorPreferences, spellcheck: false, fontFamily: 'mono', fontSize: 28 } });
    expect(JSON.parse(storage.getItem(DEVICE_SETTINGS_KEY) ?? '')).toMatchObject({ version: 1, editor: { fontFamily: 'mono' } });
  });

  it('rejects invalid writes and leaves future versions intact', () => {
    const storage = memoryStorage();
    storage.setItem(DEVICE_SETTINGS_KEY, JSON.stringify({ version: 2, editor: defaultEditorPreferences, future: true }));
    expect(readDeviceSettings(storage)).toBeNull();
    expect(JSON.parse(storage.getItem(DEVICE_SETTINGS_KEY) ?? '')).toMatchObject({ version: 2, future: true });
    expect(() => writeDeviceSettings(storage, { version: 1, editor: { ...defaultEditorPreferences, fontSize: 99 } })).toThrow();
    expect(editorPreferencesSchema.safeParse({ ...defaultEditorPreferences, unexpected: true }).success).toBe(false);
    expect(migrateDeviceSettings({ version: 99 }, defaultEditorPreferences)).toBeNull();
  });

  it('does not let a damaged legacy value override a valid current document', () => {
    const storage = memoryStorage();
    storage.setItem(DEVICE_SETTINGS_KEY, JSON.stringify({ version: 1, editor: { ...defaultEditorPreferences, fontFamily: 'serif' } }));
    storage.setItem(LEGACY_EDITOR_KEY, '{broken');
    expect(readDeviceSettings(storage)?.editor.fontFamily).toBe('serif');
  });

  it('writes a validated current document', () => {
    const storage = memoryStorage();
    writeDeviceSettings(storage, { version: 1, editor: defaultEditorPreferences });
    expect(readDeviceSettings(storage)).toEqual({ version: 1, editor: defaultEditorPreferences });
  });
});
