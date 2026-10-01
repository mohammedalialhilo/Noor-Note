import { describe, expect, it } from 'vitest';
import { renderWebClipTemplate, webClipSchema } from '../src';

const clip = webClipSchema.parse({
  version: 1, mode: 'article', url: 'https://example.test/research', title: 'Research story',
  author: 'Ada Lovelace', publishedAt: '2026-09-30', site: 'Example', description: 'A useful summary', language: 'en',
  mainImage: null, favicon: null, schemaType: 'Article', markdown: '## Finding\n\nArticle text.',
  imageUrl: null, highlights: [], screenshotDataUrl: null, capturedAt: '2026-09-30T12:00:00.000Z',
});
const options = { title: 'Saved research', path: '/Reading/Saved research.md', tags: ['research'], properties: { status: 'To read' } };

describe('web clip templates', () => {
  it('renders all clip variables with captured date and distinct content', () => {
    const output = renderWebClipTemplate('{{title}}|{{url}}|{{author}}|{{content}}|{{selection}}|{{highlights}}|{{published}}|{{domain}}|{{description}}|{{date}}|{{time}}', clip, options);
    expect(output).toContain('Saved research|https://example.test/research|Ada Lovelace|## Finding\n\nArticle text.|||2026-09-30|example.test|A useful summary|2026-09-30|');
    expect(output.match(/Article text\./gu)).toHaveLength(1);
  });

  it('supports safe conditions, filters, date formatting, and property formatting', () => {
    const template = '{{if(eq(property("status"), "To read"), "Queued", "Done")}}|{{upper(author)}}|{{replace(domain, ".", "-")}}|{{truncate(description, 8)}}|{{formatDate(published, "yyyy/MM/dd")}}|{{formatProperty("tags", "; ")}}|{{default(selection, "None")}}|{{yaml(author)}}';
    expect(renderWebClipTemplate(template, clip, options)).toContain('Queued|ADA LOVELACE|example-test|A useful…|2026/09/30|research|None|"Ada Lovelace"');
    expect(() => renderWebClipTemplate('{{constructor.constructor("return 1")()}}', clip, options)).toThrow();
    expect(() => renderWebClipTemplate('{{formatDate("invalid", "yyyy")}}', clip, options)).toThrow('Invalid template date');
    expect(() => renderWebClipTemplate('{{replace(title, "", "x")}}', clip, options)).toThrow();
  });

  it('keeps clip content and provenance when a template omits them', () => {
    const output = renderWebClipTemplate('# {{title}}', clip, options);
    expect(output).toContain('Article text.');
    expect(output).toContain('Source: [Research story](https://example.test/research)');
  });

  it('keeps selection and highlights separate from article content', () => {
    const selected = renderWebClipTemplate('{{selection}}', { ...clip, mode: 'selection', markdown: 'Selected words' }, options);
    expect(selected).toContain('Selected words');
    expect(selected).not.toContain('> Selected words');
    const highlighted = renderWebClipTemplate('{{highlights}}', { ...clip, mode: 'highlights', markdown: '', highlights: [
      { id: crypto.randomUUID(), text: 'First insight', capturedAt: clip.capturedAt },
    ] }, options);
    expect(highlighted).toContain('### Highlight 1\n\n> First insight');
    expect(highlighted).toContain('Source:');
  });
});
