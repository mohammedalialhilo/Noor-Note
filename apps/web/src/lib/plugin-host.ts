import { parsePluginMessage, pluginBundleSchema, supportsNoorVersion, validateContribution, validateGrant, type PluginBundle, type PluginContribution, type PluginPermission } from '@noor-note/plugin-sdk';
import type { VaultNote } from '@noor-note/core';
import type { VaultRepository } from '@noor-note/storage';
import { z } from 'zod';
import { commandRegistry } from './commands';
import { PluginStore, type InstalledPlugin } from './plugin-store';
import { pluginSandboxBootstrap } from './plugin-sandbox-bootstrap';
import type { PluginPackageSource } from './plugin-package-source';

export interface PluginEnvironment {
  vaultId: string | null;
  repository: VaultRepository | null;
  currentNote: VaultNote | null;
  canEdit: boolean;
  insertText: (text: string) => void;
  openSurface: (id: string) => void;
  proposeNoteEdit: (plugin: string, original: VaultNote, markdown: string) => void;
  reportError: (message: string) => void;
}
export interface RegisteredContribution { pluginId: string; contribution: PluginContribution; }
export interface PluginHostSnapshot {
  installations: InstalledPlugin[];
  contributions: RegisteredContribution[];
  errors: Readonly<Record<string, string>>;
}
interface Runtime {
  installation: InstalledPlugin;
  frame: HTMLIFrameElement;
  port: MessagePort | null;
  registrations: Map<string, () => void>;
  pending: Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>;
  messageCount: number;
  windowStart: number;
  loadCount: number;
  ready: boolean;
  userGestureUntil: number;
}
const emptySnapshot: PluginHostSnapshot = { installations: [], contributions: [], errors: {} };
const nameSchema = z.string().regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u).max(120);
const settingValueSchema = z.union([z.string().max(2000), z.number().finite(), z.boolean()]);
const noteIdSchema = z.object({ noteId: z.uuid() }).strict();
const textSchema = z.object({ text: z.string().max(10_000) }).strict();

function dataScript(code: string): string {
  const bytes = new TextEncoder().encode(code);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return `data:text/javascript;base64,${btoa(binary)}`;
}

export function buildPluginSandboxDocument(source: string): string {
  const policy = "default-src 'none'; script-src data:; connect-src 'none'; img-src 'none'; media-src 'none'; font-src 'none'; style-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; navigate-to 'none'";
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${policy}"></head><body><script src="${dataScript(pluginSandboxBootstrap)}"></script><script src="${dataScript(source)}"></script></body></html>`;
}

/** Owns all bridge endpoints. Runtime code is never imported into the application realm. */
export class PluginHost {
  private readonly store: PluginStore;
  private readonly runtimes = new Map<string, Runtime>();
  private readonly listeners = new Set<() => void>();
  private readonly packageSources = new Map<string, PluginPackageSource>();
  private snapshot: PluginHostSnapshot = emptySnapshot;
  private environment: PluginEnvironment | null = null;
  private started = false;
  constructor(databaseName?: string) { this.store = new PluginStore(databaseName); }
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  getSnapshot = (): PluginHostSnapshot => this.snapshot;
  setEnvironment(environment: PluginEnvironment): void { this.environment = environment; }
  private publish(): void {
    this.snapshot = {
      ...this.snapshot,
      contributions: [...this.runtimes.values()].flatMap((runtime) => [...runtime.registrations.keys()].map((id) => ({ pluginId: runtime.installation.id, contribution: this.contributionById(runtime, id) })).filter((item): item is RegisteredContribution => item.contribution !== null)),
    };
    for (const listener of this.listeners) listener();
  }
  private readonly descriptors = new Map<string, PluginContribution>();
  private contributionById(runtime: Runtime, id: string): PluginContribution | null { return this.descriptors.get(`${runtime.installation.id}:${id}`) ?? null; }
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    let installations: InstalledPlugin[];
    try { installations = await this.store.list(); }
    catch (error) { this.started = false; throw error; }
    if (!this.started) return;
    this.snapshot = { ...this.snapshot, installations };
    this.publish();
    for (const item of installations.filter((plugin) => plugin.enabled)) this.launch(item);
  }
  async install(input: unknown, grants: PluginPermission[]): Promise<void> {
    const bundle = pluginBundleSchema.parse(input);
    if (!supportsNoorVersion(bundle.manifest.minimumNoorVersion)) throw new Error('This plugin needs a newer Noor Note version');
    const selected = validateGrant(bundle.manifest, grants);
    const installation = await this.store.put(bundle, selected);
    this.packageSources.delete(bundle.manifest.id);
    this.stopRuntime(bundle.manifest.id);
    const errors = { ...this.snapshot.errors };
    delete errors[installation.id];
    this.snapshot = { ...this.snapshot, errors, installations: [...this.snapshot.installations.filter((item) => item.id !== installation.id), installation] };
    this.publish();
    if (this.started) this.launch(installation);
  }
  async installFromSource(source: PluginPackageSource, reviewedBundle: PluginBundle, grants: PluginPermission[]): Promise<void> {
    const bundle = await source.load();
    if (JSON.stringify(bundle) !== JSON.stringify(reviewedBundle)) throw new Error('Plugin bundle changed during review. Select it again and review its permissions.');
    await this.install(bundle, grants);
    if (source.canRefresh) this.packageSources.set(bundle.manifest.id, source);
    else this.packageSources.delete(bundle.manifest.id);
  }
  canReloadFromSource(id: string): boolean { return this.packageSources.has(id); }
  async reloadFromSource(id: string): Promise<void> {
    const source = this.packageSources.get(id);
    if (!source) throw new Error('No development file is connected. Select the updated bundle again.');
    const bundle = await source.load();
    if (!supportsNoorVersion(bundle.manifest.minimumNoorVersion)) throw new Error('This plugin needs a newer Noor Note version');
    const updated = await this.store.replaceBundle(id, bundle);
    this.snapshot = { ...this.snapshot, installations: this.snapshot.installations.map((item) => item.id === id ? updated : item) };
    this.reload(id);
  }
  reload(id: string): void {
    const installation = this.snapshot.installations.find((item) => item.id === id);
    if (!installation) throw new Error('Plugin is not installed');
    this.stopRuntime(id);
    const errors = { ...this.snapshot.errors };
    delete errors[id];
    this.snapshot = { ...this.snapshot, errors };
    this.publish();
    if (installation.enabled && this.started) this.launch(installation);
  }
  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await this.store.setEnabled(id, enabled);
    const installation = this.snapshot.installations.find((item) => item.id === id);
    if (!installation) return;
    this.stopRuntime(id);
    if (enabled) {
      const errors = { ...this.snapshot.errors };
      delete errors[id];
      this.snapshot = { ...this.snapshot, errors };
    }
    const updated = { ...installation, enabled };
    this.snapshot = { ...this.snapshot, installations: this.snapshot.installations.map((item) => item.id === id ? updated : item) };
    this.publish();
    if (enabled && this.started) this.launch(updated);
  }
  async remove(id: string): Promise<void> {
    this.stopRuntime(id);
    await this.store.removePlugin(id);
    this.packageSources.delete(id);
    const errors = { ...this.snapshot.errors };
    delete errors[id];
    this.snapshot = { ...this.snapshot, errors };
    this.snapshot = { ...this.snapshot, installations: this.snapshot.installations.filter((item) => item.id !== id) };
    this.publish();
  }
  async readSetting(pluginId: string, name: string): Promise<string | number | boolean | null> { return this.store.getSetting(pluginId, nameSchema.parse(name)); }
  async writeSetting(pluginId: string, name: string, value: string | number | boolean): Promise<void> { await this.store.setSetting(pluginId, nameSchema.parse(name), settingValueSchema.parse(value)); }
  stop(): void {
    this.started = false;
    for (const id of [...this.runtimes.keys()]) this.stopRuntime(id);
    this.store.close();
  }
  private launch(installation: InstalledPlugin): void {
    if (typeof document === 'undefined' || this.runtimes.has(installation.id)) return;
    const frame = document.createElement('iframe');
    frame.sandbox.add('allow-scripts');
    frame.hidden = true;
    frame.setAttribute('aria-hidden', 'true');
    frame.referrerPolicy = 'no-referrer';
    frame.title = `${installation.bundle.manifest.name} plugin sandbox`;
    const runtime: Runtime = { installation, frame, port: null, registrations: new Map(), pending: new Map(), messageCount: 0, windowStart: Date.now(), loadCount: 0, ready: false, userGestureUntil: 0 };
    this.runtimes.set(installation.id, runtime);
    frame.addEventListener('load', () => {
      if (this.runtimes.get(installation.id) !== runtime) return;
      if (++runtime.loadCount > 1) { this.runtimeError(runtime, 'Plugin navigated away from its sandbox'); return; }
      const channel = new MessageChannel();
      runtime.port = channel.port1;
      channel.port1.onmessage = (event: MessageEvent<unknown>) => { void this.onMessage(runtime, event.data); };
      channel.port1.start();
      frame.contentWindow?.postMessage({ type: 'noor-note-plugin-init' }, '*', [channel.port2]);
      window.setTimeout(() => { if (this.runtimes.get(installation.id) === runtime && !runtime.ready) this.runtimeError(runtime, 'Plugin did not start'); }, 5000);
    });
    frame.srcdoc = buildPluginSandboxDocument(installation.bundle.files[installation.bundle.manifest.entryPoints.sandbox]!);
    document.body.append(frame);
  }
  private stopRuntime(id: string): void {
    const runtime = this.runtimes.get(id);
    if (!runtime) return;
    this.runtimes.delete(id);
    for (const cleanup of runtime.registrations.values()) cleanup();
    for (const key of runtime.registrations.keys()) this.descriptors.delete(`${id}:${key}`);
    for (const task of runtime.pending.values()) { clearTimeout(task.timer); task.reject(new Error('Plugin stopped')); }
    runtime.port?.close();
    runtime.frame.remove();
    this.publish();
  }
  private runtimeError(runtime: Runtime, message: string): void {
    this.snapshot = { ...this.snapshot, errors: { ...this.snapshot.errors, [runtime.installation.id]: message } };
    this.environment?.reportError(`${runtime.installation.bundle.manifest.name}: ${message}`);
    this.stopRuntime(runtime.installation.id);
  }
  private async onMessage(runtime: Runtime, input: unknown): Promise<void> {
    if (this.runtimes.get(runtime.installation.id) !== runtime) return;
    const now = Date.now();
    if (now - runtime.windowStart > 60_000) { runtime.windowStart = now; runtime.messageCount = 0; }
    if (++runtime.messageCount > 240) { this.runtimeError(runtime, 'Plugin sent too many messages'); return; }
    try {
      const message = parsePluginMessage(input);
      if (message.type === 'ready') { runtime.ready = true; return; }
      if (message.type === 'register') { this.register(runtime, message.contribution); return; }
      if (message.type === 'invoke-result') {
        const task = runtime.pending.get(message.id);
        if (!task) return;
        runtime.pending.delete(message.id); clearTimeout(task.timer);
        if (message.ok) task.resolve(message.value); else task.reject(new Error(message.error ?? 'Plugin action failed'));
        return;
      }
      if (message.type === 'request') {
        try { runtime.port?.postMessage({ type: 'request-result', id: message.id, ok: true, value: await this.handleRequest(runtime.installation, message.action, message.payload) }); }
        catch (error) { runtime.port?.postMessage({ type: 'request-result', id: message.id, ok: false, error: error instanceof Error ? error.message : 'Request denied' }); }
      }
    } catch (error) { this.runtimeError(runtime, error instanceof Error ? error.message : 'Invalid plugin message'); }
  }
  private register(runtime: Runtime, input: unknown): void {
    const { installation } = runtime;
    const contribution = validateContribution(input, installation.id, installation.grants);
    if (runtime.registrations.size >= 128 && !runtime.registrations.has(contribution.id)) throw new Error('Too many plugin contributions');
    runtime.registrations.get(contribution.id)?.();
    const fullId = `plugin.${installation.id}.${contribution.id}`;
    let cleanup: () => void = () => undefined;
    if (contribution.kind === 'command' || contribution.kind === 'editor-extension' || contribution.kind === 'note-processor') {
      cleanup = commandRegistry.register({
        id: fullId, name: contribution.title, category: `Plugin: ${installation.bundle.manifest.name}`,
        ...(contribution.kind === 'command' && contribution.shortcut ? { defaultShortcut: contribution.shortcut } : {}),
        available: (context) => contribution.kind === 'editor-extension' || contribution.kind === 'note-processor' ? context.hasEditor : true,
        handler: async () => {
          runtime.userGestureUntil = Date.now() + 2000;
          try {
            if (contribution.kind === 'editor-extension') {
              if (!this.environment?.canEdit) throw new Error('This note is read-only');
              this.environment.insertText(contribution.insertText);
            } else if (contribution.kind === 'note-processor') {
              const note = this.environment?.currentNote;
              if (!note || !this.environment?.canEdit || note.collaborative || !installation.grants.includes('notes.read') || !installation.grants.includes('notes.write')) throw new Error('Note processing requires an editable ordinary note and read/write permission');
              const result = await this.invoke(runtime, contribution.id, { markdown: note.markdown, title: note.title });
              const markdown = z.string().max(1_000_000).parse(result);
              this.environment.proposeNoteEdit(installation.bundle.manifest.name, note, markdown);
            } else await this.invoke(runtime, contribution.id, {});
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Plugin command failed';
            this.snapshot = { ...this.snapshot, errors: { ...this.snapshot.errors, [installation.id]: message } };
            this.environment?.reportError(`${installation.bundle.manifest.name}: ${message}`);
            this.publish();
          }
        },
      });
    } else if (contribution.kind === 'view' || contribution.kind === 'sidebar-panel' || contribution.kind === 'base-view') {
      cleanup = commandRegistry.register({ id: fullId, name: `Open ${contribution.title}`, category: `Plugin: ${installation.bundle.manifest.name}`, handler: () => this.environment?.openSurface(fullId) });
    }
    runtime.registrations.set(contribution.id, cleanup);
    this.descriptors.set(`${installation.id}:${contribution.id}`, contribution);
    this.publish();
  }
  async invoke(runtime: Runtime, contributionId: string, payload: unknown): Promise<unknown> {
    if (!runtime.port || !runtime.ready) throw new Error('Plugin is not ready');
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { runtime.pending.delete(id); reject(new Error('Plugin action timed out')); }, 10_000);
      runtime.pending.set(id, { resolve, reject, timer });
      runtime.port!.postMessage({ type: 'invoke', id, contributionId, payload });
    });
  }
  async handleRequest(installation: InstalledPlugin, action: string, input: unknown): Promise<unknown> {
    const grants = new Set(installation.grants);
    const need = (permission: PluginPermission) => { if (!grants.has(permission)) throw new Error(`Missing ${permission} permission`); };
    const environment = this.environment;
    switch (action) {
      case 'notes.list': {
        need('notes.read');
        if (!environment?.vaultId || !environment.repository) throw new Error('No vault is open');
        const { offset, limit } = z.object({ offset: z.int().min(0).max(100_000).default(0), limit: z.int().min(1).max(200).default(100) }).strict().parse(input ?? {});
        const tree = await environment.repository.listTree(environment.vaultId);
        const available = tree.notes.filter((note) => !note.deletedAt);
        return { notes: available.slice(offset, offset + limit).map((note) => ({ id: note.id, path: note.path, title: note.title, updatedAt: note.updatedAt })), total: available.length, offset };
      }
      case 'notes.read': {
        need('notes.read');
        const { noteId } = noteIdSchema.parse(input);
        const note = await environment?.repository?.getNote(noteId);
        if (!note || note.vaultId !== environment?.vaultId || note.deletedAt) throw new Error('Note not found in the active vault');
        if (note.markdown.length > 1_000_000) throw new Error('Note is too large for the plugin bridge');
        return { id: note.id, title: note.title, path: note.path, markdown: note.markdown, revision: note.revision };
      }
      case 'settings.get': {
        need('settings');
        const { name } = z.object({ name: nameSchema }).strict().parse(input);
        const saved = await this.store.getSetting(installation.id, name);
        if (saved !== null) return saved;
        const contribution = this.descriptors.get(`${installation.id}:${name}`);
        return contribution?.kind === 'setting' ? contribution.defaultValue : null;
      }
      case 'settings.set': {
        need('settings');
        const { name, value } = z.object({ name: nameSchema, value: settingValueSchema }).strict().parse(input);
        const contribution = this.descriptors.get(`${installation.id}:${name}`);
        if (contribution?.kind === 'setting' && typeof value !== (contribution.valueKind === 'text' ? 'string' : contribution.valueKind)) throw new Error('Setting value has the wrong type');
        await this.store.setSetting(installation.id, name, value);
        return true;
      }
      case 'network.fetch': {
        need('network');
        const { url } = z.object({ url: z.url() }).strict().parse(input);
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:' || !installation.bundle.manifest.networkOrigins.includes(parsed.origin + '/')) throw new Error('Network origin is not allowed');
        const response = await fetch(parsed.href, { method: 'GET', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw new Error(`Network request failed: ${response.status}`);
        if (Number(response.headers.get('content-length') ?? 0) > 100_000) throw new Error('Network response is too large');
        const reader = response.body?.getReader();
        if (!reader) return { status: response.status, text: '' };
        const chunks: Uint8Array[] = [];
        let length = 0;
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            length += chunk.value.byteLength;
            if (length > 100_000) throw new Error('Network response is too large');
            chunks.push(chunk.value);
          }
        } finally { void reader.cancel().catch(() => undefined); }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        return { status: response.status, text: new TextDecoder().decode(bytes) };
      }
      case 'clipboard.write': {
        need('clipboard');
        if (Date.now() > (this.runtimes.get(installation.id)?.userGestureUntil ?? 0)) throw new Error('Clipboard access requires a plugin command');
        const { text } = textSchema.parse(input);
        await navigator.clipboard.writeText(text);
        return true;
      }
      case 'editor.insert': {
        need('editor');
        if (Date.now() > (this.runtimes.get(installation.id)?.userGestureUntil ?? 0)) throw new Error('Editor insertion requires a plugin command');
        if (!environment?.canEdit) throw new Error('This note is read-only');
        environment.insertText(textSchema.parse(input).text);
        return true;
      }
      default: throw new Error('Unsupported plugin action');
    }
  }
}
