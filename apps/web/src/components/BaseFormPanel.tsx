'use client';

import { useState, type FormEvent } from 'react';
import { baseFormFieldKindSchema, baseFormSchema, newBaseFormField, validateBaseForm, type BaseForm, type BaseFormField, type BaseFormFieldKind } from '@noor-note/core';
import type { NoteEntry } from '@noor-note/storage';
import type { useVaultWorkspace } from '../hooks/useVaultWorkspace';
import styles from './BaseFormPanel.module.css';

interface Props {
  form: BaseForm;
  workspace: ReturnType<typeof useVaultWorkspace>;
  readOnly: boolean;
  onSave: (form: BaseForm) => Promise<boolean>;
  onSubmit: (values: Record<string, unknown>, files: Record<string, File[]>) => Promise<boolean>;
}
const kindNames: Record<BaseFormFieldKind, string> = { text: 'Text', textarea: 'Long text', number: 'Number', date: 'Date', datetime: 'Date and time', select: 'Select', multiSelect: 'Multiple select', checkbox: 'Checkbox', tags: 'Tags', noteReference: 'Note reference', url: 'URL', email: 'Email', fileAttachment: 'File attachment' };
const supportsPattern = (kind: BaseFormFieldKind) => ['text', 'textarea', 'email', 'url'].includes(kind);
const supportsBounds = (kind: BaseFormFieldKind) => !['checkbox', 'select', 'noteReference', 'email', 'url'].includes(kind);
const isChoice = (kind: BaseFormFieldKind) => kind === 'select' || kind === 'multiSelect';

export function BaseFormPanel({ form, workspace, readOnly, onSave, onSubmit }: Props) {
  const [mode, setMode] = useState<'fill' | 'configure'>('fill');
  const [draft, setDraft] = useState(form);
  const [defaultsText, setDefaultsText] = useState(JSON.stringify(form.defaultProperties, null, 2));
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [files, setFiles] = useState<Record<string, File[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const templateFolderId = workspace.activeVault?.settings.templates.folderId ?? null;
  const templates = workspace.notes.filter((note) => {
    if (!templateFolderId || !note.folderId) return false;
    let parent: string | null = note.folderId;
    const seen = new Set<string>();
    while (parent && !seen.has(parent)) { if (parent === templateFolderId) return true; seen.add(parent); parent = workspace.folders.find((item) => item.id === parent)?.parentId ?? null; }
    return false;
  });
  const patch = (change: Partial<BaseForm>) => setDraft((current) => ({ ...current, ...change }));
  const patchField = (id: string, change: Partial<BaseFormField>) => patch({ fields: draft.fields.map((field) => field.id === id ? { ...field, ...change } : field) });
  const configure = async (event: FormEvent) => {
    event.preventDefault(); setError(null); setStatus(null);
    try {
      const defaults: unknown = JSON.parse(defaultsText);
      const parsed = baseFormSchema.parse({ ...draft, defaultProperties: defaults });
      setBusy(true);
      if (await onSave(parsed)) { setDraft(parsed); setStatus('Form configuration saved.'); setMode('fill'); }
      else setError('Could not save the form configuration.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Check form configuration.'); }
    finally { setBusy(false); }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(null); setStatus(null);
    try {
      const submitted = { ...values };
      for (const field of form.fields) {
        if (field.kind === 'fileAttachment') submitted[field.id] = (files[field.id] ?? []).map((file) => file.name);
        if (field.kind === 'tags' && typeof submitted[field.id] === 'string') submitted[field.id] = (submitted[field.id] as string).split(',').map((tag) => tag.trim()).filter(Boolean);
      }
      validateBaseForm(form, submitted, workspace.notes);
      setBusy(true);
      if (await onSubmit(submitted, files)) { setValues({}); setFiles({}); setStatus('Note created from form.'); }
      else setError('Could not create the note.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Check the form answers.'); }
    finally { setBusy(false); }
  };
  const setValue = (field: BaseFormField, value: unknown) => setValues((current) => ({ ...current, [field.id]: value }));
  const renderField = (field: BaseFormField) => {
    const id = `base-form-${field.id}`, value = values[field.id];
    if (field.kind === 'checkbox') return <label key={id} className={styles.checkbox}><input id={id} type="checkbox" checked={value === true} onChange={(event) => setValue(field, event.target.checked)} />{field.label}{field.required && ' *'}</label>;
    if (field.kind === 'fileAttachment') return <label key={id}>{field.label}{field.required && ' *'}<input id={id} type="file" multiple required={field.required} onChange={(event) => setFiles((current) => ({ ...current, [field.id]: Array.from(event.target.files ?? []) }))} /><small>Up to 100 MiB per file. Files are saved beside the note.</small></label>;
    if (field.kind === 'textarea') return <label key={id}>{field.label}{field.required && ' *'}<textarea id={id} required={field.required} minLength={field.minimum === null ? undefined : Number(field.minimum)} maxLength={field.maximum === null ? undefined : Number(field.maximum)} value={typeof value === 'string' ? value : ''} onChange={(event) => setValue(field, event.target.value)} rows={5} /></label>;
    if (field.kind === 'select' || field.kind === 'noteReference') return <label key={id}>{field.label}{field.required && ' *'}<select id={id} required={field.required} value={typeof value === 'string' ? value : ''} onChange={(event) => setValue(field, event.target.value)}><option value="">Choose…</option>{field.kind === 'select' ? field.options.map((option) => <option key={option} value={option}>{option}</option>) : workspace.notes.map((note: NoteEntry) => <option key={note.id} value={note.id}>{note.title} · {note.path}</option>)}</select></label>;
    if (field.kind === 'multiSelect') return <fieldset key={id}><legend>{field.label}{field.required && ' *'}</legend><div className={styles.choices}>{field.options.map((option) => <label key={option} className={styles.checkbox}><input type="checkbox" checked={Array.isArray(value) && value.includes(option)} onChange={(event) => { const selected = Array.isArray(value) ? value as string[] : []; setValue(field, event.target.checked ? [...selected, option] : selected.filter((item) => item !== option)); }} />{option}</label>)}</div></fieldset>;
    const type = field.kind === 'number' ? 'number' : field.kind === 'date' ? 'date' : field.kind === 'datetime' ? 'datetime-local' : field.kind === 'email' ? 'email' : field.kind === 'url' ? 'url' : 'text';
    return <label key={id}>{field.label}{field.required && ' *'}<input id={id} type={type} required={field.required} value={typeof value === 'string' || typeof value === 'number' ? value : ''} min={['number', 'date', 'datetime'].includes(field.kind) ? field.minimum ?? undefined : undefined} max={['number', 'date', 'datetime'].includes(field.kind) ? field.maximum ?? undefined : undefined} minLength={['text'].includes(field.kind) && field.minimum !== null ? Number(field.minimum) : undefined} maxLength={['text'].includes(field.kind) && field.maximum !== null ? Number(field.maximum) : undefined} onChange={(event) => setValue(field, event.target.value)} placeholder={field.kind === 'tags' ? 'research, project/alpha' : undefined} /></label>;
  };
  return <section className={styles.panel} aria-label="Base form">
    <div className={styles.heading}><div><h2>Form</h2><p>Responses become Markdown notes in this vault.</p></div><div role="group" aria-label="Form mode"><button type="button" aria-pressed={mode === 'fill'} onClick={() => setMode('fill')}>Fill form</button><button type="button" aria-pressed={mode === 'configure'} onClick={() => setMode('configure')}>Configure</button></div></div>
    {error && <p className={styles.error} role="alert">{error}</p>}{status && <p role="status">{status}</p>}
    {mode === 'fill' ? <form className={styles.form} onSubmit={(event) => { void submit(event); }}>{form.fields.length ? form.fields.map(renderField) : <p>Add fields in Configure to start collecting responses.</p>}<button type="submit" disabled={readOnly || busy || !form.fields.length}>{busy ? 'Creating…' : 'Create note'}</button></form> : <form className={styles.form} onSubmit={(event) => { void configure(event); }}>
      <div className={styles.twoColumns}><label>Target folder<select value={draft.targetFolderId ?? ''} onChange={(event) => patch({ targetFolderId: event.target.value || null })}><option value="">Vault root</option>{workspace.folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.path}</option>)}</select></label><label>Note template<select value={draft.noteTemplateId ?? ''} onChange={(event) => patch({ noteTemplateId: event.target.value || null })}><option value="">Default heading</option>{templates.map((note) => <option key={note.id} value={note.id}>{note.title}</option>)}</select></label></div>
      <label>Filename template<input value={draft.filenameTemplate} maxLength={200} onChange={(event) => patch({ filenameTemplate: event.target.value })} /><small>Use template variables such as {'{{title}}'}, {'{{date}}'}, and {'{{property("status")}}'}.</small></label>
      <label>Default properties (JSON object)<textarea rows={4} spellCheck={false} value={defaultsText} onChange={(event) => setDefaultsText(event.target.value)} /><small>Example: {'{"status":"Inbox","priority":2}'}</small></label>
      <div className={styles.fieldsHeading}><h3>Fields</h3><button type="button" disabled={readOnly || draft.fields.length >= 50} onClick={() => { const keys = new Set(draft.fields.map((field) => field.key)); let index = draft.fields.length + 1; while (keys.has(`field_${index}`)) index++; patch({ fields: [...draft.fields, newBaseFormField('text', `field_${index}`)] }); }}>Add field</button></div>
      {draft.fields.map((field, index) => <fieldset key={field.id} className={styles.fieldConfig}><legend>Field {index + 1}</legend><div className={styles.twoColumns}><label>Label<input value={field.label} onChange={(event) => patchField(field.id, { label: event.target.value })} /></label><label>Property key<input value={field.key} onChange={(event) => patchField(field.id, { key: event.target.value })} /></label><label>Type<select value={field.kind} onChange={(event) => { const kind = baseFormFieldKindSchema.parse(event.target.value); patchField(field.id, { kind, options: isChoice(kind) ? field.options.length ? field.options : ['Option 1'] : [], pattern: supportsPattern(kind) ? field.pattern : null, minimum: supportsBounds(kind) ? field.minimum : null, maximum: supportsBounds(kind) ? field.maximum : null }); }}>{baseFormFieldKindSchema.options.map((kind) => <option key={kind} value={kind}>{kindNames[kind]}</option>)}</select></label><label className={styles.checkbox}><input type="checkbox" checked={field.required} onChange={(event) => patchField(field.id, { required: event.target.checked })} />Required</label></div>
        {supportsBounds(field.kind) && <div className={styles.twoColumns}><label>Minimum<input value={field.minimum ?? ''} onChange={(event) => patchField(field.id, { minimum: event.target.value || null })} placeholder={field.kind === 'date' ? 'YYYY-MM-DD' : field.kind === 'datetime' ? 'YYYY-MM-DDTHH:mm' : 'Length, count, or number'} /></label><label>Maximum<input value={field.maximum ?? ''} onChange={(event) => patchField(field.id, { maximum: event.target.value || null })} /></label></div>}
        {supportsPattern(field.kind) && <label>Safe regex pattern<input value={field.pattern ?? ''} onChange={(event) => patchField(field.id, { pattern: event.target.value || null })} placeholder="^[A-Z]{2}[0-9]{4}$" /><small>Anchored patterns with literals, character classes, and finite repeats.</small></label>}
        {isChoice(field.kind) && <label>Allowed options (one per line)<textarea rows={3} value={field.options.join('\n')} onChange={(event) => patchField(field.id, { options: event.target.value.split('\n').map((item) => item.trim()).filter(Boolean) })} /></label>}
        <button type="button" className={styles.remove} disabled={readOnly} onClick={() => patch({ fields: draft.fields.filter((item) => item.id !== field.id) })}>Remove field</button>
      </fieldset>)}
      <button type="submit" disabled={readOnly || busy}>{busy ? 'Saving…' : 'Save form'}</button>
    </form>}
  </section>;
}
