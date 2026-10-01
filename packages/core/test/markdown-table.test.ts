import { describe, expect, it } from 'vitest';
import { addTableColumn, addTableRow, findMarkdownTable, markdownTableToCsv, moveTableColumn, parseCsvTable, removeTableColumn, removeTableRow, serializeMarkdownTable, setTableAlignment, sortTableRows } from '../src';

describe('Markdown table operations', () => {
  it('locates a GFM table and ignores YAML and fenced code', () => {
    const source = '---\nvalue: "| A | B |"\n---\n\n```md\n| X | Y |\n| --- | --- |\n```\n\n| Name | Value |\n| :--- | ---: |\n| one | 2 |\n| two | 10 |\n\nAfter';
    expect(findMarkdownTable(source, source.indexOf('| X |'))).toBeNull();
    const location = findMarkdownTable(source, source.indexOf('two |'))!;
    expect(location.table).toEqual({ headers: ['Name', 'Value'], alignments: ['left', 'right'], rows: [['one', '2'], ['two', '10']] });
    expect(source.slice(location.from, location.to)).toContain('| :--- | ---: |');
    expect(source.slice(0, location.from)).toContain('```');
    expect(findMarkdownTable('| A | B |\n| --- | --- |\n| only one |', 4)).toBeNull();
  });

  it('adds, removes, moves, aligns, and serializes columns without invalid Markdown', () => {
    const original = parseCsvTable('Name,Score\r\nAda,10\r\nBob,2');
    let table = addTableRow(original);
    expect(table.rows[2]).toEqual(['', '']);
    table = removeTableRow(table, 2);
    table = addTableColumn(table, 1);
    table = { ...table, headers: ['Name', 'Note', 'Score'], rows: table.rows.map((row, index) => [row[0]!, index === 0 ? 'a|b' : 'c,d', row[2]!]) };
    table = setTableAlignment(table, 1, 'center');
    table = moveTableColumn(table, 2, 0);
    expect(table.headers).toEqual(['Score', 'Name', 'Note']);
    expect(table.rows[0]).toEqual(['10', 'Ada', 'a|b']);
    const markdown = serializeMarkdownTable(table);
    expect(markdown).toContain('a\\|b');
    expect(markdown).toContain(':---:');
    expect(findMarkdownTable(markdown, markdown.indexOf('Ada'))?.table.rows[0]).toEqual(['10', 'Ada', 'a\\|b']);
    expect(removeTableColumn(table, 2).headers).toEqual(['Score', 'Name']);
    expect(() => removeTableColumn({ headers: ['Only'], alignments: ['none'], rows: [] }, 0)).toThrow('at least one');
  });

  it('sorts a temporary row view while preserving the source row order', () => {
    const table = parseCsvTable('Name,Score\nAda,10\nBob,2');
    expect(sortTableRows(table, 1, 'asc').map((row) => row[0])).toEqual(['Bob', 'Ada']);
    expect(table.rows.map((row) => row[0])).toEqual(['Ada', 'Bob']);
  });

  it('converts quoted CSV safely and rejects malformed or multiline cells', () => {
    const table = parseCsvTable('Name,Comment\r\nAda,"hello, ""world"""\r\nBob,plain');
    expect(table.rows[0]).toEqual(['Ada', 'hello, "world"']);
    expect(markdownTableToCsv(table)).toBe('Name,Comment\r\nAda,"hello, ""world"""\r\nBob,plain');
    expect(() => parseCsvTable('Name,Age\nAda')).toThrow('same');
    expect(() => parseCsvTable('Name,Text\nAda,"two\nlines"')).toThrow('Multiline');
    expect(() => parseCsvTable('Name,Text\nAda,"unclosed')).toThrow('unclosed');
  });
});
