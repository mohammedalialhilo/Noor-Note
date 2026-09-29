'use client';

import type { CommandDefinition } from '../lib/commands';
import { effectiveShortcut, shortcutFromEvent, type ShortcutOverrides } from '../lib/shortcuts';
import { useState } from 'react';
import styles from './KeyboardShortcuts.module.css';

interface Props {
  commands: CommandDefinition[];
  overrides: ShortcutOverrides;
  onChange: (id: string, shortcut: string | null | undefined) => string | null;
}
export function KeyboardShortcuts({ commands, overrides, onChange }: Props) {
  const [query, setQuery] = useState('');
  const [capturing, setCapturing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const filtered = commands.filter((command) => `${command.name} ${command.category} ${command.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const update = (id: string, shortcut: string | null | undefined) => { const issue = onChange(id, shortcut); setError(issue); if (!issue) setCapturing(null); };
  return <section className={styles.card} aria-labelledby="keyboard-heading">
    <div className={styles.heading}><h2 id="keyboard-heading">Keyboard shortcuts</h2><p>Search commands, change a shortcut, or remove one. Changes stay in this browser.</p></div>
    <input className={styles.search} type="search" aria-label="Search commands" placeholder="Search commands" value={query} onChange={(event) => setQuery(event.target.value)} />
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.list}>{filtered.map((command) => <div className={styles.row} key={command.id}>
      <div className={styles.name}><strong>{command.name}</strong><small>{command.category}</small></div>
      {capturing === command.id ? <input autoFocus className={styles.capture} aria-label={`Press shortcut for ${command.name}`} placeholder="Press shortcut…" readOnly onKeyDown={(event) => {
        event.preventDefault(); event.stopPropagation();
        if (event.key === 'Escape') { setCapturing(null); setError(null); return; }
        const shortcut = shortcutFromEvent(event.nativeEvent);
        if (!shortcut) { setError('Press a modifier and a supported key.'); return; }
        update(command.id, shortcut);
      }} /> : <kbd>{effectiveShortcut(command, overrides) ?? 'None'}</kbd>}
      <div className={styles.actions}><button type="button" onClick={() => { setCapturing(command.id); setError(null); }}>Change</button><button type="button" disabled={effectiveShortcut(command, overrides) === null} onClick={() => update(command.id, null)}>Remove</button><button type="button" disabled={!Object.hasOwn(overrides, command.id)} onClick={() => update(command.id, undefined)}>Reset</button></div>
    </div>)}{filtered.length === 0 && <p className={styles.empty}>No commands match.</p>}</div>
  </section>;
}
