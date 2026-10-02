'use client';

import { useEffect, useState } from 'react';
import { defaultEditorPreferences, type EditorPreferences } from '../lib/editor-preferences';
import { readDeviceSettings, writeDeviceSettings } from '../lib/settings-system';

export { parseEditorPreferences } from '../lib/settings-system';

export function useEditorPreferences() {
  const [preferences, setPreferences] = useState<EditorPreferences>(defaultEditorPreferences);
  const [loaded, setLoaded] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [persistenceWarning, setPersistenceWarning] = useState<string | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const settings = readDeviceSettings(localStorage);
        if (settings) setPreferences(settings.editor);
        else { setReadOnly(true); setPersistenceWarning('Editor preferences from a newer or damaged version could not be loaded. Changes in this session will not overwrite them.'); }
      }
      catch { setPersistenceWarning('Editor preferences cannot be read from browser storage. Changes may not persist.'); }
      setLoaded(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!loaded || readOnly) return;
    let warningTimer: number | undefined;
    try { writeDeviceSettings(localStorage, { version: 1, editor: preferences }); }
    catch { warningTimer = window.setTimeout(() => setPersistenceWarning('Editor preferences could not be saved in browser storage. Changes remain active only in this session.'), 0); }
    return () => { if (warningTimer !== undefined) window.clearTimeout(warningTimer); };
  }, [loaded, preferences, readOnly]);
  return { preferences, setPreferences, persistenceWarning };
}
