'use client';

import { useState } from 'react';
import { isTemplateNote, validatePeriodRule, type PeriodKind, type PeriodNoteRule } from '@noor-note/core';
import type { useVaultWorkspace } from '../hooks/useVaultWorkspace';
import styles from './PeriodNotesSettings.module.css';

const kinds: { id: PeriodKind; label: string }[] = [
  { id: 'daily', label: 'Daily' }, { id: 'weekly', label: 'Weekly' }, { id: 'monthly', label: 'Monthly' },
  { id: 'quarterly', label: 'Quarterly' }, { id: 'yearly', label: 'Yearly' },
];

export function PeriodNotesSettings({ workspace }: { workspace: ReturnType<typeof useVaultWorkspace> }) {
  const vault = workspace.activeVault;
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Partial<Record<PeriodKind, Partial<PeriodNoteRule>>>>({});
  if (!vault) return null;
  const templateFolderId = vault.settings.templates.folderId;
  const templates = workspace.notes.filter((note) => isTemplateNote(note, workspace.folders, templateFolderId));
  const save = async (kind: PeriodKind, patch: Partial<PeriodNoteRule>): Promise<boolean> => {
    try {
      const next = validatePeriodRule(kind, { ...vault.settings.periodNotes[kind], ...patch });
      if (next.folderId && !workspace.folders.some((folder) => folder.id === next.folderId)) throw new Error('Choose an existing destination folder.');
      if (next.templateId && !templates.some((note) => note.id === next.templateId)) throw new Error('Choose a note from the template folder.');
      setBusy(true);
      const result = await workspace.updateVaultSettings({ periodNotes: { ...vault.settings.periodNotes, [kind]: next } });
      setMessage(result ? `${kind[0]!.toUpperCase()}${kind.slice(1)} note settings saved locally.` : 'Could not save period note settings.');
      if (result) setDrafts((current) => ({ ...current, [kind]: undefined }));
      return Boolean(result);
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : 'Could not save period note settings.'); return false; }
    finally { setBusy(false); }
  };
  const edit = (kind: PeriodKind, patch: Partial<PeriodNoteRule>) => setDrafts((current) => ({ ...current, [kind]: { ...current[kind], ...patch } }));
  return <section className={styles.section} aria-labelledby="period-settings-heading">
    <h2 id="period-settings-heading">Daily and periodic notes</h2>
    <p>Choose a folder, filename pattern, display date, and optional template for each period. Auto-create makes only the period you open or navigate to.</p>
    {message && <p role="status" className={styles.message}>{message}</p>}
    <div className={styles.grid}>{kinds.map(({ id, label }) => {
      const rule = vault.settings.periodNotes[id];
      return <fieldset key={id} disabled={busy} className={styles.card}><legend>{label}</legend>
        <label>Folder<select value={(drafts[id]?.folderId === undefined ? rule.folderId : drafts[id]?.folderId) ?? ''} onChange={(event) => edit(id, { folderId: event.target.value || null })}><option value="">Vault root</option>{workspace.folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.path}</option>)}</select></label>
        <label>Filename format<input value={drafts[id]?.filenameFormat ?? rule.filenameFormat} maxLength={80} onChange={(event) => edit(id, { filenameFormat: event.target.value })} aria-describedby="period-format-help" /></label>
        <label>Display date format<input value={drafts[id]?.dateFormat ?? rule.dateFormat} maxLength={80} onChange={(event) => edit(id, { dateFormat: event.target.value })} aria-describedby="period-format-help" /></label>
        <label>Template<select value={(drafts[id]?.templateId === undefined ? rule.templateId : drafts[id]?.templateId) ?? ''} onChange={(event) => edit(id, { templateId: event.target.value || null })}><option value="">{id === 'daily' && vault.settings.templates.dailyTemplateId ? 'Use daily template setting' : 'Use default template'}</option>{templates.map((note) => <option key={note.id} value={note.id}>{note.path}</option>)}</select></label>
        <label className={styles.check}><input type="checkbox" checked={drafts[id]?.autoCreate ?? rule.autoCreate} onChange={(event) => edit(id, { autoCreate: event.target.checked })} /> Auto-create when opened</label>
        <button type="button" disabled={!drafts[id] || busy} onClick={() => { void save(id, drafts[id] ?? {}); }}>Save {label.toLowerCase()} settings</button>
      </fieldset>;
    })}</div>
    <p id="period-format-help" className={styles.help}>Tokens: yyyy, MM, dd, GGGG (ISO week year), WW (ISO week), Q (quarter), MMMM, EEEE. Put literal letters in brackets, such as [W].</p>
  </section>;
}
