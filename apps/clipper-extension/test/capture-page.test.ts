// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractPage } from '../src/capture-page';
import { handoffUrl, normalizeAppOrigin, permissionPattern } from '../src/handoff';

describe('web clip extraction', () => {
  it('extracts article content and metadata while removing navigation and unsafe links', () => {
    const page = document.implementation.createHTMLDocument('Fallback title');
    page.head.innerHTML = `<meta property="og:title" content="Useful research"><meta property="og:site_name" content="Example"><meta name="description" content="The summary"><meta property="og:image" content="/lead.jpg"><script type="application/ld+json">{"@type":"Article","author":{"name":"Ada"},"datePublished":"2026-09-30"}</script>`;
    page.body.innerHTML = `<nav>Navigation noise</nav><article><h1>Useful research</h1><p>${'This is the meaningful article text. '.repeat(8)}</p><a href="javascript:alert(1)">Unsafe</a><a href="/more">More research</a></article><footer>Footer noise</footer>`;
    const clip = extractPage(page, 'https://example.test/story', { mode: 'article' });
    expect(clip.title).toBe('Useful research');
    expect(clip.author).toBe('Ada');
    expect(clip.publishedAt).toBe('2026-09-30');
    expect(clip.mainImage).toBe('https://example.test/lead.jpg');
    expect(clip.markdown).toContain('meaningful article text');
    expect(clip.markdown).toContain('https://example.test/more');
    expect(clip.markdown).not.toContain('Navigation noise');
    expect(clip.markdown).not.toContain('Footer noise');
    expect(clip.markdown).not.toContain('javascript:');
  });
  it('captures a selection and validates the configured app origin', () => {
    document.title = 'Selected page';
    document.body.innerHTML = '<p id="selection">Selected words here</p>';
    const range = document.createRange();
    range.selectNodeContents(document.getElementById('selection')!);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    const clip = extractPage(document, 'https://example.test/selection', { mode: 'selection' });
    expect(clip.markdown).toBe('Selected words here');
    expect(normalizeAppOrigin('https://notes.example.test/')).toBe('https://notes.example.test');
    expect(permissionPattern('http://localhost:3000')).toBe('http://localhost/*');
    expect(handoffUrl('https://notes.example.test', crypto.randomUUID())).toContain('/clipper/?ticket=');
    expect(() => normalizeAppOrigin('http://untrusted.example.test')).toThrow();
    expect(() => normalizeAppOrigin('https://notes.example.test/other')).toThrow();
  });
  it('keeps the Chromium and Firefox background formats separate', () => {
    const chromeManifest = JSON.parse(readFileSync(resolve(process.cwd(), 'manifest.chrome.json'), 'utf8')) as Record<string, unknown>;
    const firefoxManifest = JSON.parse(readFileSync(resolve(process.cwd(), 'manifest.firefox.json'), 'utf8')) as Record<string, unknown>;
    expect(chromeManifest.manifest_version).toBe(3);
    expect(chromeManifest.background).toEqual({ service_worker: 'background.js' });
    expect(firefoxManifest.background).toEqual({ scripts: ['background.js'] });
    expect(chromeManifest).not.toHaveProperty('host_permissions');
  });
});
