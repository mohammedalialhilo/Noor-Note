import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pluginBundleSchema } from '@noor-note/plugin-sdk';
import { DexieVaultRepository } from '@noor-note/storage';
import { PluginHost, buildPluginSandboxDocument } from '../src/lib/plugin-host';
import { PluginStore, type InstalledPlugin } from '../src/lib/plugin-store';
import { developmentPluginFile, localPluginFile } from '../src/lib/plugin-package-source';

const names: string[] = [];
const bundle = pluginBundleSchema.parse({
  manifest: { id: 'example.reading', name: 'Reading tools', version: '1.0.0', description: 'Read local notes.', author: 'Example', minimumNoorVersion: '0.1.0', permissions: ['notes.read', 'settings', 'network'], entryPoints: { sandbox: 'main.js' }, networkOrigins: ['https://example.test/'] },
  files: { 'main.js': 'noorNote.register({kind:"status-bar",id:"state",title:"State",text:"Ready"});' },
});
beforeEach(() => vi.stubGlobal('window', {}));
afterEach(async () => { for (const name of names.splice(0)) await Dexie.delete(name); vi.unstubAllGlobals(); });

describe('plugin host capabilities', () => {
  it('rejects a local bundle that changes after permission review', async () => {
    const name = `plugin-review-${crypto.randomUUID()}`; names.push(name);
    const host = new PluginHost(name);
    let content = JSON.stringify(bundle);
    const source = developmentPluginFile({ name: 'reading.json', getFile: async () => new File([content], 'reading.json') });
    try {
      const reviewed = await source.load();
      content = JSON.stringify({ ...bundle, manifest: { ...bundle.manifest, permissions: [...bundle.manifest.permissions, 'clipboard'] } });
      await expect(host.installFromSource(source, reviewed, ['settings'])).rejects.toThrow('changed during review');
      expect(host.getSnapshot().installations).toEqual([]);
    } finally { host.stop(); }
  });
  it('reloads a development file while retaining grants and rejects permission changes', async () => {
    const name = `plugin-reload-${crypto.randomUUID()}`; names.push(name);
    const host = new PluginHost(name);
    let content = JSON.stringify(bundle);
    const source = developmentPluginFile({ name: 'reading.json', getFile: async () => new File([content], 'reading.json') });
    try {
      await host.installFromSource(source, bundle, ['settings']);
      expect(host.canReloadFromSource(bundle.manifest.id)).toBe(true);
      await host.setEnabled(bundle.manifest.id, false);
      content = JSON.stringify({ ...bundle, manifest: { ...bundle.manifest, version: '1.0.1' } });
      await host.reloadFromSource(bundle.manifest.id);
      expect(host.getSnapshot().installations[0]).toMatchObject({ grants: ['settings'], enabled: false, bundle: { manifest: { version: '1.0.1' } } });
      content = JSON.stringify({ ...bundle, manifest: { ...bundle.manifest, networkOrigins: ['https://other.test/'] } });
      await expect(host.reloadFromSource(bundle.manifest.id)).rejects.toThrow('Reinstall and review');
      expect(host.getSnapshot().installations[0]?.bundle.manifest.version).toBe('1.0.1');
      host.reload(bundle.manifest.id);
      await host.remove(bundle.manifest.id);
      expect(host.canReloadFromSource(bundle.manifest.id)).toBe(false);
    } finally { host.stop(); }
  });
  it('validates local files before exposing them as install candidates', async () => {
    const source = localPluginFile(new File([JSON.stringify(bundle)], 'reading.json'));
    expect(source.canRefresh).toBe(false);
    expect((await source.load()).manifest.id).toBe(bundle.manifest.id);
    await expect(localPluginFile(new File(['{'], 'bad.json')).load()).rejects.toThrow('not valid JSON');
  });
  it('encodes plugin source inside an opaque-frame document with a restrictive CSP', () => {
    const document = buildPluginSandboxDocument('</script><img src="https://evil.test/x">');
    expect(document).toContain("default-src 'none'; script-src data:; connect-src 'none'");
    expect(document).not.toContain('<img src="https://evil.test/x">');
    expect(document.match(/<script src="data:text\/javascript;base64,/gu)).toHaveLength(2);
  });
  it('ships an installable date-stamp plugin bundle', () => {
    const sample: unknown = JSON.parse(readFileSync('../../examples/plugins/date-stamp.noor-plugin.json', 'utf8'));
    expect(pluginBundleSchema.parse(sample).manifest.permissions).toEqual(['commands', 'editor']);
  });
  it('persists explicit grants and deletes plugin-scoped settings on removal', async () => {
    const name = `plugin-store-${crypto.randomUUID()}`; names.push(name);
    const store = new PluginStore(name);
    try {
      await store.put(bundle, ['settings'], false);
      await store.setSetting(bundle.manifest.id, 'theme', 'quiet');
      expect((await store.list())[0]?.grants).toEqual(['settings']);
      expect(await store.getSetting(bundle.manifest.id, 'theme')).toBe('quiet');
      const saved = await store.plugins.get(bundle.manifest.id);
      expect(saved).toBeDefined();
      await store.plugins.put({ ...saved!, enabled: 'yes' } as unknown as InstalledPlugin);
      expect(await store.list()).toEqual([]);
      await store.removePlugin(bundle.manifest.id);
      expect(await store.list()).toEqual([]);
      expect(await store.getSetting(bundle.manifest.id, 'theme')).toBeNull();
    } finally { store.close(); }
  });

  it('enforces note grants and active-vault ownership before returning Markdown', async () => {
    const vaultName = `plugin-vault-${crypto.randomUUID()}`, pluginName = `plugin-host-${crypto.randomUUID()}`;
    names.push(vaultName, pluginName);
    const repository = new DexieVaultRepository(vaultName);
    const host = new PluginHost(pluginName);
    try {
      const vault = await repository.initialize();
      const note = await repository.createNote(vault.id, null, 'Private', '# Secret');
      const installed = { id: bundle.manifest.id, bundle, grants: ['notes.read'] as const, enabled: true, installedAt: new Date().toISOString() };
      host.setEnvironment({ vaultId: vault.id, repository, currentNote: note, canEdit: false, insertText: () => undefined, openSurface: () => undefined, proposeNoteEdit: () => undefined, reportError: () => undefined });
      expect(await host.handleRequest({ ...installed, grants: ['notes.read'] }, 'notes.list', { offset: 0, limit: 1 })).toMatchObject({ total: 1, notes: [{ id: note.id }] });
      expect(await host.handleRequest({ ...installed, grants: ['notes.read'] }, 'notes.read', { noteId: note.id })).toMatchObject({ markdown: '# Secret' });
      await expect(host.handleRequest({ ...installed, grants: [] }, 'notes.read', { noteId: note.id })).rejects.toThrow('Missing notes.read');
      await expect(host.handleRequest({ ...installed, grants: ['notes.read'] }, 'notes.read', { noteId: crypto.randomUUID() })).rejects.toThrow('Note not found');
      host.setEnvironment({ vaultId: crypto.randomUUID(), repository, currentNote: null, canEdit: false, insertText: () => undefined, openSurface: () => undefined, proposeNoteEdit: () => undefined, reportError: () => undefined });
      await expect(host.handleRequest({ ...installed, grants: ['notes.read'] }, 'notes.read', { noteId: note.id })).rejects.toThrow('Note not found');
    } finally { host.stop(); repository.close(); }
  });

  it('keeps network and editor capabilities behind grants and origin checks', async () => {
    const name = `plugin-host-${crypto.randomUUID()}`; names.push(name);
    const host = new PluginHost(name);
    const installed = { id: bundle.manifest.id, bundle, grants: ['network'] as const, enabled: true, installedAt: new Date().toISOString() };
    const fetchSpy = vi.fn(); vi.stubGlobal('fetch', fetchSpy);
    try {
      await expect(host.handleRequest({ ...installed, grants: [] }, 'network.fetch', { url: 'https://example.test/data' })).rejects.toThrow('Missing network');
      await expect(host.handleRequest({ ...installed, grants: ['network'] }, 'network.fetch', { url: 'https://other.test/data' })).rejects.toThrow('not allowed');
      await expect(host.handleRequest({ ...installed, grants: ['network'] }, 'editor.insert', { text: 'x' })).rejects.toThrow('Missing editor');
      await expect(host.handleRequest({ ...installed, grants: ['editor'] }, 'editor.insert', { text: 'x' })).rejects.toThrow('requires a plugin command');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { host.stop(); }
  });
});
