export type TableAlignment = 'none' | 'left' | 'center' | 'right';
export interface MarkdownTable { headers: string[]; alignments: TableAlignment[]; rows: string[][] }
export interface MarkdownTableLocation { from: number; to: number; table: MarkdownTable }

function splitRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1);
  const cells: string[] = [];
  let cell = '';
  for (let index = 0; index < text.length; index++) {
    const character = text[index]!;
    if (character === '\\' && index + 1 < text.length) { cell += character + text[++index]!; continue; }
    if (character === '|') { cells.push(cell.trim()); cell = ''; continue; }
    cell += character;
  }
  cells.push(cell.trim());
  return cells;
}
function hasPipe(line: string): boolean { for (let index = 0; index < line.length; index++) { if (line[index] === '\\') { index++; continue; } if (line[index] === '|') return true; } return false; }
function delimiter(cell: string): TableAlignment | null {
  if (!/^:?-{3,}:?$/u.test(cell)) return null;
  return cell.startsWith(':') ? cell.endsWith(':') ? 'center' : 'left' : cell.endsWith(':') ? 'right' : 'none';
}
function validate(table: MarkdownTable): void {
  if (table.headers.length < 1 || table.headers.length > 50 || table.alignments.length !== table.headers.length || table.rows.length > 1000 || table.rows.some((row) => row.length !== table.headers.length)) throw new Error('Tables need 1–50 columns and at most 1,000 aligned rows.');
  if ([...table.headers, ...table.rows.flat()].some((cell) => cell.length > 10_000 || /[\r\n]/u.test(cell))) throw new Error('Table cells must be single lines under 10,000 characters.');
}
function linesWithOffsets(markdown: string): { text: string; from: number; to: number }[] {
  const lines: { text: string; from: number; to: number }[] = [];
  let from = 0;
  for (let index = 0; index <= markdown.length; index++) if (index === markdown.length || markdown[index] === '\n') {
    const to = index > from && markdown[index - 1] === '\r' ? index - 1 : index;
    lines.push({ text: markdown.slice(from, to), from, to }); from = index + 1;
  }
  return lines;
}
/** Find only a GFM-shaped table at the requested source offset; fenced code and YAML are excluded. */
export function findMarkdownTable(markdown: string, offset: number): MarkdownTableLocation | null {
  if (!Number.isInteger(offset) || offset < 0 || offset > markdown.length) return null;
  const lines = linesWithOffsets(markdown), hidden = new Set<number>();
  let fence: string | null = null, frontmatter = lines[0]?.text.trim() === '---';
  if (frontmatter) hidden.add(0);
  for (let index = 0; index < lines.length; index++) {
    const text = lines[index]!.text.trim();
    if (index === 0 && frontmatter) continue;
    if (frontmatter) { hidden.add(index); if (text === '---') frontmatter = false; continue; }
    const marker = text.match(/^(`{3,}|~{3,})/u)?.[0];
    if (marker) { hidden.add(index); if (!fence) fence = marker; else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null; continue; }
    if (fence || /^ {4}/u.test(lines[index]!.text)) hidden.add(index);
  }
  for (let index = 0; index + 1 < lines.length; index++) {
    if (hidden.has(index) || hidden.has(index + 1) || !hasPipe(lines[index]!.text)) continue;
    const headers = splitRow(lines[index]!.text), alignmentCells = splitRow(lines[index + 1]!.text);
    if (headers.length !== alignmentCells.length || headers.length > 50) continue;
    const parsed = alignmentCells.map(delimiter);
    if (parsed.some((item) => item === null)) continue;
    const alignments = parsed as TableAlignment[];
    const rows: string[][] = [];
    let end = index + 1, irregular = false;
    for (let next = index + 2; next < lines.length && !hidden.has(next) && hasPipe(lines[next]!.text); next++) {
      const cells = splitRow(lines[next]!.text);
      if (cells.length !== headers.length || rows.length >= 1000) { irregular = true; break; }
      rows.push(cells); end = next;
    }
    if (irregular) continue;
    const location = { from: lines[index]!.from, to: lines[end]!.to, table: { headers, alignments, rows } };
    if (offset >= location.from && offset <= location.to) return location;
    index = end;
  }
  return null;
}
function escapeCell(input: string): string { let output = ''; for (let index = 0; index < input.length; index++) { if (input[index] === '\\' && index + 1 < input.length) { output += input[index] + input[++index]!; continue; } output += input[index] === '|' ? '\\|' : input[index]; } return output; }
export function serializeMarkdownTable(table: MarkdownTable): string {
  validate(table);
  const widths = table.headers.map((header, column) => Math.max(3, header.length, ...table.rows.map((row) => row[column]!.length)));
  const row = (cells: readonly string[]) => `| ${cells.map((cell, index) => escapeCell(cell).padEnd(widths[index]!)).join(' | ')} |`;
  const alignment = table.alignments.map((value, index) => value === 'center' ? `:${'-'.repeat(Math.max(3, widths[index]! - 2))}:` : value === 'left' ? `:${'-'.repeat(Math.max(3, widths[index]! - 1))}` : value === 'right' ? `${'-'.repeat(Math.max(3, widths[index]! - 1))}:` : '-'.repeat(Math.max(3, widths[index]!)));
  return [row(table.headers), row(alignment), ...table.rows.map(row)].join('\n');
}

/** RFC 4180-style CSV with comma delimiters. Multiline values are rejected because GFM cells are single lines. */
export function parseCsvTable(csv: string): MarkdownTable {
  if (!csv.trim() || csv.length > 1_000_000) throw new Error('Enter CSV under 1 MiB.');
  const rows: string[][] = [], row: string[] = [];
  let cell = '', quoted = false, closedQuote = false;
  const pushCell = () => { if (/[\r\n]/u.test(cell)) throw new Error('Multiline CSV cells cannot be represented in a Markdown table.'); row.push(cell.trim()); cell = ''; closedQuote = false; };
  const pushRow = () => { pushCell(); rows.push([...row]); row.length = 0; if (rows.length > 1001) throw new Error('CSV has more than 1,000 data rows.'); };
  for (let index = 0; index < csv.length; index++) {
    const character = csv[index]!;
    if (quoted) {
      if (character === '"') { if (csv[index + 1] === '"') { cell += '"'; index++; } else { quoted = false; closedQuote = true; } }
      else cell += character;
      continue;
    }
    if (character === '"') { if (cell || closedQuote) throw new Error('Invalid CSV quote.'); quoted = true; continue; }
    if (character === ',') { pushCell(); continue; }
    if (character === '\r' || character === '\n') { if (character === '\r' && csv[index + 1] === '\n') index++; pushRow(); continue; }
    if (closedQuote) throw new Error('Unexpected text after a quoted CSV cell.');
    cell += character;
  }
  if (quoted) throw new Error('CSV contains an unclosed quote.');
  if (cell || row.length || closedQuote) pushRow();
  const headers = rows.shift();
  if (!headers?.length || headers.length > 50 || rows.some((item) => item.length !== headers.length)) throw new Error('CSV rows need the same 1–50 columns as the header.');
  const table = { headers, alignments: headers.map(() => 'none' as const), rows };
  validate(table); return table;
}
export function markdownTableToCsv(table: MarkdownTable): string {
  validate(table);
  const quote = (cell: string) => { const text = cell.replace(/\\\|/gu, '|'); return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text; };
  return [table.headers, ...table.rows].map((row) => row.map(quote).join(',')).join('\r\n');
}
export function addTableRow(table: MarkdownTable, index = table.rows.length): MarkdownTable { validate(table); if (index < 0 || index > table.rows.length) throw new Error('Row index is outside the table.'); const rows = table.rows.map((row) => [...row]); rows.splice(index, 0, table.headers.map(() => '')); return { ...table, rows }; }
export function removeTableRow(table: MarkdownTable, index: number): MarkdownTable { validate(table); if (index < 0 || index >= table.rows.length) throw new Error('Row index is outside the table.'); return { ...table, rows: table.rows.filter((_, row) => row !== index) }; }
export function addTableColumn(table: MarkdownTable, index = table.headers.length): MarkdownTable { validate(table); if (index < 0 || index > table.headers.length || table.headers.length >= 50) throw new Error('Column index is outside the table.'); const headers = [...table.headers], alignments = [...table.alignments], rows = table.rows.map((row) => [...row]); headers.splice(index, 0, 'Column'); alignments.splice(index, 0, 'none'); for (const row of rows) row.splice(index, 0, ''); return { headers, alignments, rows }; }
export function removeTableColumn(table: MarkdownTable, index: number): MarkdownTable { validate(table); if (index < 0 || index >= table.headers.length || table.headers.length === 1) throw new Error('A table needs at least one column.'); return { headers: table.headers.filter((_, column) => column !== index), alignments: table.alignments.filter((_, column) => column !== index), rows: table.rows.map((row) => row.filter((_, column) => column !== index)) }; }
export function moveTableColumn(table: MarkdownTable, from: number, to: number): MarkdownTable { validate(table); if (from < 0 || to < 0 || from >= table.headers.length || to >= table.headers.length) throw new Error('Column index is outside the table.'); const move = <T>(values: T[]) => { const result = [...values]; result.splice(to, 0, result.splice(from, 1)[0]!); return result; }; return { headers: move(table.headers), alignments: move(table.alignments), rows: table.rows.map(move) }; }
export function setTableAlignment(table: MarkdownTable, column: number, alignment: TableAlignment): MarkdownTable { validate(table); if (column < 0 || column >= table.headers.length || !['none', 'left', 'center', 'right'].includes(alignment)) throw new Error('Invalid column alignment.'); return { ...table, alignments: table.alignments.map((item, index) => index === column ? alignment : item) }; }
export function sortTableRows(table: MarkdownTable, column: number, direction: 'asc' | 'desc'): string[][] { validate(table); if (column < 0 || column >= table.headers.length) throw new Error('Column index is outside the table.'); const sign = direction === 'asc' ? 1 : -1; return table.rows.map((row, index) => ({ row, index })).sort((a, b) => sign * a.row[column]!.localeCompare(b.row[column]!, undefined, { numeric: true, sensitivity: 'base' }) || a.index - b.index).map((item) => item.row); }
