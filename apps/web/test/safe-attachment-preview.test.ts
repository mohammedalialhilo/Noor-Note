import { describe, expect, it } from 'vitest';
import { safeAttachmentPreview } from '../src/lib/safe-attachment-preview';

describe('untrusted attachment previews', () => {
  it('refuses HTML and SVG bytes even when the attachment claims to be a PDF or image', async () => {
    const html = new Blob(['<script>globalThis.stolen = true</script>'], { type: 'text/html' });
    const svg = new Blob(['<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'], { type: 'image/svg+xml' });
    expect(await safeAttachmentPreview(html, 'application/pdf')).toBeNull();
    expect(await safeAttachmentPreview(html, 'image/png')).toBeNull();
    expect(await safeAttachmentPreview(svg, 'image/svg+xml')).toBeNull();
    expect(await safeAttachmentPreview(svg, 'image/png')).toBeNull();
  });

  it('accepts supported signatures and forces the browser preview MIME', async () => {
    const png = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0])], { type: 'text/html' });
    const pdf = new Blob(['%PDF-1.7\n1 0 obj'], { type: 'text/html' });
    expect((await safeAttachmentPreview(png, 'image/png'))?.type).toBe('image/png');
    expect((await safeAttachmentPreview(pdf, 'application/pdf'))?.type).toBe('application/pdf');
    expect(await safeAttachmentPreview(pdf, 'image/png')).toBeNull();
  });
});
