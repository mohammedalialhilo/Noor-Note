'use client';

import { createContext, useContext, useInsertionEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { parseThemePreference, resolveTheme, THEME_CHANGE_EVENT, THEME_STORAGE_KEY, type ResolvedTheme, type ThemePreference } from './theme';
import { compileCssSnippet, compileTheme, getAppearanceRevision, getAppearanceSnapshot, getServerAppearance, saveAppearance, subscribeAppearance } from './appearance';

interface ThemeContextValue {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  activeThemeId: string | null;
  appearanceRevision: number;
  setPreference: (preference: ThemePreference) => void;
  activateTheme: (id: string) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const getServerPreference = (): ThemePreference => 'system';
const getServerDark = (): boolean => false;
let sessionPreference: ThemePreference | null = null;

function getPreference(): ThemePreference {
  try { return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY)); }
  catch { return sessionPreference ?? 'system'; }
}

function subscribePreference(onStoreChange: () => void): () => void {
  window.addEventListener('storage', onStoreChange);
  window.addEventListener(THEME_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener('storage', onStoreChange);
    window.removeEventListener(THEME_CHANGE_EVENT, onStoreChange);
  };
}

function getSystemDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function subscribeSystemTheme(onStoreChange: () => void): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', onStoreChange);
  return () => media.removeEventListener('change', onStoreChange);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const preference = useSyncExternalStore(subscribePreference, getPreference, getServerPreference);
  const prefersDark = useSyncExternalStore(subscribeSystemTheme, getSystemDark, getServerDark);
  const appearance = useSyncExternalStore(subscribeAppearance, getAppearanceSnapshot, getServerAppearance);
  const activeTheme = appearance.themes.find((theme) => theme.id === appearance.activeThemeId) ?? null;
  const resolvedTheme = activeTheme?.base ?? resolveTheme(preference, prefersDark);
  const appearanceRevision = getAppearanceRevision();

  useInsertionEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    const themeStyle = document.getElementById('noor-note-custom-theme') ?? document.createElement('style');
    themeStyle.id = 'noor-note-custom-theme';
    themeStyle.textContent = compileTheme(activeTheme);
    if (!themeStyle.isConnected) document.head.append(themeStyle);
    const snippetStyle = document.getElementById('noor-note-css-snippets') ?? document.createElement('style');
    snippetStyle.id = 'noor-note-css-snippets';
    snippetStyle.textContent = appearance.snippets.filter((snippet) => snippet.enabled).map((snippet) => compileCssSnippet(snippet.source)).join('\n');
    if (!snippetStyle.isConnected) document.head.append(snippetStyle);
  }, [preference, resolvedTheme, activeTheme, appearance]);

  const value = useMemo<ThemeContextValue>(() => ({
    preference,
    resolvedTheme,
    activeThemeId: activeTheme?.id ?? null,
    appearanceRevision,
    setPreference(next) {
      if (appearance.activeThemeId) saveAppearance({ ...appearance, activeThemeId: null });
      sessionPreference = next;
      try { window.localStorage.setItem(THEME_STORAGE_KEY, next); }
      catch { /* Browser storage may be disabled; retain this page's selection. */ }
      document.documentElement.dataset.theme = resolveTheme(next, getSystemDark());
      window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
    },
    activateTheme(id) {
      if (!appearance.themes.some((theme) => theme.id === id)) throw new Error('Theme is not installed');
      saveAppearance({ ...appearance, activeThemeId: id });
    },
  }), [preference, resolvedTheme, activeTheme, appearance, appearanceRevision]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
}
