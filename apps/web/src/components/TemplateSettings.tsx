'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { baseSchema, isTemplateNote, validateTemplateSettings, type Base, type TemplateSettings } from '@noor-note/core';
import type { useVaultWorkspace } from '../hooks/useVaultWorkspace';
import styles from './TemplateSettings.module.css';

interface Props { workspace: ReturnType<typeof useVaultWorkspace>; onOpenNote: (id: string) => void; onPreview: (id: string) => void }

export function TemplateSettings({ workspace, onOpenNote, onPreview }: Props) {
  const vault = workspace.activeVault;
  const vaultId = vault?.id;
  const repository = workspace.repository;
  const settings = vault?.settings.templates;
  const [bases, setBases] = useState<Base[]>([]);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!vaultId || !repository) return;
    let live = true;
    void repository.listObjects('base', vaultId).then((items) => { if (live) setBases(items.flatMap((item) => { const parsed = baseSchema.safeParse(item); return parsed.success && !parsed.data.deletedAt ? [parsed.data] : []; })); }).catch(() => { if (live) setMessage('Could not load Bases for template rules.'); });
    return () => { live = false; };
  }, [vaultId, repository]);
  if (!vault || !settings) return null;
  const templates = workspace.notes.filter((note) => isTemplateNote(note, workspace.folders, settings.folderId)).sort((a, b) => a.path.localeCompare(b.path));
  const choices = (value: string | null) => <><option value="">None</option>{templates.map((note) => <option key={note.id} value={note.id}>{note.path}</option>)}{value && !templates.some((note) => note.id === value) && <option value={value} disabled>Missing template</option>}</>;
  const save = async (next: TemplateSettings) => {
    try {
      const checked = validateTemplateSettings(next, workspace.notes, workspace.folders, bases.map((base) => base.id));
      setBusy(true);
      const saved = await workspace.updateVaultSettings({ templates: checked });
      setMessage(saved ? 'Template settings saved locally.' : 'Could not save template settings.');
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : 'Could not save template settings.'); }
    finally { setBusy(false); }
  };
  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      let folderId = settings.folderId;
      if (!folderId) {
        const existing = workspace.folders.find((folder) => folder.parentId === null && folder.name.toLocaleLowerCase() === 'templates');
        const folder = existing ?? await workspace.createFolder(null, 'Templates');
        if (!folder) throw new Error('Could not create the template folder.');
        folderId = folder.id;
        if (!await workspace.updateVaultSettings({ templates: { ...settings, folderId } })) throw new Error('Could not configure the template folder.');
      }
      const created = await workspace.addNote(folderId, { title: title.trim(), skipTemplate: true });
      if (!created) throw new Error('Could not create the template note.');
      setTitle(''); setMessage(null); onOpenNote(created.id);
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : 'Could not create template.'); }
    finally { setBusy(false); }
  };
  return <section className={styles.section} aria-labelledby="template-heading">
    <h2 id="template-heading">Templates</h2><p>Template sources are ordinary Markdown notes in one vault folder. Edit them in the note editor and export them with your vault.</p>
    {message && <p role="status" className={styles.message}>{message}</p>}
    <div className={styles.fields}>
      <label>Template folder<select value={settings.folderId ?? ''} disabled={busy} onChange={(event) => { void save({ ...settings, folderId: event.target.value || null, defaultTemplateId: null, dailyTemplateId: null, folderTemplates: {}, baseTemplates: {} }); }}><option value="">Choose a folder</option>{workspace.folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.path}</option>)}</select></label>
      <label>Default template<select value={settings.defaultTemplateId ?? ''} disabled={busy || !settings.folderId} onChange={(event) => { void save({ ...settings, defaultTemplateId: event.target.value || null }); }}>{choices(settings.defaultTemplateId)}</select></label>
      <label>Daily note template<select value={settings.dailyTemplateId ?? ''} disabled={busy || !settings.folderId} onChange={(event) => { void save({ ...settings, dailyTemplateId: event.target.value || null }); }}>{choices(settings.dailyTemplateId)}</select></label>
    </div>
    <form className={styles.create} onSubmit={(event) => { void create(event); }}><label>New template note<input required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Template name" /></label><button type="submit" disabled={busy}>Create template</button></form>
    {templates.length > 0 && <div className={styles.noteList}><h3>Template notes</h3>{templates.map((note) => <div key={note.id}><span>{note.path}</span><button type="button" onClick={() => onOpenNote(note.id)}>Edit</button><button type="button" onClick={() => onPreview(note.id)}>Preview</button></div>)}</div>}
    {settings.folderId && <><h3>Folder templates</h3><div className={styles.rules}>{workspace.folders.filter((folder) => folder.id !== settings.folderId && !isTemplateNote({ id: '', folderId: folder.id }, workspace.folders, settings.folderId)).map((folder) => <label key={folder.id}>{folder.path}<select disabled={busy} value={settings.folderTemplates[folder.id] ?? ''} onChange={(event) => { const next = { ...settings.folderTemplates }; if (event.target.value) next[folder.id] = event.target.value; else delete next[folder.id]; void save({ ...settings, folderTemplates: next }); }}>{choices(settings.folderTemplates[folder.id] ?? null)}</select></label>)}</div>
      <h3>Base templates</h3>{bases.length ? <div className={styles.rules}>{bases.map((base) => <label key={base.id}>{base.title}<select disabled={busy} value={settings.baseTemplates[base.id] ?? ''} onChange={(event) => { const next = { ...settings.baseTemplates }; if (event.target.value) next[base.id] = event.target.value; else delete next[base.id]; void save({ ...settings, baseTemplates: next }); }}>{choices(settings.baseTemplates[base.id] ?? null)}</select></label>)}</div> : <p>No Bases in this vault.</p>}</>}
  </section>;
}
