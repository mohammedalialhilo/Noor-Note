'use client';

import { useState, type FormEvent } from 'react';
import { compileFormula, formulaField, type BaseAggregate, type BaseFormula, type BaseView } from '@noor-note/core';
import styles from './BasesView.module.css';

interface FormulaProps { formulas: BaseFormula[]; onSave: (formula: BaseFormula) => Promise<boolean>; onDelete: (id: string) => Promise<boolean> }
export function BaseFormulaSettings({ formulas, onSave, onDelete }: FormulaProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [expression, setExpression] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const edit = (formula: BaseFormula) => { setEditingId(formula.id); setName(formula.name); setExpression(formula.expression); setError(null); };
  const clear = () => { setEditingId(null); setName(''); setExpression(''); setError(null); };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      compileFormula(expression.trim());
      const formula = { id: editingId ?? crypto.randomUUID(), name: name.trim(), expression: expression.trim() };
      if (!formula.name) throw new Error('Enter a formula name.');
      setBusy(true);
      if (await onSave(formula)) clear();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Invalid formula.'); }
    finally { setBusy(false); }
  };
  return <section className={styles.settingsSection} aria-label="Computed properties">
    <h4>Computed properties</h4><p>Formulas are read-only and shared by all views in this Base. They never change note Markdown.</p>
    <div className={styles.formulaList}>{formulas.map((formula) => <div key={formula.id}><strong>{formula.name}</strong><code>{formula.expression}</code><button type="button" onClick={() => edit(formula)}>Edit</button><button type="button" className={styles.danger} onClick={() => { if (window.confirm(`Delete formula “${formula.name}” from this Base?`)) void onDelete(formula.id); }}>Delete</button></div>)}</div>
    <form className={styles.formulaForm} onSubmit={(event) => { void submit(event); }}><label>Formula name<input required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="Total" /></label><label>Expression<input required maxLength={500} value={expression} onChange={(event) => setExpression(event.target.value)} placeholder="price * quantity" spellCheck={false} /></label><button type="submit" disabled={busy}>{editingId ? 'Save formula' : 'Add formula'}</button>{editingId && <button type="button" onClick={clear}>Cancel</button>}</form>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <p>Use property names such as <code>price</code>, or <code>prop(&quot;Unit price&quot;)</code> for names with spaces. Available helpers include <code>if</code>, <code>coalesce</code>, <code>upper</code>, <code>daysBetween</code>, and <code>addDays</code>.</p>
  </section>;
}

interface AggregateProps { view: BaseView; fields: string[]; formulaLabels: Readonly<Record<string, string>>; onPatch: (patch: Partial<BaseView>) => Promise<void> }
export function BaseAggregateSettings({ view, fields, formulaLabels, onPatch }: AggregateProps) {
  const [operation, setOperation] = useState<BaseAggregate['operation']>('count');
  const [field, setField] = useState('');
  const [label, setLabel] = useState('');
  const add = () => {
    const title = label.trim() || (field ? `${operation} ${formulaLabels[field] ?? field.replace(/^property:/u, '')}` : 'Count');
    void onPatch({ aggregates: [...view.aggregates, { id: crypto.randomUUID(), operation, field: field || null, label: title }] });
    setLabel('');
  };
  return <section className={styles.settingsSection} aria-label="Aggregations"><h4>Aggregations</h4><p>Summaries use the notes visible in this view. Numeric operations ignore nonnumeric values.</p>
    <div className={styles.filterChips}>{view.aggregates.map((aggregate) => <span key={aggregate.id} className={styles.filterChip}>{aggregate.label}: {aggregate.operation} {aggregate.field ? formulaLabels[aggregate.field] ?? aggregate.field.replace(/^property:/u, '') : 'rows'}<button type="button" aria-label={`Remove ${aggregate.label} aggregation`} onClick={() => { void onPatch({ aggregates: view.aggregates.filter((item) => item.id !== aggregate.id) }); }}>×</button></span>)}</div>
    <div className={styles.inlineControls}><select aria-label="Aggregate operation" value={operation} onChange={(event) => setOperation(event.target.value as BaseAggregate['operation'])}>{(['count', 'sum', 'average', 'minimum', 'maximum', 'unique'] as const).map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select><select aria-label="Aggregate field" value={field} onChange={(event) => setField(event.target.value)}><option value="">All rows</option>{fields.map((item) => <option key={item} value={item}>{formulaLabels[item] ?? item.replace(/^property:/u, '')}</option>)}</select><input aria-label="Aggregate label" maxLength={100} value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Label" /><button type="button" disabled={operation !== 'count' && !field} onClick={add}>Add summary</button></div>
  </section>;
}

export function formulaLabels(formulas: readonly BaseFormula[]): Record<string, string> { return Object.fromEntries(formulas.map((formula) => [formulaField(formula.id), formula.name])); }
