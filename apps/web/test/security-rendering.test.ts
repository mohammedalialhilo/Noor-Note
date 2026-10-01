import { describe, expect, it } from 'vitest';
import { renderPublicHtml } from '../netlify/functions/publish';
import { renderPrivateShare } from '../netlify/functions/private-share';
import type { PublicPage, PublicSite } from '../src/lib/publishing';

const vault = crypto.randomUUID();
const note = crypto.randomUUID();
const malicious = '# Heading\n\n<script>globalThis.stolen=true</script>\n\n[Run](javascript:alert(1))\n\n![Load](data:text/html,<script>bad()</script>)';

describe('untrusted Markdown in server renderers', () => {
  it('keeps raw HTML and unsafe URL schemes inert in private shares', () => {
    const html = renderPrivateShare('<img src=x onerror=alert(1)>', malicious, false, 'a'.repeat(64), null);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<script>globalThis.stolen=true</script>');
    expect(html).not.toMatch(/href="javascript:|src="data:text\/html/iu);
  });

  it('keeps raw HTML and unsafe URL schemes inert on public pages', () => {
    const site: PublicSite = {
      vault_id: vault, slug: 'research', title: '<img src=x onerror=alert(1)>',
      description: '', theme: 'system', robots: 'noindex', navigation: [],
      homepage_slug: null, graph_enabled: false, logo_path: null, favicon_path: null,
    };
    const page: PublicPage = {
      vault_id: vault, note_id: note, slug: 'page', title: '<script>bad()</script>',
      source_path: '/page.md', aliases: [], markdown: malicious, assets: {},
      description: '', published_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    const html = renderPublicHtml(new Request('https://notes.example.test/p/research/page'), site, page, [page], false);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;script&gt;bad()&lt;/script&gt;');
    expect(html).not.toContain('<script>globalThis.stolen=true</script>');
    expect(html).not.toMatch(/href="javascript:|src="data:text\/html/iu);
  });
});
