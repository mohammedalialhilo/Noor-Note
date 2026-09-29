import { describe, expect, it } from 'vitest';

function onePagePdf(): Uint8Array {
  const content = 'BT /F1 24 Tf 72 700 Td (Noor PDF selection) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(body.length); body += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = body.length;
  body += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => { body += `${String(offset).padStart(10, '0')} 00000 n \n`; });
  body += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(body);
}

describe('PDF.js reader engine', () => {
  it('opens local PDF bytes and extracts selectable text and page dimensions', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = pdfjs.getDocument({ data: onePagePdf(), useSystemFonts: true });
    try {
      const document = await task.promise;
      expect(document.numPages).toBe(1);
      const page = await document.getPage(1);
      expect(page.getViewport({ scale: 1 }).width).toBe(612);
      const text = await page.getTextContent();
      expect(text.items.flatMap((item) => 'str' in item ? [item.str] : []).join(' ')).toContain('Noor PDF selection');
    } finally { await task.destroy(); }
  });
});
