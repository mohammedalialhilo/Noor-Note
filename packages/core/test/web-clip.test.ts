import { describe, expect, it } from 'vitest';
import { clipBody, clipFrontmatter, webClipSchema } from '../src/web-clip';

const clip = webClipSchema.parse({
  version: 1, mode: 'article', url: 'https://example.test/story', title: 'The story',
  author: 'A Writer', publishedAt: '2026-09-30', site: 'Example', description: 'A short summary',
  language: 'en', mainImage: null, favicon: null, schemaType: 'Article',
  markdown: '## A heading\n\nUseful text.', imageUrl: null, highlights: [], screenshotDataUrl: null,
  capturedAt: '2026-09-30T12:00:00.000Z',
});
describe('portable web clips', () => {
  it('keeps Markdown content and source metadata portable', () => {
    expect(clipBody(clip)).toContain('## A heading\n\nUseful text.');
    expect(clipBody(clip)).toContain('Source: [The story](https://example.test/story)');
    const frontmatter = clipFrontmatter(clip, ['#research', 'reading/ideas'], { status: 'To read' });
    expect(frontmatter).toContain('author: A Writer');
    expect(frontmatter).toContain('reading/ideas');
    expect(frontmatter).toContain('status: To read');
  });
  it('rejects unsafe URLs and invalid property names', () => {
    expect(() => webClipSchema.parse({ ...clip, url: 'javascript:alert(1)' })).toThrow();
    expect(() => clipFrontmatter(clip, [], { 'bad key': 'bad' })).toThrow();
    expect(() => clipFrontmatter(clip, ['bad tag'], {})).toThrow();
  });
  it('formats multiple highlights as separate quotes', () => {
    const highlights = [
      { id: crypto.randomUUID(), text: 'First passage', capturedAt: clip.capturedAt },
      { id: crypto.randomUUID(), text: 'Second passage', capturedAt: clip.capturedAt },
    ];
    expect(clipBody({ ...clip, mode: 'highlights', markdown: '', highlights })).toContain('### Highlight 2\n\n> Second passage');
  });
});
