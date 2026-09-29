import { describe, expect, it } from 'vitest';
import { SearchEngine, makeOcrSearchDocument, makeSearchDocument, parseSearchQuery, type SearchDocument } from '../src';
import { attachmentSchema, makeVaultNote, ocrRecordSchema } from '@noor-note/core';

function document(index: number, markdown: string): SearchDocument {
  return { id: String(index), vaultId: 'vault', revision: 1, title: `Note ${index}`, path: `/Research/Note-${index}.md`, markdown, tags: index % 2 ? ['work'] : [], properties: { status: index % 2 ? 'Draft' : 'Done', owner: 'Ali' }, links: index % 3 ? ['Project Alpha'] : [], tasks: index % 5 ? ['incomplete Review'] : [], headings: ['Overview'], createdAt: '2026-02-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', hasAttachment: index % 7 === 0 };
}

describe('offline search', () => {
  it('parses phrases, prefix, fuzzy, filters, dates, and optional regex', () => {
    expect(parseSearchQuery('"Project Alpha" note* revie~ tag:work path:Research status:Draft property="Ali" before:2026-09-01 after:2026-01-01 has:task links:"Project Alpha" is:incomplete regex:/alpha/ sort:updated')).toMatchObject({ sort: 'updated', clauses: expect.arrayContaining([{ kind: 'phrase', value: 'project alpha' }, { kind: 'prefix', value: 'note' }, { kind: 'fuzzy', value: 'revie' }, { kind: 'field', field: 'propertyExact', value: 'ali' }]) });
    expect(() => parseSearchQuery('has:unknown')).toThrow();
    expect(() => parseSearchQuery('regex:/(a+)+/')).toThrow();
  });

  it('indexes Markdown, headings, tasks, links, tags, properties and ranks results', async () => {
    const note = await makeVaultNote({ vaultId: crypto.randomUUID(), title: 'Project Alpha', markdown: '---\ntags: [work/research]\nstatus: Draft\n---\n# Overview\n- [ ] Review proposal\nSee [[Project Beta]] and ![[chart.png]].' });
    const engine = new SearchEngine();
    engine.upsert(makeSearchDocument(note));
    for (const query of ['project', '"Review proposal"', 'over*', 'ovrview~', 'tag:work', 'status:draft', 'property="Draft"', 'heading:Overview', 'links:"Project Beta"', 'has:attachment', 'has:task', 'is:incomplete', 'before:2099-01-01']) expect(engine.search(query)).toHaveLength(1);
    expect(engine.search('after:2099-01-01')).toHaveLength(0);
    expect(engine.search('Review')[0]).toMatchObject({ title: 'Project Alpha', path: '/Project Alpha.md', excerpt: expect.stringContaining('Review'), highlights: [{ start: expect.any(Number), end: expect.any(Number) }] });
    expect(engine.search('status:draft')[0]?.properties).toMatchObject([{ name: 'status', value: 'Draft' }]);
  });

  it('updates and removes indexed documents without rebuilding others', () => {
    const engine = new SearchEngine();
    engine.upsert(document(1, 'orchid')); engine.upsert(document(2, 'orchid'));
    expect(engine.search('orchid')).toHaveLength(2);
    engine.upsert({ ...document(1, 'marigold'), revision: 2 });
    expect(engine.search('orchid')).toHaveLength(1);
    expect(engine.search('marigold')).toHaveLength(1);
    engine.remove('2');
    expect(engine.search('orchid')).toHaveLength(0);
    expect(engine.size).toBe(1);
  });

  it('treats property equals as exact and keeps title-only matches highlighted', () => {
    const engine = new SearchEngine();
    engine.upsert({ ...document(1, 'A different body'), title: 'Constellation', properties: { owner: 'Alina' } });
    expect(engine.search('property="Ali"')).toHaveLength(0);
    expect(engine.search('property="Alina"')).toHaveLength(1);
    expect(engine.search('constellation')[0]).toMatchObject({ excerpt: 'Constellation', highlights: [{ start: 0, end: 13 }] });
  });

  it('searches five thousand indexed notes and combines filters', () => {
    const engine = new SearchEngine();
    for (let index = 0; index < 5_000; index += 1) engine.upsert(document(index, index === 4_321 ? 'Unique constellation insight' : 'Common research notes'));
    expect(engine.size).toBe(5_000);
    expect(engine.search('constellation')).toMatchObject([{ id: '4321' }]);
    expect(engine.search('common tag:work status:Draft has:task').length).toBe(100);
    expect(engine.search('common tag:work status:Draft has:task sort:title', 500)).toHaveLength(500);
  });

  it('indexes corrected OCR in multiple scripts as an attachment result', () => {
    const vaultId = crypto.randomUUID(), attachmentId = crypto.randomUUID();
    const timestamp = '2026-09-25T12:00:00.000Z';
    const attachment = attachmentSchema.parse({ id: attachmentId, vaultId, folderId: null, path: '/Scans/receipt.png', name: 'receipt.png', mime: 'image/png', size: 42, storage: 'indexeddb', createdAt: timestamp, updatedAt: timestamp, deletedAt: null, trashGroupId: null });
    const record = ocrRecordSchema.parse({ id: crypto.randomUUID(), vaultId, attachmentId, page: 1, providerId: 'tesseract-browser', languages: ['swe', 'ara'], detectedText: 'fakfura', text: 'faktura فاتورة', confidence: 74, createdAt: timestamp, updatedAt: timestamp });
    const engine = new SearchEngine();
    engine.upsert(makeOcrSearchDocument(record, attachment));
    expect(engine.search('faktura has:ocr')).toMatchObject([{ kind: 'ocr', attachmentId, page: 1, excerpt: expect.stringContaining('faktura') }]);
    expect(engine.search('فاتورة')).toHaveLength(1);
    expect(engine.search('fakfura')).toHaveLength(0);
    expect(engine.search('is:empty')).toHaveLength(0);
  });
});
