// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findMarkdownTable } from '@noor-note/core';
import { TableEditor } from '../src/components/TableEditor';

afterEach(cleanup);

describe('visual table editor', () => {
  it('edits a source table with controls while temporary sorting leaves Markdown order intact', () => {
    const source = 'Before\n\n| Name | Score |\n| --- | --- |\n| Ada | 10 |\n| Bob | 2 |\n\nAfter';
    const apply = vi.fn((...args: [string, number, number, string]) => args.length === 4);
    render(<TableEditor source={source} cursor={source.indexOf('Ada')} selection={null} onApply={apply} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Column 2 alignment' }), { target: { value: 'center' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add row' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Row 3, column 1' }), { target: { value: 'Cara' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Row 3, column 2' }), { target: { value: '7' } });
    fireEvent.change(within(screen.getByRole('region', { name: 'Temporary sort view' })).getByRole('combobox', { name: 'Column' }), { target: { value: '1' } });
    expect(within(screen.getByRole('table', { name: 'Sorted preview only' })).getAllByRole('row')[1]?.textContent).toContain('Bob');
    fireEvent.click(screen.getByRole('button', { name: 'Apply to Markdown' }));
    expect(apply).toHaveBeenCalledOnce();
    const [expected, from, to, insert] = apply.mock.calls[0]!;
    expect(expected).toBe(source);
    const changed = `${source.slice(0, from)}${insert}${source.slice(to)}`;
    expect(changed).toContain('Before\n\n');
    expect(changed.endsWith('\n\nAfter')).toBe(true);
    const table = findMarkdownTable(changed, changed.indexOf('Ada'))!.table;
    expect(table.alignments).toEqual(['none', 'center']);
    expect(table.rows).toEqual([['Ada', '10'], ['Bob', '2'], ['Cara', '7']]);
  });

  it('converts selected CSV to a valid Markdown table and rejects stale apply', () => {
    const source = 'Name,Comment\nAda,"hello, world"';
    const apply = vi.fn((...args: [string, number, number, string]) => args[0] === '');
    render(<TableEditor source={source} cursor={0} selection={{ from: 0, to: source.length, text: source }} onApply={apply} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Convert CSV' }));
    expect(screen.getByRole('textbox', { name: 'CSV output' })).toHaveProperty('value', 'Name,Comment\nAda,"hello, world"');
    fireEvent.click(screen.getByRole('button', { name: 'Apply to Markdown' }));
    expect(screen.getByRole('alert').textContent).toContain('note changed');
    expect(apply).toHaveBeenCalledOnce();
    expect(findMarkdownTable(apply.mock.calls[0]![3], 0)?.table.rows[0]).toEqual(['Ada', 'hello, world']);
  });
});
