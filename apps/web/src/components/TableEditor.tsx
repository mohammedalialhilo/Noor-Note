'use client';

import { useState, type FormEvent } from 'react';
import { Dialog } from '@noor-note/ui';
import { addTableColumn, addTableRow, findMarkdownTable, markdownTableToCsv, moveTableColumn, parseCsvTable, removeTableColumn, removeTableRow, serializeMarkdownTable, setTableAlignment, sortTableRows, type MarkdownTable, type TableAlignment } from '@noor-note/core';
import { downloadText } from '../lib/workspace';
import styles from './TableEditor.module.css';

interface Props { source: string; cursor: number; selection: { from: number; to: number; text: string } | null; onApply: (expected: string, from: number, to: number, insert: string) => boolean; onClose: () => void }

function insertion(source: string, from: number, to: number, markdown: string): string {
  const before = source.slice(0, from), after = source.slice(to);
  const prefix = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const suffix = !after || after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  return `${prefix}${markdown}${suffix}`;
}

export function TableEditor({ source, cursor, selection, onApply, onClose }: Props) {
  const location = findMarkdownTable(source, selection?.from ?? cursor);
  const [table, setTable] = useState<MarkdownTable | null>(location?.table ?? null);
  const [csv, setCsv] = useState(location ? '' : selection?.text ?? '');
  const [error, setError] = useState<string | null>(null);
  const [sortColumn, setSortColumn] = useState<number | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const patchHeader = (index: number, value: string) => setTable((current) => current && ({ ...current, headers: current.headers.map((cell, column) => column === index ? value : cell) }));
  const patchCell = (row: number, column: number, value: string) => setTable((current) => current && ({ ...current, rows: current.rows.map((cells, item) => item === row ? cells.map((cell, position) => position === column ? value : cell) : cells) }));
  const convertCsv = () => { try { setTable(parseCsvTable(csv)); setError(null); setSortColumn(null); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not parse CSV.'); } };
  const apply = (event: FormEvent) => {
    event.preventDefault(); if (!table) return;
    try {
      const markdown = serializeMarkdownTable(table);
      const from = location?.from ?? selection?.from ?? cursor, to = location?.to ?? selection?.to ?? cursor;
      const insert = location ? markdown : insertion(source, from, to, markdown);
      if (!onApply(source, from, to, insert)) throw new Error('The note changed while the table editor was open. Reopen it to use the current text.');
      onClose();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not update the table.'); }
  };
  const preview = table && sortColumn !== null ? sortTableRows(table, sortColumn, sortDirection) : null;
  const csvOutput = table ? markdownTableToCsv(table) : '';
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }} title="Table editor" description="Edit a Markdown table visually. Changes are applied to the note only when you choose Apply." contentClassName={styles.dialog}>
    <form className={styles.form} onSubmit={apply}>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {location && <p className={styles.hint}>Editing the table under your cursor. The rest of the note stays in place.</p>}
      {table ? <>
        <div className={styles.scroller}><table className={styles.grid}><caption>Table cells and column controls</caption><thead><tr>{table.headers.map((header, column) => <th key={column} scope="col"><label>Column {column + 1}<input aria-label={`Column ${column + 1} heading`} value={header} maxLength={10000} onChange={(event) => patchHeader(column, event.target.value)} /></label><div className={styles.columnActions}><button type="button" aria-label={`Move column ${column + 1} left`} disabled={column === 0} onClick={() => setTable(moveTableColumn(table, column, column - 1))}>←</button><button type="button" aria-label={`Move column ${column + 1} right`} disabled={column === table.headers.length - 1} onClick={() => setTable(moveTableColumn(table, column, column + 1))}>→</button><button type="button" aria-label={`Remove column ${column + 1}`} disabled={table.headers.length === 1} onClick={() => setTable(removeTableColumn(table, column))}>Remove</button></div><label>Alignment<select aria-label={`Column ${column + 1} alignment`} value={table.alignments[column]} onChange={(event) => setTable(setTableAlignment(table, column, event.target.value as TableAlignment))}><option value="none">Default</option><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label></th>)}<th scope="col">Row</th></tr></thead><tbody>{table.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, column) => <td key={column}><label className={styles.srOnly} htmlFor={`table-cell-${rowIndex}-${column}`}>Row {rowIndex + 1}, column {column + 1}</label><input id={`table-cell-${rowIndex}-${column}`} aria-label={`Row ${rowIndex + 1}, column ${column + 1}`} value={cell} maxLength={10000} onChange={(event) => patchCell(rowIndex, column, event.target.value)} /></td>)}<td><button type="button" aria-label={`Remove row ${rowIndex + 1}`} onClick={() => setTable(removeTableRow(table, rowIndex))}>Remove</button></td></tr>)}</tbody></table></div>
        <div className={styles.actions}><button type="button" disabled={table.rows.length >= 1000} onClick={() => setTable(addTableRow(table))}>Add row</button><button type="button" disabled={table.headers.length >= 50} onClick={() => setTable(addTableColumn(table))}>Add column</button></div>
        <section className={styles.sort} aria-label="Temporary sort view"><h3>Temporary sort view</h3><p>Sorting here only changes this preview. It does not reorder the Markdown rows.</p><div><label>Column<select value={sortColumn ?? ''} onChange={(event) => setSortColumn(event.target.value === '' ? null : Number(event.target.value))}><option value="">Original order</option>{table.headers.map((header, index) => <option key={index} value={index}>{header || `Column ${index + 1}`}</option>)}</select></label><label>Direction<select value={sortDirection} onChange={(event) => setSortDirection(event.target.value as 'asc' | 'desc')}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label></div>{preview && <div className={styles.scroller}><table><caption>Sorted preview only</caption><thead><tr>{table.headers.map((header, index) => <th key={index} scope="col">{header}</th>)}</tr></thead><tbody>{preview.map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column}>{cell}</td>)}</tr>)}</tbody></table></div>}</section>
        <section className={styles.csvOutput}><h3>Convert table to CSV</h3><textarea aria-label="CSV output" readOnly rows={5} value={csvOutput} /><button type="button" onClick={() => downloadText('table.csv', csvOutput, 'text/csv;charset=utf-8')}>Download CSV</button></section>
      </> : <p className={styles.hint}>Place the cursor inside a Markdown table, or paste CSV below to make a new table.</p>}
      <section className={styles.csvInput}><h3>Convert CSV to table</h3><label>CSV source<textarea value={csv} rows={5} onChange={(event) => setCsv(event.target.value)} placeholder={'Name,Value\nFirst,1'} /></label><button type="button" onClick={convertCsv}>Convert CSV</button></section>
      <div className={styles.footer}><button type="button" onClick={onClose}>Cancel</button><button type="submit" disabled={!table}>Apply to Markdown</button></div>
    </form>
  </Dialog>;
}
