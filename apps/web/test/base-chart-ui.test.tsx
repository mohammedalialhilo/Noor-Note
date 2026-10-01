// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultBaseChart, vaultNoteSchema } from '@noor-note/core';
import { toNoteEntry } from '@noor-note/storage';
import { BaseChartView } from '../src/components/BaseChartView';

afterEach(cleanup);
describe('Base chart accessibility', () => {
  const vaultId = crypto.randomUUID();
  const notes = [
    { title: 'Alpha', properties: { x: 1, y: 3, category: 'North' } },
    { title: 'Beta', properties: { x: 2, y: 5, category: 'South' } },
  ].map((item) => toNoteEntry(vaultNoteSchema.parse({ id: crypto.randomUUID(), vaultId, folderId: null, path: `/${item.title}.md`, title: item.title, markdown: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null, trashGroupId: null, aliases: [], properties: item.properties, revision: 1, checksum: '0'.repeat(64) })));
  it('shows a chart and a visible data table with the same aggregated values', () => {
    render(<BaseChartView notes={notes} config={{ ...defaultBaseChart, groupField: 'property:category' }} folders={[]} title="Regions" onOpenNote={vi.fn()} />);
    expect(screen.getByRole('table', { name: /Regions: data table/u })).toBeTruthy();
    expect(screen.getByRole('row', { name: /North 1 1/u })).toBeTruthy();
    expect(screen.getByRole('row', { name: /South 1 1/u })).toBeTruthy();
    expect(document.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
  });
  it('provides keyboard-accessible note links in the scatter data table', () => {
    const open = vi.fn();
    render(<BaseChartView notes={notes} config={{ ...defaultBaseChart, kind: 'scatter', xField: 'property:x', yField: 'property:y' }} folders={[]} title="Positions" onOpenNote={open} />);
    fireEvent.click(screen.getByRole('button', { name: 'Alpha' }));
    expect(open).toHaveBeenCalledWith(notes[0]!.id);
    expect(screen.getByRole('row', { name: /Alpha 1 3/u })).toBeTruthy();
  });
});
