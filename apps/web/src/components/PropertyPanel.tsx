'use client';

import { formatPropertyInput, inferPropertyType, inspectMetadata, matchingMetadataSchemas, metadataSchemaSchema, parsePropertyInput, propertyTypeSchema, type MetadataSchema, type PropertyType, type PropertyValue, type VaultNote } from '@noor-note/core';
import type { VaultRepository } from '@noor-note/storage';
import { useEffect, useMemo, useState } from 'react';
import styles from './PropertyPanel.module.css';

interface Props {
  note: VaultNote;
  repository: VaultRepository | null;
  onUpdate: (id: string, name: string, value: PropertyValue | undefined, type?: PropertyType, options?: string[]) => Promise<VaultNote | undefined>;
  onApplyDefaults: (id: string, schemas: MetadataSchema[]) => Promise<VaultNote | undefined>;
  pluginPropertyTypes?: { id: string; title: string; valueKind: 'text' | 'number' | 'boolean'; options?: string[] }[];
}

export function PropertyPanel({ note, repository, onUpdate, onApplyDefaults, pluginPropertyTypes = [] }: Props) {
  const [schemas, setSchemas] = useState<MetadataSchema[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<PropertyType>('text');
  const [presetId, setPresetId] = useState('');
  const [value, setValue] = useState('');
  const [optionsText, setOptionsText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const metadata = useMemo(() => { try { return { data: inspectMetadata(note.markdown), error: null }; } catch { return { data: null, error: 'Frontmatter contains invalid YAML. Fix it in Source Mode before editing properties here.' }; } }, [note.markdown]);

  useEffect(() => {
    if (!repository) return;
    let live = true;
    void repository.listObjects('metadataSchema', note.vaultId).then((objects) => {
      if (live) setSchemas(objects.flatMap((item) => { const parsed = metadataSchemaSchema.safeParse(item); return parsed.success ? [parsed.data] : []; }));
    }).catch(() => { if (live) setError('Could not load property schemas.'); });
    return () => { live = false; };
  }, [note.vaultId, repository]);

  const matched = matchingMetadataSchemas(note, schemas);
  const fields = matched.flatMap((schema) => schema.fields);
  const fieldFor = (key: string) => fields.find((field) => field.name === key);
  const entries = Object.entries(metadata.data?.values ?? {});
  const missingDefaults = fields.filter((field) => field.defaultValue !== undefined && !Object.hasOwn(metadata.data?.values ?? {}, field.name));
  const startAdd = () => { setEditing(''); setName(''); setType('text'); setPresetId(''); setValue(''); setOptionsText(''); setError(null); };
  const startEdit = (key: string, current: PropertyValue) => {
    const field = fieldFor(key);
    setEditing(key); setName(key); setPresetId(''); setType(metadata.data?.types[key] ?? field?.type ?? inferPropertyType(current));
    setValue(formatPropertyInput(current));
    setOptionsText((metadata.data?.options[key] ?? field?.options ?? []).join(', '));
    setError(null);
  };
  const save = async () => {
    try {
      const key = name.trim();
      if (!key || !metadata.data) throw new Error('Enter a property name');
      if (!editing && Object.hasOwn(metadata.data.values, key)) throw new Error('A property with this name already exists');
      const options = optionsText.split(',').map((item) => item.trim()).filter(Boolean);
      const parsed = parsePropertyInput(type, type === 'boolean' && !value ? 'false' : value, options);
      setSaving(true);
      const result = await onUpdate(note.id, key, parsed, type, type === 'singleSelect' || type === 'multiSelect' ? options : undefined);
      if (!result) throw new Error('Could not save the property');
      setEditing(null); setError(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save the property'); }
    finally { setSaving(false); }
  };
  const remove = async (key: string) => {
    setSaving(true);
    const result = await onUpdate(note.id, key, undefined);
    setSaving(false);
    if (!result) setError('Could not remove the property.');
  };
  const apply = async () => {
    setSaving(true);
    const result = await onApplyDefaults(note.id, matched);
    setSaving(false);
    if (!result) setError('Could not apply the schema defaults.');
  };
  return <section className={styles.panel} aria-label="Note properties">
    <div className={styles.heading}><h3>Properties <span>{entries.length}</span></h3><button type="button" onClick={startAdd} disabled={Boolean(metadata.error) || saving}>Add property</button></div>
    {metadata.error && <p role="alert" className={styles.error}>{metadata.error}</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {matched.length > 0 && <p className={styles.schemaHint}>Suggested by {matched.map((schema) => schema.name).join(', ')}. Fields remain optional.</p>}
    {missingDefaults.length > 0 && <button type="button" className={styles.apply} disabled={saving} onClick={() => { void apply(); }}>Apply {missingDefaults.length} missing {missingDefaults.length === 1 ? 'default' : 'defaults'}</button>}
    {entries.length ? <dl className={styles.list}>{entries.map(([key, current]) => <div key={key} className={styles.row}><dt>{key}<small>{metadata.data?.types[key] ?? fieldFor(key)?.type ?? inferPropertyType(current)}</small></dt><dd>{typeof current === 'object' && !Array.isArray(current) && current !== null ? <code>{JSON.stringify(current)}</code> : formatPropertyInput(current)}</dd><div className={styles.rowActions}>{typeof current === 'object' && !Array.isArray(current) && current !== null ? <small>Edit in Source</small> : <button type="button" disabled={saving} onClick={() => startEdit(key, current)}>Edit</button>}<button type="button" disabled={saving} onClick={() => { void remove(key); }}>Remove</button></div></div>)}</dl> : !metadata.error && <p className={styles.empty}>No properties yet. Add one here or edit YAML in Source Mode.</p>}
    {editing !== null && <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <h4>{editing ? `Edit ${editing}` : 'Add property'}</h4>
      <label>Name <input required maxLength={100} value={name} disabled={Boolean(editing)} onChange={(event) => setName(event.target.value)} /></label>
      {pluginPropertyTypes.length > 0 && <label>Plugin property preset <select value={presetId} onChange={(event) => { const selected = pluginPropertyTypes.find((item) => item.id === event.target.value); setPresetId(event.target.value); if (selected) { setType(selected.options?.length ? 'singleSelect' : selected.valueKind); setOptionsText(selected.options?.join(', ') ?? ''); } }}><option value="">None</option>{pluginPropertyTypes.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
      <label>Type <select value={type} onChange={(event) => { setPresetId(''); setType(propertyTypeSchema.parse(event.target.value)); }}>{propertyTypeSchema.options.map((item) => <option key={item} value={item}>{item.replace(/([A-Z])/gu, ' $1').toLowerCase()}</option>)}</select></label>
      {(type === 'singleSelect' || type === 'multiSelect') && <label>Options, separated by commas <input value={optionsText} onChange={(event) => setOptionsText(event.target.value)} placeholder="Open, In progress, Done" /></label>}
      <label>Value {type === 'boolean' ? <select value={value || 'false'} onChange={(event) => setValue(event.target.value)}><option value="false">False</option><option value="true">True</option></select> : type === 'singleSelect' && optionsText.trim() ? <select value={value} onChange={(event) => setValue(event.target.value)}><option value="">Choose…</option>{optionsText.split(',').map((item) => item.trim()).filter(Boolean).map((item) => <option key={item} value={item}>{item}</option>)}</select> : <input required={type !== 'list' && type !== 'multiSelect'} type={type === 'date' ? 'date' : type === 'datetime' ? 'datetime-local' : type === 'number' || type === 'rating' ? 'number' : type === 'email' ? 'email' : type === 'url' ? 'url' : 'text'} min={type === 'rating' ? 0 : undefined} max={type === 'rating' ? 5 : undefined} step={type === 'rating' ? 0.5 : type === 'number' ? 'any' : undefined} value={value} onChange={(event) => setValue(event.target.value)} placeholder={type === 'tag' ? '#nested/tag' : type === 'noteReference' ? '[[Note]]' : type === 'list' || type === 'multiSelect' ? 'One, Two' : type === 'location' ? 'City or coordinates' : undefined} />}</label>
      <div className={styles.actions}><button type="button" onClick={() => { setEditing(null); setError(null); }}>Cancel</button><button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save property'}</button></div>
    </form>}
  </section>;
}
