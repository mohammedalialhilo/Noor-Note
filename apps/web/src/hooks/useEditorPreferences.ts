'use client';

import { useEffect, useState } from 'react';
import { defaultEditorPreferences, type EditorPreferences } from '../components/MarkdownEditor';

const KEY = 'noor-note-editor-preferences';

export function parseEditorPreferences(value: unknown): EditorPreferences {
  if (typeof value !== 'object' || value === null) return defaultEditorPreferences;
  const record = value as Record<string, unknown>;
  const boolean = (key: keyof EditorPreferences) => typeof record[key] === 'boolean' ? record[key] as boolean : defaultEditorPreferences[key] as boolean;
  const number = (key: 'fontSize' | 'lineHeight', min: number, max: number) => typeof record[key] === 'number' && Number.isFinite(record[key]) ? Math.min(max, Math.max(min, record[key])) : defaultEditorPreferences[key];
  return {
    lineNumbers: boolean('lineNumbers'), spellcheck: boolean('spellcheck'), wordWrap: boolean('wordWrap'),
    focusMode: boolean('focusMode'), typewriterMode: boolean('typewriterMode'),
    fontFamily: record.fontFamily === 'serif' || record.fontFamily === 'mono' ? record.fontFamily : 'sans',
    fontSize: number('fontSize', 11, 28), lineHeight: number('lineHeight', 1.2, 2.5),
  };
}

export function useEditorPreferences() {
  const [preferences, setPreferences] = useState<EditorPreferences>(defaultEditorPreferences);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { const raw = localStorage.getItem(KEY); if (raw) setPreferences(parseEditorPreferences(JSON.parse(raw) as unknown)); }
      catch { /* Defaults remain usable when browser storage is unavailable. */ }
      setLoaded(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(KEY, JSON.stringify(preferences)); } catch { /* The current session still uses these settings. */ }
  }, [loaded, preferences]);
  return { preferences, setPreferences };
}
