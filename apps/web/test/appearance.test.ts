import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileCssSnippet, compileTheme, parseThemePackage } from '../src/theme/appearance';

export const sampleTheme = {
  id: 'example.amber', name: 'Amber notes', version: '1.0.0', author: 'Example', base: 'light',
  tokens: {
    '--nn-bg': '#faf7f0', '--nn-surface': '#ffffff', '--nn-text': '#202520',
    '--nn-text-muted': '#555e55', '--nn-border': '#c8cec6', '--nn-accent': '#765033',
    '--nn-editor-bg': '#ffffff', '--nn-editor-text': '#202520', '--nn-syntax-heading': '#765033',
    '--nn-graph-node': '#765033', '--nn-canvas-bg': '#faf7f0', '--nn-base-bg': '#ffffff',
  },
};

describe('local themes and CSS snippets', () => {
  it('accepts a readable token package and rejects CSS injection or unknown tokens', () => {
    expect(parseThemePackage(sampleTheme).name).toBe('Amber notes');
    const example: unknown = JSON.parse(readFileSync('../../examples/themes/amber.noor-theme.json', 'utf8'));
    expect(parseThemePackage(example).id).toBe('noor-note.amber');
    expect(compileTheme(parseThemePackage(sampleTheme))).toContain(':root[data-theme]{--nn-bg:#faf7f0');
    expect(() => parseThemePackage({ ...sampleTheme, tokens: { ...sampleTheme.tokens, '--nn-accent': 'red;position:fixed' } })).toThrow();
    expect(() => parseThemePackage({ ...sampleTheme, tokens: { ...sampleTheme.tokens, '--nn-untrusted': '#123456' } })).toThrow();
    expect(() => parseThemePackage({ ...sampleTheme, tokens: { ...sampleTheme.tokens, '--nn-text': '#ffffff' } })).toThrow();
    expect(() => parseThemePackage({ ...sampleTheme, tokens: { ...sampleTheme.tokens, '--nn-editor-text': '#ffffff' } })).toThrow();
  });
  it('reconstructs approved CSS and rejects network, selectors, and interaction rules', () => {
    expect(compileCssSnippet(':root { --nn-accent: #665599; } .cm-content { font-size: 16px; line-height: 1.6; }')).toBe(':root[data-theme]{--nn-accent:#665599}\n.cm-content{font-size:16px;line-height:1.6}');
    for (const css of [
      '@import "https://example.test/style.css";',
      'body { background-image: url(https://example.test/a); }',
      'body button { color: #ffffff; }',
      ':root { --nn-accent: #fff; } body { display: none; }',
      '.cm-content { font-size: 1000px; }',
      'body { color: #fff\\3b display:none; }',
      '.cm-content { color: #fff; } } body { color: #000; }',
    ]) expect(() => compileCssSnippet(css)).toThrow();
  });
});
