'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { Database, Menu, Plus, Settings2, SlidersHorizontal, Trash2, X } from 'lucide-react';
import {
  aggregateBaseNotes, applyBaseView, availableBaseFields, baseDefinitionSchema, baseQuerySchema, baseViewKindSchema, evaluateBaseFormulas, formulaField, inferPropertyType,
  newBaseView, normalizeTagName, parsePropertyInput, planTagRewrite, propertyTypeSchema, readBaseDefinition, removeBaseFormula,
  selectBaseNotes, updateFrontmatterProperty, withBaseDefinition,
  type Base, type BaseDefinition, type BaseFilter, type BaseFormula, type BaseQuery, type BaseView, type PropertyType,
} from '@noor-note/core';
import type { NoteEntry } from '@noor-note/storage';
import type { useVaultWorkspace } from '../hooks/useVaultWorkspace';
import { BasesStore } from '../lib/bases';
import type { WorkspaceLayout } from '../lib/workspace-layout';
import { BaseViewPanel } from './BaseViews';
import { BaseAggregateSettings, BaseFormulaSettings, formulaLabels as getFormulaLabels } from './BaseFormulaSettings';
import styles from './BasesView.module.css';

interface Props { workspace: ReturnType<typeof useVaultWorkspace>; onOpenNote: (id: string) => void; onCreateFromBase: (baseId: string, folderId: string | null) => void; onOpenNavigation: (event: ReactMouseEvent<HTMLButtonElement>) => void; initialTabs?: WorkspaceLayout['baseTabs']; onTabsChange?: (tabs: WorkspaceLayout['baseTabs']) => void }
const fieldLabel = (field: string, labels?: Readonly<Record<string, string>>) => labels?.[field] ?? (field.startsWith('property:') ? field.slice(9) : field === 'createdAt' ? 'Created' : field === 'updatedAt' ? 'Updated' : field === 'openTasks' ? 'Open tasks' : field[0]!.toUpperCase() + field.slice(1));
const dateFields = (fields: string[]) => fields.filter((field) => field === 'createdAt' || field === 'updatedAt' || field.startsWith('property:') || field.startsWith('formula:'));

function FieldSelect({ fields, value, onChange, allowNone = false, label, formulaLabels }: { fields: string[]; value: string | null; onChange: (value: string | null) => void; allowNone?: boolean; label: string; formulaLabels?: Readonly<Record<string, string>> }) {
  return <label className={styles.control}>{label}<select aria-label={label} value={value ?? ''} onChange={(event) => onChange(event.target.value || null)}>{allowNone && <option value="">None</option>}{fields.map((field) => <option key={field} value={field}>{fieldLabel(field, formulaLabels)}</option>)}</select></label>;
}

function QueryEditor({ query, folders, fields, formulaLabels, onApply, onClose }: { query: BaseQuery; folders: ReturnType<typeof useVaultWorkspace>['folders']; fields: string[]; formulaLabels: Readonly<Record<string, string>>; onApply: (query: BaseQuery) => Promise<boolean>; onClose: () => void }) {
  const [draft, setDraft] = useState(query);
  const [error, setError] = useState<string | null>(null);
  const patch = (value: Partial<BaseQuery>) => setDraft((current) => ({ ...current, ...value }));
  const submit = async (event: FormEvent) => { event.preventDefault(); const parsed = baseQuerySchema.safeParse(draft); if (!parsed.success) { setError('Check the query fields and dates.'); return; } if (await onApply(parsed.data)) onClose(); };
  return <form className={styles.queryEditor} onSubmit={(event) => { void submit(event); }} aria-label="Base query">
    <div className={styles.panelHeading}><h3>Which notes belong here?</h3><button type="button" aria-label="Close query editor" onClick={onClose}><X size={16} /></button></div>
    <div className={styles.queryGrid}>
      <label>Folder<select value={draft.folderId ?? ''} onChange={(event) => patch({ folderId: event.target.value || null })}><option value="">Every folder</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.path}</option>)}</select></label>
      <label className={styles.check}><input type="checkbox" checked={draft.includeSubfolders} onChange={(event) => patch({ includeSubfolders: event.target.checked })} /> Include subfolders</label>
      <label>Tag<input value={draft.tag ?? ''} onChange={(event) => patch({ tag: event.target.value || null })} placeholder="research/project" /></label>
      <label>Links to<input value={draft.link ?? ''} onChange={(event) => patch({ link: event.target.value || null })} placeholder="Note title or path" /></label>
      <label>Tasks<select value={draft.task} onChange={(event) => patch({ task: event.target.value as BaseQuery['task'] })}><option value="any">Any</option><option value="open">Has open tasks</option><option value="done">Has completed tasks</option><option value="none">No tasks</option></select></label>
      <label>Property<select value={draft.property?.field ?? ''} onChange={(event) => patch({ property: event.target.value ? { field: event.target.value, operator: 'equals', value: '' } : null })}><option value="">Any</option>{fields.filter((field) => field.startsWith('property:') || field.startsWith('formula:')).map((field) => <option key={field} value={field}>{fieldLabel(field, formulaLabels)}</option>)}</select></label>
      {draft.property && <><label>Property condition<select value={draft.property.operator} onChange={(event) => patch({ property: { ...draft.property!, operator: event.target.value as BaseFilter['operator'] } })}>{['equals', 'contains', 'exists', 'greater', 'less'].map((operator) => <option key={operator} value={operator}>{operator}</option>)}</select></label>{draft.property.operator !== 'exists' && <label>Value<input value={draft.property.value} onChange={(event) => patch({ property: { ...draft.property!, value: event.target.value } })} /></label>}</>}
      <label>Date field<select value={draft.date?.field ?? ''} onChange={(event) => patch({ date: event.target.value ? { field: event.target.value, after: null, before: null } : null })}><option value="">Any date</option>{dateFields(fields).map((field) => <option key={field} value={field}>{fieldLabel(field, formulaLabels)}</option>)}</select></label>
      {draft.date && <><label>On or after<input type="date" value={draft.date.after ?? ''} onChange={(event) => patch({ date: { ...draft.date!, after: event.target.value || null } })} /></label><label>On or before<input type="date" value={draft.date.before ?? ''} onChange={(event) => patch({ date: { ...draft.date!, before: event.target.value || null } })} /></label></>}
      <label className={styles.full}>Search expression<input value={draft.search} onChange={(event) => patch({ search: event.target.value })} placeholder="phrase tag:research property.status:Done" /></label>
    </div>
    {error && <p role="alert" className={styles.error}>{error}</p>}<div className={styles.actions}><button type="button" onClick={() => setDraft(baseQuerySchema.parse({}))}>Clear filters</button><button type="submit" className={styles.primary}>Apply query</button></div>
  </form>;
}

function ViewSettings({ view, fields, formulas, formulaLabels, onPatch, onSaveFormula, onDeleteFormula, onDelete }: { view: BaseView; fields: string[]; formulas: BaseFormula[]; formulaLabels: Readonly<Record<string, string>>; onPatch: (patch: Partial<BaseView>) => Promise<void>; onSaveFormula: (formula: BaseFormula) => Promise<boolean>; onDeleteFormula: (id: string) => Promise<boolean>; onDelete: () => void }) {
  const [filterField, setFilterField] = useState(fields[0] ?? 'title');
  const [filterOperator, setFilterOperator] = useState<BaseFilter['operator']>('contains');
  const [filterValue, setFilterValue] = useState('');
  const [newLane, setNewLane] = useState('');
  const [propertyName, setPropertyName] = useState('');
  const [propertyType, setPropertyType] = useState<PropertyType>('text');
  const [propertyOptions, setPropertyOptions] = useState('');
  const [error, setError] = useState<string | null>(null);
  const patch = (next: Partial<BaseView>) => { void onPatch(next); };
  const addProperty = () => {
    const name = propertyName.trim(); const field = `property:${name}`;
    if (!name || name.length > 100 || ['title', 'aliases', 'noor_property_types', 'noor_property_options'].includes(name) || /[\r\n]/u.test(name) || fields.includes(field)) { setError('Choose a new property name.'); return; }
    const options = propertyOptions.split(',').map((item) => item.trim()).filter(Boolean);
    if ((propertyType === 'singleSelect' || propertyType === 'multiSelect') && !options.length) { setError('Add at least one select option.'); return; }
    patch({ fieldTypes: { ...view.fieldTypes, [field]: propertyType }, fieldOptions: { ...view.fieldOptions, [field]: options }, columnOrder: [...view.columnOrder, field], visibleFields: [...view.visibleFields, field] });
    setPropertyName(''); setPropertyOptions(''); setError(null);
  };
  return <div className={styles.viewSettings} aria-label="View settings">
    <div className={styles.settingsGrid}><label>View name<input maxLength={100} value={view.name} onChange={(event) => patch({ name: event.target.value || view.name })} /></label>
      <FieldSelect formulaLabels={formulaLabels} fields={view.kind === 'kanban' ? [...new Set(['property:status', 'tags', 'folder', ...fields.filter((field) => field.startsWith('property:'))])] : fields} value={view.groupBy} allowNone={view.kind !== 'kanban'} label="Group by" onChange={(groupBy) => patch({ groupBy })} />
      <FieldSelect formulaLabels={formulaLabels} fields={fields} value={view.sort?.field ?? null} allowNone label="Sort by" onChange={(field) => patch({ sort: field ? { field, direction: view.sort?.direction ?? 'asc' } : null })} />
      {view.sort && <label>Direction<select value={view.sort.direction} onChange={(event) => patch({ sort: { ...view.sort!, direction: event.target.value as 'asc' | 'desc' } })}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label>}
    </div>
    <div className={styles.settingsSection}><h4>View filters</h4>{view.filters.map((filter, index) => <div key={`${filter.field}:${index}`} className={styles.filterChip}>{fieldLabel(filter.field, formulaLabels)} {filter.operator} {filter.value}<button type="button" aria-label={`Remove filter ${index + 1}`} onClick={() => patch({ filters: view.filters.filter((_, current) => current !== index) })}><X size={13} /></button></div>)}<div className={styles.inlineControls}><select aria-label="Filter field" value={filterField} onChange={(event) => setFilterField(event.target.value)}>{fields.map((field) => <option key={field} value={field}>{fieldLabel(field, formulaLabels)}</option>)}</select><select aria-label="Filter condition" value={filterOperator} onChange={(event) => setFilterOperator(event.target.value as BaseFilter['operator'])}>{['equals', 'contains', 'exists', 'greater', 'less'].map((operator) => <option key={operator} value={operator}>{operator}</option>)}</select>{filterOperator !== 'exists' && <input aria-label="Filter value" value={filterValue} onChange={(event) => setFilterValue(event.target.value)} placeholder="Value" />}<button type="button" onClick={() => patch({ filters: [...view.filters, { field: filterField, operator: filterOperator, value: filterValue }] })}>Add filter</button></div></div>
    <div className={styles.settingsSection}><h4>Visible fields</h4><div className={styles.fieldChecks}>{fields.map((field) => <label key={field}><input type="checkbox" checked={view.visibleFields.includes(field)} onChange={(event) => patch({ visibleFields: event.target.checked ? [...view.visibleFields, field] : view.visibleFields.filter((item) => item !== field) })} />{fieldLabel(field, formulaLabels)}</label>)}</div>{view.kind === 'table' && <div className={styles.columnOrder}>{view.columnOrder.filter((field) => view.visibleFields.includes(field)).map((field, index, ordered) => <div key={field}><span>{fieldLabel(field, formulaLabels)}</span><button type="button" disabled={index === 0} aria-label={`Move ${fieldLabel(field, formulaLabels)} column left`} onClick={() => { const next = [...view.columnOrder]; const at = next.indexOf(field); [next[at - 1], next[at]] = [next[at]!, next[at - 1]!]; patch({ columnOrder: next }); }}>←</button><button type="button" disabled={index === ordered.length - 1} aria-label={`Move ${fieldLabel(field, formulaLabels)} column right`} onClick={() => { const next = [...view.columnOrder]; const at = next.indexOf(field); [next[at + 1], next[at]] = [next[at]!, next[at + 1]!]; patch({ columnOrder: next }); }}>→</button></div>)}</div>}</div>
    <div className={styles.settingsSection}><h4>Create property column</h4><div className={styles.inlineControls}><input aria-label="New property name" value={propertyName} onChange={(event) => setPropertyName(event.target.value)} placeholder="Property name" /><select aria-label="New property type" value={propertyType} onChange={(event) => setPropertyType(propertyTypeSchema.parse(event.target.value))}>{propertyTypeSchema.options.map((type) => <option key={type} value={type}>{type}</option>)}</select>{(propertyType === 'singleSelect' || propertyType === 'multiSelect') && <input aria-label="Select options" value={propertyOptions} onChange={(event) => setPropertyOptions(event.target.value)} placeholder="Option 1, Option 2" />}<button type="button" onClick={addProperty}><Plus size={13} /> Add</button></div>{error && <p role="alert" className={styles.error}>{error}</p>}</div>
    {(view.kind === 'cards' || view.kind === 'gallery') && <div className={styles.settingsSection}><h4>Cards</h4><div className={styles.settingsGrid}><FieldSelect formulaLabels={formulaLabels} fields={fields} value={view.card.titleField} label="Title field" onChange={(titleField) => { if (titleField) patch({ card: { ...view.card, titleField } }); }} /><FieldSelect formulaLabels={formulaLabels} fields={fields} value={view.card.imageField} allowNone label="Image property" onChange={(imageField) => patch({ card: { ...view.card, imageField } })} /><FieldSelect formulaLabels={formulaLabels} fields={fields} value={view.card.descriptionField} allowNone label="Description" onChange={(descriptionField) => patch({ card: { ...view.card, descriptionField } })} /><label>Card size<select value={view.card.size} onChange={(event) => patch({ card: { ...view.card, size: event.target.value as BaseView['card']['size'] } })}><option value="compact">Compact</option><option value="medium">Medium</option><option value="large">Large</option></select></label></div><div className={styles.fieldChecks}>{fields.filter((field) => field.startsWith('property:') || field.startsWith('formula:')).map((field) => <label key={field}><input type="checkbox" checked={view.card.propertyFields.includes(field)} onChange={(event) => patch({ card: { ...view.card, propertyFields: event.target.checked ? [...view.card.propertyFields, field] : view.card.propertyFields.filter((item) => item !== field) } })} />{fieldLabel(field, formulaLabels)}</label>)}</div></div>}
    {view.kind === 'kanban' && <div className={styles.settingsSection}><h4>Kanban lanes</h4><p>Group by a status or select property, tags, or folder. Drag a card or use its Move to control.</p><div className={styles.filterChips}>{view.kanbanLanes.map((lane) => <span key={lane} className={styles.filterChip}>{lane}<button type="button" aria-label={`Remove ${lane} lane`} onClick={() => patch({ kanbanLanes: view.kanbanLanes.filter((item) => item !== lane) })}><X size={13} /></button></span>)}</div><div className={styles.inlineControls}><input aria-label="New lane name" value={newLane} onChange={(event) => setNewLane(event.target.value)} placeholder="New lane" /><button type="button" onClick={() => { if (newLane.trim() && !view.kanbanLanes.includes(newLane.trim())) patch({ kanbanLanes: [...view.kanbanLanes, newLane.trim()] }); setNewLane(''); }}>Add lane</button></div></div>}
    {view.kind === 'calendar' && <div className={styles.settingsSection}><h4>Calendar dates</h4><div className={styles.settingsGrid}><FieldSelect formulaLabels={formulaLabels} fields={dateFields(fields)} value={view.calendar.dateField} label="Date or start" onChange={(dateField) => { if (dateField) patch({ calendar: { ...view.calendar, dateField } }); }} /><FieldSelect formulaLabels={formulaLabels} fields={dateFields(fields)} value={view.calendar.endField} allowNone label="End date" onChange={(endField) => patch({ calendar: { ...view.calendar, endField } })} /><FieldSelect formulaLabels={formulaLabels} fields={dateFields(fields)} value={view.calendar.taskDateField} allowNone label="Task date" onChange={(taskDateField) => patch({ calendar: { ...view.calendar, taskDateField } })} /></div></div>}
    {view.kind === 'map' && <div className={styles.settingsSection}><h4>Map location</h4><FieldSelect formulaLabels={formulaLabels} fields={fields.filter((field) => field.startsWith('property:') || field.startsWith('formula:'))} value={view.map.locationField} label="Location property" onChange={(locationField) => { if (locationField) patch({ map: { locationField } }); }} /><p>Use “latitude, longitude” text or a structured location with lat/lng. Place names without coordinates remain unplaced offline.</p></div>}
    {(view.kind === 'timeline' || view.kind === 'gantt') && <div className={styles.settingsSection}><h4>{view.kind === 'gantt' ? 'Gantt' : 'Timeline'} fields</h4><div className={styles.settingsGrid}><FieldSelect formulaLabels={formulaLabels} fields={dateFields(fields)} value={view.kind === 'gantt' ? view.gantt.startField : view.timeline.startField} label="Start date" onChange={(startField) => { if (startField) patch(view.kind === 'gantt' ? { gantt: { ...view.gantt, startField } } : { timeline: { ...view.timeline, startField } }); }} /><FieldSelect formulaLabels={formulaLabels} fields={dateFields(fields)} value={view.kind === 'gantt' ? view.gantt.endField : view.timeline.endField} label="End date" onChange={(endField) => { if (endField) patch(view.kind === 'gantt' ? { gantt: { ...view.gantt, endField } } : { timeline: { ...view.timeline, endField } }); }} />{view.kind === 'timeline' ? <FieldSelect formulaLabels={formulaLabels} fields={fields} value={view.timeline.groupField} allowNone label="Group field" onChange={(groupField) => patch({ timeline: { ...view.timeline, groupField } })} /> : <><FieldSelect formulaLabels={formulaLabels} fields={fields} value={view.gantt.dependencyField} allowNone label="Dependency metadata" onChange={(dependencyField) => patch({ gantt: { ...view.gantt, dependencyField } })} /><FieldSelect formulaLabels={formulaLabels} fields={fields} value={view.gantt.progressField} allowNone label="Progress property" onChange={(progressField) => patch({ gantt: { ...view.gantt, progressField } })} /></>}</div></div>}
    <BaseFormulaSettings formulas={formulas} onSave={onSaveFormula} onDelete={onDeleteFormula} />
    <BaseAggregateSettings view={view} fields={fields} formulaLabels={formulaLabels} onPatch={onPatch} />
    <button type="button" className={styles.danger} onClick={onDelete}><Trash2 size={14} /> Delete view</button>
  </div>;
}

export function BasesView({ workspace, onOpenNote, onCreateFromBase, onOpenNavigation, initialTabs, onTabsChange }: Props) {
  const vaultId = workspace.activeVault?.id;
  const store = useMemo(() => workspace.repository && vaultId ? new BasesStore(workspace.repository, vaultId) : null, [workspace.repository, vaultId]);
  const [bases, setBases] = useState<Base[]>([]);
  const basesRef = useRef<Base[]>([]);
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const [activeId, setActiveId] = useState<string | null>(initialTabs?.activeId ?? null);
  const [openIds, setOpenIds] = useState<string[]>(initialTabs?.ids ?? []);
  const initialActiveIdRef = useRef(initialTabs?.activeId);
  const onTabsChangeRef = useRef(onTabsChange);
  useEffect(() => { onTabsChangeRef.current = onTabsChange; }, [onTabsChange]);
  useEffect(() => { onTabsChangeRef.current?.({ ids: openIds, activeId }); }, [openIds, activeId]);
  const [newName, setNewName] = useState('');
  const [newViewKind, setNewViewKind] = useState<BaseView['kind']>('table');
  const [showQuery, setShowQuery] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [searchIds, setSearchIds] = useState<Set<string> | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!store) return;
    let live = true;
    void store.list().then((items) => { if (live) { basesRef.current = items; setBases(items); const available = items.filter((item) => !item.deletedAt); const selected = available.find((item) => item.id === initialActiveIdRef.current)?.id ?? available[0]?.id ?? null; setOpenIds((current) => { const valid = current.filter((id) => available.some((item) => item.id === id)); return selected && !valid.includes(selected) ? [...valid, selected] : valid; }); setActiveId(selected); } }).catch((caught: unknown) => { if (live) setError(caught instanceof Error ? caught.message : 'Could not load Bases.'); });
    return () => { live = false; };
  }, [store]);
  const base = bases.find((item) => item.id === activeId && !item.deletedAt) ?? null;
  const definition = useMemo(() => base ? readBaseDefinition(base) : null, [base]);
  const view = definition?.views.find((item) => item.id === definition.activeViewId) ?? null;
  const formulaLabels = useMemo(() => getFormulaLabels(definition?.formulas ?? []), [definition]);
  const computed = useMemo(() => definition ? evaluateBaseFormulas(workspace.notes, definition.formulas) : new Map(), [definition, workspace.notes]);
  const fields = availableBaseFields(workspace.notes, [...(view ? [...view.columnOrder, ...Object.keys(view.fieldTypes), ...(view.groupBy ? [view.groupBy] : [])] : []), ...Object.keys(formulaLabels)]);
  const searchExpression = definition?.query.search.trim() ?? '';
  const searchNotes = workspace.searchNotes;
  useEffect(() => {
    if (!searchExpression) return;
    let live = true;
    const timer = window.setTimeout(() => { if (live) { setSearchIds(null); setSearchError(null); } }, 0);
    void searchNotes(searchExpression, 'relevance', workspace.notes.length).then((results) => { if (live) { window.clearTimeout(timer); setSearchIds(new Set(results.map((result) => result.id))); setSearchError(null); } }).catch((caught: unknown) => { if (live) { window.clearTimeout(timer); setSearchError(caught instanceof Error ? caught.message : 'Search failed'); setSearchIds(new Set()); } });
    return () => { live = false; window.clearTimeout(timer); };
  }, [searchExpression, searchNotes, workspace.notes]);
  const selected = definition ? selectBaseNotes(workspace.notes, definition.query, workspace.folders, searchExpression ? searchIds ?? undefined : undefined, computed) : [];
  const rows = view ? applyBaseView(selected, view, workspace.folders, computed) : [];
  const aggregates = view ? aggregateBaseNotes(rows, view.aggregates, workspace.folders, computed) : [];
  const replace = (updated: Base) => { const next = basesRef.current.map((item) => item.id === updated.id ? updated : item); basesRef.current = next; setBases(next); };
  const persist = async (id: string, transform: (definition: BaseDefinition) => BaseDefinition): Promise<boolean> => {
    if (!store) return false;
    const current = basesRef.current.find((item) => item.id === id);
    if (!current) return false;
    try {
      const updatedDefinition = baseDefinitionSchema.parse(transform(readBaseDefinition(current)));
      const updated = withBaseDefinition(current, updatedDefinition);
      replace(updated);
      const operation = saveQueue.current.then(() => store.save(updated, updatedDefinition));
      saveQueue.current = operation.catch(() => undefined);
      await operation;
      setError(null);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save Base settings.');
      try { const items = await store.list(); basesRef.current = items; setBases(items); } catch { /* Keep the error visible. */ }
      return false;
    }
  };
  const patchView = async (patch: Partial<BaseView>) => { if (base && view) await persist(base.id, (current) => ({ ...current, views: current.views.map((item) => item.id === view.id ? { ...item, ...patch } : item) })); };
  const saveFormula = async (formula: BaseFormula): Promise<boolean> => {
    if (!base || !view) return false;
    return persist(base.id, (current) => {
      const existing = current.formulas.some((item) => item.id === formula.id);
      const field = formulaField(formula.id);
      return { ...current, formulas: existing ? current.formulas.map((item) => item.id === formula.id ? formula : item) : [...current.formulas, formula], views: existing ? current.views : current.views.map((item) => item.id === view.id ? { ...item, visibleFields: [...item.visibleFields, field], columnOrder: [...item.columnOrder, field] } : item) };
    });
  };
  const deleteFormula = async (id: string): Promise<boolean> => base ? persist(base.id, (current) => removeBaseFormula(current, id)) : false;
  const create = async (event: FormEvent) => { event.preventDefault(); if (!store) return; setBusy(true); try { await saveQueue.current; const created = await store.create(newName); const next = [...basesRef.current, created].sort((a, b) => a.title.localeCompare(b.title)); basesRef.current = next; setBases(next); setOpenIds((current) => [...current, created.id]); setActiveId(created.id); setNewName(''); setError(null); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not create Base.'); } finally { setBusy(false); } };
  const rename = async () => { if (!store || !base) return; const name = window.prompt('Rename Base', base.title); if (name === null) return; setBusy(true); try { await saveQueue.current; replace(await store.rename(base, name)); setError(null); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not rename Base.'); } finally { setBusy(false); } };
  const remove = async () => { if (!store || !base || !window.confirm(`Delete Base “${base.title}”? Notes will remain in your vault.`)) return; setBusy(true); try { await saveQueue.current; replace(await store.remove(base)); const nextId = basesRef.current.find((item) => !item.deletedAt && item.id !== base.id)?.id ?? null; setOpenIds((current) => { const remaining = current.filter((id) => id !== base.id); return nextId && !remaining.includes(nextId) ? [...remaining, nextId] : remaining; }); setActiveId(nextId); setError(null); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not delete Base.'); } finally { setBusy(false); } };
  const restore = async (item: Base) => { if (!store) return; try { replace(await store.restore(item)); setOpenIds((current) => current.includes(item.id) ? current : [...current, item.id]); setActiveId(item.id); setError(null); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not restore Base.'); } };
  const addView = async () => { if (!base || !definition) return; const next = newBaseView(newViewKind); if (await persist(base.id, (current) => ({ ...current, views: [...current.views, next], activeViewId: next.id }))) setShowSettings(true); };
  const deleteView = async () => { if (!base || !definition || !view || definition.views.length === 1) { setError('A Base needs at least one view.'); return; } if (!window.confirm(`Delete the “${view.name}” view?`)) return; if (await persist(base.id, (current) => ({ ...current, views: current.views.filter((item) => item.id !== view.id), activeViewId: current.views.find((item) => item.id !== view.id)!.id }))) setShowSettings(false); };
  const edit = async (note: NoteEntry, field: string, input: string): Promise<boolean> => {
    try {
      if (field === 'title') { if (!input.trim()) throw new Error('Enter a note title.'); const saved = await workspace.renameNote(note.id, input.trim()); if (!saved) throw new Error('Could not rename note.'); return true; }
      if (!field.startsWith('property:')) throw new Error('This field is read only.');
      const key = field.slice(9), type = view?.fieldTypes[field] ?? (note.properties[key] === undefined ? 'text' : inferPropertyType(note.properties[key]));
      const options = view?.fieldOptions[field] ?? [];
      const parsed = input.trim() ? parsePropertyInput(type, input, options) : undefined;
      const saved = await workspace.updateProperty(note.id, key, parsed, type, options);
      if (!saved) throw new Error('Could not update Markdown frontmatter.');
      setError(null); return true;
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not edit note.'); return false; }
  };
  const moveGroup = async (note: NoteEntry, field: string, from: string, to: string): Promise<boolean> => {
    if (from === to) return true;
    try {
      if (field.startsWith('property:')) return edit(note, field, to === 'Unassigned' ? '' : to);
      if (field === 'folder') { const folderId = to === 'Root' ? null : workspace.folders.find((item) => item.path === to)?.id; if (folderId === undefined) throw new Error('Folder lane no longer exists.'); if (!await workspace.moveNote(note.id, folderId)) throw new Error('Could not move note.'); return true; }
      if (field === 'tags') {
        const repository = workspace.repository;
        if (!repository) throw new Error('Vault is unavailable.');
        await workspace.flushPending();
        const source = await repository.getNote(note.id);
        if (!source) throw new Error('Note no longer exists.');
        const destination = to === 'Unassigned' ? null : normalizeTagName(to);
        const changed = from === 'Unassigned' ? updateFrontmatterProperty(source.markdown, 'tags', destination ? [destination] : undefined, 'list') : planTagRewrite([source], from, destination)[0]?.after ?? source.markdown;
        if (changed === source.markdown) throw new Error('This tag could not be moved from the note.');
        await repository.saveNote(note.id, { markdown: changed }, true); await workspace.refreshActive(); return true;
      }
      throw new Error('Choose a property, tag, or folder for Kanban grouping.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not move card.'); return false; }
  };
  const bulkEdit = async (ids: string[], field: string, input: string): Promise<boolean> => { if (!field.startsWith('property:')) { setError('Choose a property field.'); return false; } for (const id of ids) { const note = workspace.notes.find((item) => item.id === id); if (note && !await edit(note, field, input)) return false; } return true; };
  const bulkTrash = async (ids: string[]): Promise<boolean> => { for (const id of ids) { await workspace.removeNote(id); if (!((await workspace.repository?.getNote(id))?.deletedAt)) { setError('Some notes could not be moved to Trash.'); return false; } } return true; };
  const activateResource = (id: string) => { setOpenIds((current) => current.includes(id) ? current : [...current, id]); setActiveId(id); setShowQuery(false); setShowSettings(false); };
  const closeResourceTab = (id: string) => { const next = openIds.filter((item) => item !== id); setOpenIds(next); if (activeId === id) setActiveId(next.at(-1) ?? null); };

  return <main className={styles.layout}>
    <div className={styles.topbar}><button type="button" className="icon-button mobile-menu" aria-label="Open navigation" onClick={onOpenNavigation}><Menu size={20} /></button><Database size={18} /><strong>Bases</strong><span>Saved views of Markdown notes</span></div>
    {openIds.length > 0 && <div className="resource-tabbar" role="tablist" aria-label="Open Base tabs">{openIds.map((id) => { const item = bases.find((entry) => entry.id === id && !entry.deletedAt); return item ? <div key={id} className="resource-tab"><button type="button" role="tab" aria-selected={activeId === id} onClick={() => activateResource(id)}>{item.title}</button><button type="button" aria-label={`Close ${item.title} Base tab`} onClick={() => closeResourceTab(id)}><X size={13} /></button></div> : null; })}</div>}
    <div className={styles.body}><aside className={styles.sidebar} aria-label="Bases"><h2>Your Bases</h2><div className={styles.baseList}>{bases.filter((item) => !item.deletedAt).map((item) => <button key={item.id} type="button" aria-current={activeId === item.id ? 'page' : undefined} className={activeId === item.id ? styles.active : ''} onClick={() => activateResource(item.id)}>{item.title}</button>)}</div><form onSubmit={(event) => { void create(event); }}><label className="sr-only" htmlFor="new-base-name">New Base name</label><input id="new-base-name" required maxLength={200} value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="New Base name" /><button type="submit" disabled={busy}><Plus size={15} /> Create Base</button></form>{bases.some((item) => item.deletedAt) && <details className={styles.deleted}><summary>Deleted Bases</summary>{bases.filter((item) => item.deletedAt).map((item) => <div key={item.id}><span>{item.title}</span><button type="button" onClick={() => { void restore(item); }}>Restore</button></div>)}</details>}</aside>
      <div className={styles.workspace}>{error && <div className={styles.errorBar} role="alert">{error}<button type="button" aria-label="Dismiss error" onClick={() => setError(null)}><X size={15} /></button></div>}
        {!base || !definition || !view ? <div className={styles.emptyBase}><Database size={34} /><h1>Build a view from your notes</h1><p>A Base is a saved query over your Markdown notes. Create one to organize existing notes without moving their content.</p></div> : <>
          <div className={styles.baseHeading}><div><span className={styles.eyebrow}>BASE · {rows.length} NOTES</span><h1>{base.title}</h1></div><div className={styles.headingActions}><button type="button" onClick={() => onCreateFromBase(base.id, definition.query.folderId)}><Plus size={15} /> New note</button><button type="button" onClick={() => setShowQuery((open) => !open)} aria-expanded={showQuery}><SlidersHorizontal size={16} /> Query</button><button type="button" onClick={() => { void rename(); }} disabled={busy}>Rename</button><button type="button" className={styles.danger} onClick={() => { void remove(); }} disabled={busy}><Trash2 size={15} /> Delete</button></div></div>
          {showQuery && <QueryEditor key={base.id} query={definition.query} folders={workspace.folders} fields={fields} formulaLabels={formulaLabels} onApply={(query) => persist(base.id, (current) => ({ ...current, query }))} onClose={() => setShowQuery(false)} />}
          <div className={styles.viewBar}><div className={styles.viewTabs} role="tablist" aria-label="Base views">{definition.views.map((item) => <button key={item.id} type="button" role="tab" aria-selected={item.id === view.id} onClick={() => { void persist(base.id, (current) => ({ ...current, activeViewId: item.id })); setShowSettings(false); }}>{item.name}<small>{item.kind}</small></button>)}</div><div className={styles.viewActions}><select aria-label="New view type" value={newViewKind} onChange={(event) => setNewViewKind(baseViewKindSchema.parse(event.target.value))}>{baseViewKindSchema.options.map((kind) => <option key={kind} value={kind}>{kind[0]!.toUpperCase() + kind.slice(1)}</option>)}</select><button type="button" onClick={() => { void addView(); }}><Plus size={14} /> View</button><button type="button" aria-label="View settings" aria-expanded={showSettings} onClick={() => setShowSettings((open) => !open)}><Settings2 size={17} /></button></div></div>
          {showSettings && <ViewSettings key={view.id} view={view} fields={fields} formulas={definition.formulas} formulaLabels={formulaLabels} onPatch={patchView} onSaveFormula={saveFormula} onDeleteFormula={deleteFormula} onDelete={() => { void deleteView(); }} />}
          {searchExpression && searchIds === null && !searchError && <p className={styles.status} role="status">Searching local notes…</p>}
          {searchError && <p className={styles.error} role="alert">Search expression: {searchError}</p>}
          {aggregates.length > 0 && <section className={styles.aggregateBar} aria-label="View summaries">{aggregates.map((item) => <div key={item.id}><span>{item.label}</span><strong>{Array.isArray(item.value) ? item.value.length ? `${item.value.slice(0, 12).join(', ')}${item.value.length > 12 ? ` +${item.value.length - 12} more` : ''}` : 'None' : item.value === null ? '—' : new Intl.NumberFormat().format(item.value)}</strong></div>)}</section>}
          <div className={styles.results}><BaseViewPanel key={view.id} notes={rows} view={view} fields={fields} folders={workspace.folders} computed={computed} formulaLabels={formulaLabels} attachments={workspace.attachments} repository={workspace.repository} onOpen={onOpenNote} onPatchView={patchView} onEdit={edit} onMoveGroup={moveGroup} onBulkEdit={bulkEdit} onBulkTrash={bulkTrash} /></div>
        </>}
      </div>
    </div>
  </main>;
}
