import { describe, expect, it } from 'vitest';
import { parsePluginMessage, pluginBundleSchema, supportsNoorVersion, validateContribution, validateGrant } from '../src';

const bundle = {
  manifest: {
    id: 'example.reading', name: 'Reading tools', version: '1.0.0', description: 'Tools for reading.',
    author: 'Example', minimumNoorVersion: '0.1.0', permissions: ['commands', 'notes.read'],
    entryPoints: { sandbox: 'main.js' }, networkOrigins: [],
  }, files: { 'main.js': 'noorNote.register({kind:"command",id:"open",title:"Open"});' },
};

describe('plugin SDK validation', () => {
  it('validates manifests, local entry points, and Noor Note compatibility', () => {
    const parsed = pluginBundleSchema.parse(bundle);
    expect(parsed.manifest.id).toBe('example.reading');
    expect(supportsNoorVersion('0.1.0')).toBe(true);
    expect(supportsNoorVersion('99.0.0')).toBe(false);
    expect(() => pluginBundleSchema.parse({ ...bundle, manifest: { ...bundle.manifest, entryPoints: { sandbox: '../secret.js' } } })).toThrow();
    expect(() => pluginBundleSchema.parse({ ...bundle, files: {} })).toThrow();
    expect(() => pluginBundleSchema.parse({ ...bundle, manifest: { ...bundle.manifest, networkOrigins: ['http://example.test/'] } })).toThrow();
  });

  it('does not grant undeclared permissions or privileged registrations', () => {
    const manifest = pluginBundleSchema.parse(bundle).manifest;
    expect(() => validateGrant(manifest, ['notes.write'])).toThrow('Grant exceeds');
    expect(validateGrant(manifest, ['commands', 'commands'])).toEqual(['commands']);
    expect(validateContribution({ kind: 'command', id: 'open', title: 'Open' }, manifest.id, ['commands']).id).toBe('open');
    expect(() => validateContribution({ kind: 'view', id: 'secret', title: 'Secret', body: 'content' }, manifest.id, ['commands'])).toThrow('Missing views');
    expect(() => validateContribution({ kind: 'command', id: '__proto__', title: 'Bad' }, manifest.id, ['commands'])).toThrow();
    const contributions = [
      [{ kind: 'editor-extension', id: 'insert', title: 'Insert', insertText: 'Hi' }, 'editor'],
      [{ kind: 'sidebar-panel', id: 'panel', title: 'Panel', body: 'Text' }, 'views'],
      [{ kind: 'view', id: 'view', title: 'View', body: 'Text' }, 'views'],
      [{ kind: 'property-type', id: 'type', title: 'Type', valueKind: 'text', options: ['One'] }, 'properties'],
      [{ kind: 'base-view', id: 'base', title: 'Base', body: 'Text' }, 'bases'],
      [{ kind: 'canvas-tool', id: 'canvas', title: 'Canvas', cardText: 'Card' }, 'canvas'],
      [{ kind: 'setting', id: 'setting', title: 'Setting', valueKind: 'boolean', defaultValue: false }, 'settings'],
      [{ kind: 'status-bar', id: 'status', title: 'Status', text: 'Ready' }, 'views'],
      [{ kind: 'note-processor', id: 'process', title: 'Process' }, 'processors'],
    ] as const;
    for (const [contribution, permission] of contributions) {
      expect(validateContribution(contribution, manifest.id, [permission]).id).toBe(contribution.id);
      expect(() => validateContribution(contribution, manifest.id, [])).toThrow(`Missing ${permission}`);
    }
    expect(() => validateContribution({ kind: 'setting', id: 'bad', title: 'Bad', valueKind: 'number', defaultValue: 'text' }, manifest.id, ['settings'])).toThrow('does not match');
  });

  it('rejects oversized and malformed bridge messages', () => {
    expect(parsePluginMessage({ type: 'ready' })).toEqual({ type: 'ready' });
    expect(() => parsePluginMessage({ type: 'request', id: crypto.randomUUID(), action: 'notes.delete', payload: {} })).toThrow();
    expect(() => parsePluginMessage({ type: 'register', contribution: { kind: 'command', id: 'x', title: 'X', handler: 'evil' } })).toThrow();
    expect(() => parsePluginMessage({ type: 'invoke-result', id: crypto.randomUUID(), ok: true, value: 'x'.repeat(300_000) })).toThrow('too large');
  });
});
