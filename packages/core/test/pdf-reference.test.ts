import { describe, expect, it } from 'vitest';
import { attachmentSchema, collectPdfBacklinks, isPdfAttachment, makeVaultNote, parsePdfReference, pdfAnnotationSchema, pdfReferenceHref, pdfReferenceLink, resolvePdfAttachment } from '../src/index';

const vaultId = crypto.randomUUID();
const attachment = attachmentSchema.parse({
  id: crypto.randomUUID(), vaultId, folderId: null, path: '/Research/source file.pdf', name: 'source file.pdf',
  mime: 'application/pdf', size: 12, storage: 'indexeddb', createdAt: '2026-09-24T12:00:00.000Z',
  updatedAt: '2026-09-24T12:00:00.000Z', deletedAt: null, trashGroupId: null,
});

describe('portable PDF references', () => {
  it('generates a relative Markdown link with stable PDF and annotation IDs', () => {
    const annotationId = crypto.randomUUID();
    const href = pdfReferenceHref('/Research/Notes/Quote.md', attachment, 7, annotationId);
    expect(href).toBe(`../source%20file.pdf#page=7&noor-pdf=${attachment.id}&annotation=${annotationId}`);
    expect(parsePdfReference(href)).toEqual({ path: '../source%20file.pdf', page: 7, attachmentId: attachment.id, annotationId });
    expect(resolvePdfAttachment(parsePdfReference(href)!, '/Research/Notes/Quote.md', [attachment])?.id).toBe(attachment.id);
  });

  it('resolves a renamed PDF by stable ID and falls back to the relative path for plain Markdown links', () => {
    const old = parsePdfReference(pdfReferenceHref('/Research/Quote.md', attachment, 3))!;
    const renamed = attachmentSchema.parse({ ...attachment, path: '/Research/new name.pdf', name: 'new name.pdf' });
    expect(resolvePdfAttachment(old, '/Research/Quote.md', [renamed])?.id).toBe(attachment.id);
    expect(resolvePdfAttachment(parsePdfReference('../source%20file.pdf#page=2')!, '/Research/Notes/Quote.md', [attachment])?.id).toBe(attachment.id);
    expect(parsePdfReference('https://example.com/source.pdf#page=1')).toBeNull();
    expect(parsePdfReference('source.pdf#annotation=bad')).toBeNull();
    expect(() => pdfReferenceHref('/Quote.md', attachment, 0)).toThrow();
    expect(isPdfAttachment({ mime: 'application/octet-stream', name: 'Scan.pdf' })).toBe(true);
    expect(isPdfAttachment({ mime: 'image/png', name: 'Scan.pdf' })).toBe(false);
  });

  it('finds note backlinks for an exact annotation after a case-only path difference', async () => {
    const annotationId = crypto.randomUUID();
    const note = await makeVaultNote({ vaultId, title: 'Quote', path: '/Research/Quote.md', markdown: `Text\n${pdfReferenceLink('/Research/Quote.md', attachment, 4, annotationId, 'A [source]')}\n` });
    const annotation = pdfAnnotationSchema.parse({ id: annotationId, vaultId, attachmentId: attachment.id, page: 4, kind: 'highlight', quote: 'Text', comment: '', color: 'yellow', rects: [{ x: .1, y: .2, width: .3, height: .05 }], createdAt: note.createdAt, updatedAt: note.updatedAt });
    expect(collectPdfBacklinks([note], attachment, annotation)).toMatchObject([{ noteId: note.id, line: 2, page: 4, annotationId }]);
    const plain = await makeVaultNote({ vaultId, title: 'Plain', path: '/Research/Plain.md', markdown: '[Source](SOURCE%20FILE.pdf#page=2)' });
    expect(collectPdfBacklinks([plain], attachment)).toMatchObject([{ noteId: plain.id, page: 2 }]);
  });
});
