'use client';

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { parseThemePreference, resolveTheme, THEME_CHANGE_EVENT, THEME_STORAGE_KEY, type ResolvedTheme, type ThemePreference } from './theme';

interface ThemeContextValue {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
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
  const resolvedTheme = resolveTheme(preference, prefersDark);

  useEffect(() => {
    if (preference === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.dataset.theme = preference;
  }, [preference]);

  const value = useMemo<ThemeContextValue>(() => ({
    preference,
    resolvedTheme,
    setPreference(next) {
      sessionPreference = next;
      try { window.localStorage.setItem(THEME_STORAGE_KEY, next); }
      catch { /* Browser storage may be disabled; retain this page's selection. */ }
      if (next === 'system') document.documentElement.removeAttribute('data-theme');
      else document.documentElement.dataset.theme = next;
      window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
    },
  }), [preference, resolvedTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
}
