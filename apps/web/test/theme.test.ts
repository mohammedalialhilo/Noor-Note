import { describe, expect, it } from 'vitest';
import { parseThemePreference, resolveTheme } from '../src/theme/theme';

describe('theme preference', () => {
  it('accepts only the supported persisted values', () => {
    expect(parseThemePreference('light')).toBe('light');
    expect(parseThemePreference('dark')).toBe('dark');
    expect(parseThemePreference('system')).toBe('system');
    expect(parseThemePreference('unexpected')).toBe('system');
    expect(parseThemePreference(null)).toBe('system');
  });

  it('resolves system changes without overriding an explicit selection', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});
