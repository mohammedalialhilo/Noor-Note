// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginManager } from '../src/components/PluginManager';
import { PluginHost } from '../src/lib/plugin-host';

const databaseNames: string[] = [];
const bundle = {
  manifest: {
    id: 'example.manager', name: 'Manager sample', version: '1.0.0', description: 'A local test plugin',
    author: 'Noor tester', minimumNoorVersion: '0.1.0', permissions: ['commands'],
    entryPoints: { sandbox: 'main.js' }, networkOrigins: [],
  },
  files: { 'main.js': "noorNote.register({kind:'command',id:'hello',title:'Hello'},()=>true);" },
};

beforeEach(() => { localStorage.clear(); vi.stubGlobal('confirm', () => true); });
afterEach(async () => { cleanup(); vi.unstubAllGlobals(); for (const name of databaseNames.splice(0)) await Dexie.delete(name); });

describe('Plugin Manager', () => {
  it('reviews a local bundle and manages its lifecycle', async () => {
    const name = `plugin-manager-${crypto.randomUUID()}`; databaseNames.push(name);
    const host = new PluginHost(name);
    try {
      render(<PluginManager host={host} />);
      const file = new File([JSON.stringify(bundle)], 'sample.noor-plugin.json', { type: 'application/json' });
      Object.defineProperty(file, 'text', { value: async () => JSON.stringify(bundle) });
      fireEvent.change(screen.getByLabelText('Choose plugin bundle'), { target: { files: [file] } });
      expect(await screen.findByText(/Source: sample.noor-plugin.json/)).toBeTruthy();
      fireEvent.click(screen.getByRole('checkbox', { name: /commands/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Install with selected permissions' }));
      expect(await screen.findByText('Enabled')).toBeTruthy();
      fireEvent.click(screen.getByText('Metadata and permissions'));
      expect(screen.getByText('Author: Noor tester')).toBeTruthy();
      expect(screen.getByText(/commands — Add commands to the palette \(granted\)/)).toBeTruthy();
      await waitFor(() => expect((screen.getByRole('button', { name: 'Reload' }) as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
      expect(await screen.findByText('Plugin reloaded.', {}, { timeout: 5000 })).toBeTruthy();
      await waitFor(() => expect((screen.getByRole('button', { name: 'Disable' }) as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
      expect(await screen.findByText('Disabled')).toBeTruthy();
      await waitFor(() => expect((screen.getByRole('button', { name: 'Enable' }) as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(screen.getByRole('button', { name: 'Enable' }));
      expect(await screen.findByText('Enabled')).toBeTruthy();
      await waitFor(() => expect((screen.getByRole('button', { name: 'Uninstall' }) as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(screen.getByRole('button', { name: 'Uninstall' }));
      await waitFor(() => expect(screen.getByText('No plugins installed.')).toBeTruthy());
    } finally { host.stop(); }
  });

  it('loads a development file handle and reloads edited source', async () => {
    const name = `plugin-developer-${crypto.randomUUID()}`; databaseNames.push(name);
    const host = new PluginHost(name);
    let content = JSON.stringify(bundle);
    const handle = { name: 'development.json', getFile: async () => {
      const file = new File([content], 'development.json');
      Object.defineProperty(file, 'text', { value: async () => content });
      return file;
    } };
    vi.stubGlobal('showOpenFilePicker', async () => [handle]);
    try {
      render(<PluginManager host={host} />);
      fireEvent.click(screen.getByRole('checkbox', { name: 'Developer mode' }));
      expect(localStorage.getItem('noor-note-plugin-developer-mode')).toBe('true');
      fireEvent.click(screen.getByRole('button', { name: 'Open development bundle' }));
      expect(await screen.findByText(/Source: development.json/)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Install with selected permissions' }));
      expect(await screen.findByRole('button', { name: 'Reload from file' })).toBeTruthy();
      await waitFor(() => expect((screen.getByRole('button', { name: 'Reload from file' }) as HTMLButtonElement).disabled).toBe(false));
      content = JSON.stringify({ ...bundle, manifest: { ...bundle.manifest, version: '1.0.1' } });
      fireEvent.click(screen.getByRole('button', { name: 'Reload from file' }));
      await waitFor(() => expect(host.getSnapshot().installations[0]?.bundle.manifest.version).toBe('1.0.1'));
      await waitFor(() => expect((screen.getByRole('button', { name: 'Reload from file' }) as HTMLButtonElement).disabled).toBe(false));
      content = JSON.stringify({ ...bundle, manifest: { ...bundle.manifest, permissions: ['commands', 'clipboard'] } });
      fireEvent.click(screen.getByRole('button', { name: 'Reload from file' }));
      expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toHaveProperty('textContent', expect.stringContaining('Reinstall and review'));
      expect(host.getSnapshot().installations[0]?.bundle.manifest.version).toBe('1.0.1');
    } finally { host.stop(); }
  }, 15_000);
});
