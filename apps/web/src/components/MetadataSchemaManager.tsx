'use client';

import { formatPropertyInput, metadataSchemaSchema, parsePropertyInput, propertyTypeSchema, type Folder, type MetadataSchema, type PropertyType } from '@noor-note/core';
import type { VaultRepository } from '@noor-note/storage';
import { Button, Dialog } from '@noor-note/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import styles from './MetadataSchemaManager.module.css';

interface Props {
  vaultId: string;
  folders: Folder[];
  repository: VaultRepository | null;
  onPut: (schema: MetadataSchema) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
}
type FieldDraft = { name: string; type: PropertyType; options: string; defaultText: string };
const blankField = (): FieldDraft => ({ name: '', type: 'text', options: '', defaultText: '' });

export function MetadataSchemaManager({ vaultId, folders, repository, onPut, onDelete }: Props) {
  const [schemas, setSchemas] = useState<MetadataSchema[]>([]);
  const [editing, setEditing] = useState<MetadataSchema | 'new' | null>(null);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<MetadataSchema['scope']>('folder');
  const [selector, setSelector] = useState('');
  const [fields, setFields] = useState<FieldDraft[]>([blankField()]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!repository) return;
    let live = true;
    void repository.listObjects('metadataSchema', vaultId).then((items) => {
      if (live) setSchemas(items.flatMap((item) => { const parsed = metadataSchemaSchema.safeParse(item); return parsed.success ? [parsed.data] : []; }));
    }).catch(() => { if (live) setError('Could not load metadata schemas.'); });
    return () => { live = false; };
  }, [repository, vaultId]);
  const reload = async () => {
    if (!repository) return;
    const items = await repository.listObjects('metadataSchema', vaultId);
    setSchemas(items.flatMap((item) => { const parsed = metadataSchemaSchema.safeParse(item); return parsed.success ? [parsed.data] : []; }));
  };
  const open = (schema: MetadataSchema | 'new') => {
    setEditing(schema);
    setName(schema === 'new' ? '' : schema.name);
    setScope(schema === 'new' ? 'folder' : schema.scope);
    setSelector(schema === 'new' ? folders[0]?.id ?? '' : schema.selector);
    setFields(schema === 'new' ? [blankField()] : schema.fields.map((field) => ({ name: field.name, type: field.type, options: field.options.join(', '), defaultText: field.defaultValue === undefined ? '' : formatPropertyInput(field.defaultValue) })));
    setError(null);
  };
  const updateField = (index: number, patch: Partial<FieldDraft>) => setFields((current) => current.map((field, position) => position === index ? { ...field, ...patch } : field));
  const save = async () => {
    if (!editing) return;
    try {
      if (!selector.trim()) throw new Error('Choose a folder or enter a matching value');
      const names = fields.map((field) => field.name.trim().toLocaleLowerCase());
      if (new Set(names).size !== names.length) throw new Error('Property names must be unique within a schema');
      const parsedFields = fields.map((field) => {
        const options = field.options.split(',').map((item) => item.trim()).filter(Boolean);
        return { name: field.name.trim(), type: field.type, options, ...(field.defaultText.trim() ? { defaultValue: parsePropertyInput(field.type, field.defaultText, options) } : {}) };
      });
      const time = new Date().toISOString();
      const schema = metadataSchemaSchema.parse({ id: editing === 'new' ? crypto.randomUUID() : editing.id, vaultId, name, scope, selector: selector.trim(), fields: parsedFields, createdAt: editing === 'new' ? time : editing.createdAt, updatedAt: time });
      setSaving(true);
      const result = await onPut(schema);
      if (!result) throw new Error('Could not save the schema');
      await reload(); setEditing(null); setError(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save the schema'); }
    finally { setSaving(false); }
  };
  const remove = async (schema: MetadataSchema) => {
    try { await onDelete(schema.id); await reload(); setError(null); }
    catch { setError('Could not delete the schema.'); }
  };
  return <section className={styles.card} aria-labelledby="metadata-schemas-heading">
    <div className={styles.heading}><div><h2 id="metadata-schemas-heading">Property templates</h2><p>Optional fields for matching notes. Apply defaults from a note’s property panel.</p></div><Button variant="secondary" onClick={() => open('new')}><Plus size={15} /> Add schema</Button></div>
    {error && !editing && <p role="alert" className={styles.error}>{error}</p>}
    {schemas.length ? <ul className={styles.list}>{schemas.map((schema) => <li key={schema.id}><div><strong>{schema.name}</strong><span>{schema.scope === 'folder' ? folders.find((folder) => folder.id === schema.selector)?.path ?? 'Missing folder' : `${schema.scope}: ${schema.selector}`} · {schema.fields.length} {schema.fields.length === 1 ? 'field' : 'fields'}</span></div><Button variant="secondary" onClick={() => open(schema)}>Edit</Button><button type="button" className={styles.delete} aria-label={`Delete ${schema.name}`} onClick={() => { void remove(schema); }}><Trash2 size={15} /></button></li>)}</ul> : <p className={styles.empty}>No property templates. Every note can still have its own YAML properties.</p>}
    <Dialog open={editing !== null} onOpenChange={(opened) => { if (!opened) setEditing(null); }} title={editing === 'new' ? 'Add property template' : 'Edit property template'}>
      {editing && <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <label>Schema name<input required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="Meeting notes" /></label>
        <label>Match notes by<select value={scope} onChange={(event) => { const next = event.target.value as MetadataSchema['scope']; setScope(next); setSelector(next === 'folder' ? folders[0]?.id ?? '' : ''); }}><option value="folder">Folder</option><option value="noteType">Note type property</option><option value="template">Template property</option><option value="base">Base property</option></select></label>
        {scope === 'folder' ? <label>Folder<select value={selector} onChange={(event) => setSelector(event.target.value)}><option value="">Choose folder</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.path}</option>)}</select></label> : <label>Matching value<input required maxLength={200} value={selector} onChange={(event) => setSelector(event.target.value)} placeholder={scope === 'noteType' ? 'meeting' : scope === 'template' ? 'weekly-review' : 'project-base'} /></label>}
        <p className={styles.hint}>Note type reads the YAML <code>type</code> property; Template reads <code>template</code>; Base reads <code>base</code>.</p>
        <div className={styles.fields}><strong>Suggested fields</strong>{fields.map((field, index) => <div key={index} className={styles.field}><label>Property name<input required maxLength={100} value={field.name} onChange={(event) => updateField(index, { name: event.target.value })} /></label><label>Type<select value={field.type} onChange={(event) => updateField(index, { type: propertyTypeSchema.parse(event.target.value) })}>{propertyTypeSchema.options.map((item) => <option key={item} value={item}>{item.replace(/([A-Z])/gu, ' $1').toLowerCase()}</option>)}</select></label>{(field.type === 'singleSelect' || field.type === 'multiSelect') && <label>Options<input value={field.options} onChange={(event) => updateField(index, { options: event.target.value })} placeholder="Draft, Done" /></label>}<label>Optional default<input value={field.defaultText} onChange={(event) => updateField(index, { defaultText: event.target.value })} placeholder={field.type === 'boolean' ? 'true or false' : undefined} /></label>{fields.length > 1 && <button type="button" className={styles.removeField} onClick={() => setFields((current) => current.filter((_, position) => position !== index))}>Remove field</button>}</div>)}</div>
        <button type="button" className={styles.addField} onClick={() => setFields((current) => [...current, blankField()])}>Add field</button>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <div className={styles.actions}><Button type="button" variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save schema'}</Button></div>
      </form>}
    </Dialog>
  </section>;
}
