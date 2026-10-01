// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeManager } from '../src/components/ThemeManager';
import { ThemeProvider } from '../src/theme/ThemeProvider';

const theme = {
  id: 'example.amber', name: 'Amber notes', version: '1.0.0', author: 'Example', base: 'light',
  tokens: {
    '--nn-bg': '#faf7f0', '--nn-surface': '#ffffff', '--nn-text': '#202520',
    '--nn-text-muted': '#555e55', '--nn-border': '#c8cec6', '--nn-accent': '#765033',
    '--nn-editor-bg': '#ffffff', '--nn-editor-text': '#202520', '--nn-syntax-heading': '#765033',
    '--nn-graph-node': '#765033', '--nn-canvas-bg': '#faf7f0', '--nn-base-bg': '#ffffff',
  },
};

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }));
  vi.stubGlobal('confirm', () => true);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.getElementById('noor-note-custom-theme')?.remove(); document.getElementById('noor-note-css-snippets')?.remove(); });

describe('Theme Manager', () => {
  it('ignores malformed stored appearance data', () => {
    localStorage.setItem('noor-note-appearance', JSON.stringify({ themes: [{ ...theme, tokens: { ...theme.tokens, '--nn-bg': 'url(https://example.test)' } }], activeThemeId: theme.id, snippets: [] }));
    render(<ThemeProvider><ThemeManager /></ThemeProvider>);
    expect(screen.getByText('No local themes installed.')).toBeTruthy();
    expect(document.getElementById('noor-note-custom-theme')?.textContent).toBe('');
  });
  it('installs and activates a local theme, then manages a CSS snippet', async () => {
    render(<ThemeProvider><ThemeManager /></ThemeProvider>);
    const file = new File([JSON.stringify(theme)], 'amber.noor-theme.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: async () => JSON.stringify(theme) });
    fireEvent.change(screen.getByLabelText('Install local theme JSON'), { target: { files: [file] } });
    expect(await screen.findByText(/12 color tokens/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Install theme' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Enable' }));
    await waitFor(() => expect(document.getElementById('noor-note-custom-theme')?.textContent).toContain('--nn-bg:#faf7f0'));
    fireEvent.change(screen.getByLabelText('Snippet name'), { target: { value: 'Editor size' } });
    fireEvent.change(screen.getByLabelText('CSS'), { target: { value: '.cm-content { font-size: 16px; }' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add snippet' }));
    await waitFor(() => expect(document.getElementById('noor-note-css-snippets')?.textContent).toContain('font-size:16px'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Disable' })[1]!);
    await waitFor(() => expect(document.getElementById('noor-note-css-snippets')?.textContent).toBe(''));
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(document.getElementById('noor-note-custom-theme')?.textContent).toBe(''));
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]!);
    await waitFor(() => expect(screen.getByText('No local themes installed.')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(screen.queryByText('Editor size')).toBeNull());
  });
});
