'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Dialog } from '@noor-note/ui';
import { applyTemplateProperties, isTemplateNote, renderTemplate, safeFileStem, templateBody, templateContextForNote, type VaultNote } from '@noor-note/core';
import type { useVaultWorkspace } from '../hooks/useVaultWorkspace';
import styles from './TemplatePicker.module.css';

export type TemplateAction = 'insert' | 'create' | 'properties' | 'preview';
interface Props {
  action: TemplateAction | null; initialId?: string | null; workspace: ReturnType<typeof useVaultWorkspace>;
  note: VaultNote | null; selection: string; onInsert: (text: string) => void; onCreated: (id: string) => void; onClose: () => void; onSettings: () => void;
}

export function TemplatePicker({ action, initialId, workspace, note, selection, onInsert, onCreated, onClose, onSettings }: Props) {
  const settings = workspace.activeVault?.settings.templates;
  const templates = useMemo(() => workspace.notes.filter((item) => isTemplateNote(item, workspace.folders, settings?.folderId ?? null)).sort((a, b) => a.path.localeCompare(b.path)), [workspace.notes, workspace.folders, settings?.folderId]);
  const [templateId, setTemplateId] = useState('');
  const [source, setSource] = useState<{ id: string; markdown: string } | null>(null);
  const [title, setTitle] = useState('');
  const [folderId, setFolderId] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!action) return;
    const selected = initialId && templates.some((item) => item.id === initialId) ? initialId : templates[0]?.id ?? '';
    const candidateFolderId = note?.folderId ?? workspace.selectedFolderId;
    const destinationFolderId = candidateFolderId && isTemplateNote({ id: '', folderId: candidateFolderId }, workspace.folders, settings?.folderId ?? null) ? null : candidateFolderId;
    const timer = window.setTimeout(() => { setTemplateId(selected); setTitle(''); setFolderId(destinationFolderId); setClipboard(''); setError(null); }, 0);
    return () => window.clearTimeout(timer);
  }, [action, initialId, note?.folderId, workspace.selectedFolderId, workspace.folders, settings?.folderId, templates]);
  useEffect(() => {
    if (!templateId || !workspace.repository) return;
    let alive = true;
    void workspace.repository.getNote(templateId).then((item) => { if (alive) { setSource(item ? { id: templateId, markdown: item.markdown } : null); if (!item) setError('Template note is unavailable.'); } }).catch(() => { if (alive) setError('Could not load the template note.'); });
    return () => { alive = false; };
  }, [templateId, workspace.repository]);
  const folderPath = workspace.folders.find((folder) => folder.id === folderId)?.path ?? '/';
  const previewTitle = title.trim() || note?.title || 'Untitled note';
  const pathPrefix = folderPath === '/' ? '' : folderPath;
  const stem = safeFileStem(previewTitle);
  const occupied = new Set([...workspace.notes.map((item) => item.path), ...workspace.attachments.map((item) => item.path), ...workspace.folders.map((item) => item.path)].map((path) => path.toLocaleLowerCase()));
  let previewPath = `${pathPrefix}/${stem}.md`;
  if (action === 'create') for (let suffix = 2; occupied.has(previewPath.toLocaleLowerCase()); suffix++) previewPath = `${pathPrefix}/${stem} (${suffix}).md`;
  let rendered: string | null = null;
  let previewError: string | null = null;
  if (source?.id === templateId) {
    try {
      rendered = renderTemplate(source.markdown, note && action !== 'create' ? templateContextForNote(note, { selection, clipboard }) : {
        title: previewTitle, filename: previewPath.split('/').at(-1) ?? '', folder: folderPath, selection, clipboard, properties: {},
      });
      if (action === 'properties' && note) rendered = applyTemplateProperties(note.markdown, rendered);
    } catch (caught) { previewError = caught instanceof Error ? caught.message : 'Could not render template.'; }
  }
  const readClipboard = async () => {
    try { if (!navigator.clipboard?.readText) throw new Error('Clipboard access is unavailable in this browser.'); setClipboard(await navigator.clipboard.readText()); setError(null); }
    catch { setError('Could not read clipboard. Grant browser permission or continue with an empty clipboard variable.'); }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!action || !templateId || rendered === null) return;
    setBusy(true); setError(null);
    try {
      if (action === 'insert') { onInsert(templateBody(rendered)); onClose(); }
      else if (action === 'create') {
        if (!title.trim()) throw new Error('Enter a note title.');
        const created = await workspace.addNote(folderId, { title: title.trim(), templateId, selection, clipboard });
        if (!created) throw new Error('Could not create the note from this template.');
        onCreated(created.id); onClose();
      } else if (action === 'properties') {
        if (!note) throw new Error('Open a note to apply template properties.');
        const saved = await workspace.applyPropertiesFromTemplate(note.id, templateId, selection, clipboard);
        if (!saved) throw new Error('Could not apply template properties.');
        onClose();
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Template action failed.'); }
    finally { setBusy(false); }
  };
  const heading = action === 'insert' ? 'Insert template' : action === 'create' ? 'Create note from template' : action === 'properties' ? 'Apply template properties' : 'Preview template';
  return <Dialog open={action !== null} onOpenChange={(open) => { if (!open) onClose(); }} title={heading} description="Templates are Markdown notes stored in your vault." contentClassName={styles.dialog}>
    {!settings?.folderId || !templates.length ? <div className={styles.empty}><p>{settings?.folderId ? 'Add a Markdown note to your template folder first.' : 'Choose a template folder in Settings first.'}</p><button type="button" onClick={() => { onClose(); onSettings(); }}>Open template settings</button></div> : <form className={styles.form} onSubmit={(event) => { void submit(event); }}>
      <label>Template<select value={templateId} onChange={(event) => setTemplateId(event.target.value)}>{templates.map((item) => <option key={item.id} value={item.id}>{item.path}</option>)}</select></label>
      {(action === 'create' || action === 'preview' && !note) && <label>Note title for variables<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} required={action === 'create'} placeholder="New note title" /></label>}
      {action === 'create' && <label>Destination folder<select value={folderId ?? ''} onChange={(event) => setFolderId(event.target.value || null)}><option value="">Vault root</option>{workspace.folders.filter((folder) => !isTemplateNote({ id: '', folderId: folder.id }, workspace.folders, settings.folderId)).map((folder) => <option key={folder.id} value={folder.id}>{folder.path}</option>)}</select></label>}
      <div className={styles.clipboard}><span>{clipboard ? 'Clipboard text loaded' : 'Clipboard variable is empty'}</span><button type="button" onClick={() => { void readClipboard(); }}>Read clipboard</button></div>
      {(error || previewError) && <p role="alert" className={styles.error}>{error || previewError}</p>}
      <div className={styles.preview}><strong>{action === 'properties' ? 'Note after applying properties' : 'Rendered preview'}</strong><pre>{rendered === null ? 'Loading template…' : rendered}</pre></div>
      <div className={styles.actions}><button type="button" onClick={onClose}>Close</button>{action !== 'preview' && <button type="submit" disabled={busy || rendered === null || Boolean(previewError)}>{busy ? 'Working…' : heading}</button>}</div>
    </form>}
  </Dialog>;
}
