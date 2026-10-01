'use client';

import { useState, useSyncExternalStore, type ChangeEvent } from 'react';
import { ZodError } from 'zod';
import { useTheme } from '../theme/ThemeProvider';
import { compileCssSnippet, getAppearanceSnapshot, getServerAppearance, parseThemePackage, saveAppearance, subscribeAppearance, type NoorThemePackage } from '../theme/appearance';
import { parseThemePreference } from '../theme/theme';
import styles from './ThemeManager.module.css';

export function ThemeManager() {
  const { preference, activeThemeId, setPreference, activateTheme } = useTheme();
  const appearance = useSyncExternalStore(subscribeAppearance, getAppearanceSnapshot, getServerAppearance);
  const [candidate, setCandidate] = useState<NoorThemePackage | null>(null);
  const [snippetName, setSnippetName] = useState('');
  const [snippetSource, setSnippetSource] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const report = (error: unknown, fallback: string) => setMessage({ text: error instanceof ZodError ? error.issues[0]?.message ?? fallback : error instanceof Error ? error.message : fallback, error: true });
  const run = (action: () => void, success: string) => {
    try { action(); setMessage({ text: success, error: false }); }
    catch (error) { report(error, 'Could not update appearance'); }
  };
  const loadTheme = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      if (file.size > 50_000) throw new Error('Theme file exceeds 50 KB');
      let input: unknown;
      try { input = JSON.parse(await file.text()); } catch { throw new Error('Theme file is not valid JSON'); }
      setCandidate(parseThemePackage(input)); setMessage(null);
    } catch (error) { setCandidate(null); report(error, 'Could not read theme'); }
    finally { setBusy(false); }
  };
  const install = () => {
    if (!candidate) return;
    const existing = appearance.themes.some((theme) => theme.id === candidate.id);
    if (existing && !window.confirm(`Replace the installed ${candidate.name} theme?`)) return;
    run(() => {
      saveAppearance({ ...appearance, themes: [...appearance.themes.filter((theme) => theme.id !== candidate.id), candidate] });
      setCandidate(null);
    }, `${candidate.name} installed locally.`);
  };
  const removeTheme = (theme: NoorThemePackage) => {
    if (!window.confirm(`Remove ${theme.name} from this browser?`)) return;
    run(() => saveAppearance({ ...appearance, themes: appearance.themes.filter((item) => item.id !== theme.id), activeThemeId: appearance.activeThemeId === theme.id ? null : appearance.activeThemeId }), 'Theme removed.');
  };
  const saveSnippet = () => {
    run(() => {
      const name = snippetName.trim();
      if (!name || name.length > 80) throw new Error('Give the snippet a name of up to 80 characters');
      compileCssSnippet(snippetSource);
      const snippet = { id: editingId ?? crypto.randomUUID(), name, source: snippetSource, enabled: appearance.snippets.find((item) => item.id === editingId)?.enabled ?? true };
      saveAppearance({ ...appearance, snippets: [...appearance.snippets.filter((item) => item.id !== editingId), snippet] });
      setSnippetName(''); setSnippetSource(''); setEditingId(null);
    }, editingId ? 'CSS snippet saved.' : 'CSS snippet saved and enabled.');
  };
  const removeSnippet = (id: string) => {
    if (!window.confirm('Remove this CSS snippet?')) return;
    run(() => saveAppearance({ ...appearance, snippets: appearance.snippets.filter((item) => item.id !== id) }), 'CSS snippet removed.');
  };

  return <section className={styles.card} aria-labelledby="appearance-heading">
    <div className={styles.heading}><h2 id="appearance-heading">Appearance</h2><p>Choose a built-in theme or install a local color theme.</p></div>
    <label className={styles.select}>Built-in theme <select value={activeThemeId ? 'custom' : preference} onChange={(event) => { if (event.target.value !== 'custom') run(() => setPreference(parseThemePreference(event.target.value)), 'Theme selected.'); }}><option value="light">Light</option><option value="dark">Dark</option><option value="system">System</option>{activeThemeId && <option value="custom">Custom theme active</option>}</select></label>
    <div className={styles.group}><h3>Local themes</h3><label className={styles.file}>Install local theme JSON <input type="file" accept=".json,.noor-theme.json,application/json" onChange={(event) => { void loadTheme(event); }} disabled={busy} /></label>
      {candidate && <div className={styles.review}><strong>{candidate.name} <small>{candidate.version}</small></strong><p>By {candidate.author} · ID {candidate.id} · {candidate.base} base · {Object.keys(candidate.tokens).length} color tokens</p><div className={styles.swatches}><span style={{ background: candidate.tokens['--nn-bg'] }} /><span style={{ background: candidate.tokens['--nn-surface'] }} /><span style={{ background: candidate.tokens['--nn-accent'] }} /><span style={{ background: candidate.tokens['--nn-text'] }} /></div><div className={styles.actions}><button type="button" onClick={install}>Install theme</button><button type="button" onClick={() => setCandidate(null)}>Cancel</button></div></div>}
      {appearance.themes.length === 0 ? <p>No local themes installed.</p> : <div className={styles.items}>{appearance.themes.map((theme) => <div className={styles.item} key={theme.id}><div><strong>{theme.name}</strong> <small>{theme.version} · {theme.base}</small><p>{theme.author} · {theme.id}</p></div><div className={styles.actions}><button type="button" onClick={() => run(() => activeThemeId === theme.id ? saveAppearance({ ...appearance, activeThemeId: null }) : activateTheme(theme.id), activeThemeId === theme.id ? 'Theme disabled.' : 'Theme enabled.')}>{activeThemeId === theme.id ? 'Disable' : 'Enable'}</button><button type="button" onClick={() => removeTheme(theme)}>Remove</button></div></div>)}</div>}
    </div>
    <div className={styles.group}><h3>CSS snippets</h3><p>Snippets support approved selectors, color tokens, and typography declarations. They cannot load remote assets or change layout and interaction rules.</p><div className={styles.snippetForm}><label>Snippet name<input value={snippetName} maxLength={80} onChange={(event) => setSnippetName(event.target.value)} /></label><label>CSS<textarea value={snippetSource} rows={5} maxLength={10_000} spellCheck={false} placeholder={':root { --nn-accent: #6a4b9a; }\n.cm-content { font-size: 16px; }'} onChange={(event) => setSnippetSource(event.target.value)} /></label><div className={styles.actions}><button type="button" onClick={saveSnippet}>{editingId ? 'Save changes' : 'Add snippet'}</button>{editingId && <button type="button" onClick={() => { setEditingId(null); setSnippetName(''); setSnippetSource(''); }}>Cancel edit</button>}</div></div>
      {appearance.snippets.length > 0 && <div className={styles.items}>{appearance.snippets.map((snippet) => <div className={styles.item} key={snippet.id}><div><strong>{snippet.name}</strong><p>{snippet.enabled ? 'Enabled' : 'Disabled'}</p></div><div className={styles.actions}><button type="button" onClick={() => run(() => saveAppearance({ ...appearance, snippets: appearance.snippets.map((item) => item.id === snippet.id ? { ...item, enabled: !item.enabled } : item) }), snippet.enabled ? 'Snippet disabled.' : 'Snippet enabled.')}>{snippet.enabled ? 'Disable' : 'Enable'}</button><button type="button" onClick={() => { setEditingId(snippet.id); setSnippetName(snippet.name); setSnippetSource(snippet.source); }}>Edit</button><button type="button" onClick={() => removeSnippet(snippet.id)}>Remove</button></div></div>)}</div>}
    </div>
    {message && <p className={message.error ? styles.error : styles.message} role={message.error ? 'alert' : 'status'}>{message.text}</p>}
  </section>;
}
