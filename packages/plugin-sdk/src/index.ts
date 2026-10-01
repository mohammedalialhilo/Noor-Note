import { z } from 'zod';

export const NOOR_PLUGIN_API_VERSION = '0.1.0';
const localId = z.string().regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u).max(120);
const label = z.string().trim().min(1).max(120);
const semver = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u).max(40);
const entryPath = z.string().regex(/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*\.js$/u).max(160).refine((value) => !value.split('/').includes('..'));

export function isPublicPluginNetworkOrigin(value: string): boolean {
  let parsed: URL;
  try { parsed = new URL(value); } catch { return false; }
  const host = parsed.hostname.toLowerCase().replace(/\.$/u, '');
  if (parsed.protocol !== 'https:' || parsed.port || parsed.username || parsed.password
    || parsed.pathname !== '/' || parsed.search || parsed.hash
    || !host || host === 'localhost' || host.endsWith('.localhost')
    || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.home.arpa')
    || host.startsWith('[') || /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host)) return false;
  return true;
}

export const pluginPermissionSchema = z.enum([
  'notes.read', 'notes.write', 'attachments.read', 'attachments.write', 'network',
  'editor', 'commands', 'views', 'settings', 'clipboard', 'ai',
  'properties', 'bases', 'canvas', 'processors',
]);
export type PluginPermission = z.infer<typeof pluginPermissionSchema>;

export const pluginManifestSchema = z.object({
  id: localId, name: label, version: semver,
  description: z.string().trim().min(1).max(2000), author: label,
  minimumNoorVersion: semver,
  permissions: z.array(pluginPermissionSchema).max(15).refine((items) => new Set(items).size === items.length, 'Duplicate permissions'),
  entryPoints: z.object({ sandbox: entryPath }).strict(),
  networkOrigins: z.array(z.url().refine(isPublicPluginNetworkOrigin, 'Use a public HTTPS origin on the default port')).max(10).default([]),
}).strict().refine((manifest) => manifest.permissions.includes('network') || manifest.networkOrigins.length === 0, 'Network origins require network permission');
export type PluginManifest = z.infer<typeof pluginManifestSchema>;

export const pluginBundleSchema = z.object({
  manifest: pluginManifestSchema,
  files: z.record(entryPath, z.string().max(200_000)),
}).strict().refine((bundle) => Object.hasOwn(bundle.files, bundle.manifest.entryPoints.sandbox), 'Sandbox entry point is missing')
  .refine((bundle) => Object.keys(bundle.files).length <= 8 && Object.values(bundle.files).reduce((total, file) => total + file.length, 0) <= 400_000, 'Plugin bundle is too large');
export type PluginBundle = z.infer<typeof pluginBundleSchema>;

const base = z.object({ id: localId, title: label }).strict();
export const pluginContributionSchema = z.discriminatedUnion('kind', [
  base.extend({ kind: z.literal('command'), category: label.optional(), shortcut: z.string().max(60).optional() }),
  base.extend({ kind: z.literal('editor-extension'), insertText: z.string().max(10_000) }),
  base.extend({ kind: z.literal('sidebar-panel'), body: z.string().max(20_000) }),
  base.extend({ kind: z.literal('view'), body: z.string().max(50_000) }),
  base.extend({ kind: z.literal('property-type'), valueKind: z.enum(['text', 'number', 'boolean']), options: z.array(label).max(50).optional() }),
  base.extend({ kind: z.literal('base-view'), body: z.string().max(50_000) }),
  base.extend({ kind: z.literal('canvas-tool'), cardText: z.string().max(10_000) }),
  base.extend({ kind: z.literal('setting'), valueKind: z.enum(['text', 'number', 'boolean']), defaultValue: z.union([z.string().max(2000), z.number().finite(), z.boolean()]) }),
  base.extend({ kind: z.literal('status-bar'), text: z.string().max(200) }),
  base.extend({ kind: z.literal('note-processor') }),
]);
export type PluginContribution = z.infer<typeof pluginContributionSchema>;
export type PluginContributionKind = PluginContribution['kind'];

export const contributionPermission: Readonly<Record<PluginContributionKind, PluginPermission>> = {
  command: 'commands', 'editor-extension': 'editor', 'sidebar-panel': 'views', view: 'views',
  'property-type': 'properties', 'base-view': 'bases', 'canvas-tool': 'canvas',
  setting: 'settings', 'status-bar': 'views', 'note-processor': 'processors',
};

export function supportsNoorVersion(minimum: string, current = NOOR_PLUGIN_API_VERSION): boolean {
  const min = semver.parse(minimum).split('-')[0]!.split('.').map(Number);
  const now = semver.parse(current).split('-')[0]!.split('.').map(Number);
  for (let index = 0; index < 3; index++) {
    if (now[index]! > min[index]!) return true;
    if (now[index]! < min[index]!) return false;
  }
  return true;
}

export function validateGrant(manifest: PluginManifest, grants: readonly PluginPermission[]): PluginPermission[] {
  const parsed = pluginManifestSchema.parse(manifest);
  const allowed = new Set(parsed.permissions);
  const selected = z.array(pluginPermissionSchema).max(15).parse(grants);
  if (selected.some((permission) => !allowed.has(permission))) throw new Error('Grant exceeds the plugin manifest');
  return [...new Set(selected)];
}

export function validateContribution(input: unknown, pluginId: string, grants: readonly PluginPermission[]): PluginContribution {
  const contribution = pluginContributionSchema.parse(input);
  if (!localId.safeParse(pluginId).success) throw new Error('Invalid plugin ID');
  if (!grants.includes(contributionPermission[contribution.kind])) throw new Error(`Missing ${contributionPermission[contribution.kind]} permission`);
  if (contribution.kind === 'setting' && typeof contribution.defaultValue !== (contribution.valueKind === 'text' ? 'string' : contribution.valueKind)) throw new Error('Setting default does not match its type');
  if (contribution.kind === 'property-type' && contribution.options?.length && contribution.valueKind !== 'text') throw new Error('Property choices require text values');
  return contribution;
}

export const pluginMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }).strict(),
  z.object({ type: z.literal('register'), contribution: pluginContributionSchema }).strict(),
  z.object({ type: z.literal('request'), id: z.uuid(), action: z.enum(['notes.list', 'notes.read', 'settings.get', 'settings.set', 'network.fetch', 'clipboard.write', 'editor.insert']), payload: z.unknown() }).strict(),
  z.object({ type: z.literal('invoke-result'), id: z.uuid(), ok: z.boolean(), value: z.unknown().optional(), error: z.string().max(500).optional() }).strict(),
]);
export type PluginMessage = z.infer<typeof pluginMessageSchema>;

export function parsePluginMessage(input: unknown): PluginMessage {
  let size: number;
  try { size = JSON.stringify(input).length; } catch { throw new Error('Invalid plugin message'); }
  if (size > 256_000) throw new Error('Plugin message is too large');
  return pluginMessageSchema.parse(input);
}

/** Available inside a plugin's sandbox. Plugins never receive host objects directly. */
export interface NoorPluginApi {
  register(contribution: PluginContribution, handler?: (payload: unknown) => unknown | Promise<unknown>): void;
  request(action: 'notes.list' | 'notes.read' | 'settings.get' | 'settings.set' | 'network.fetch' | 'clipboard.write' | 'editor.insert', payload?: unknown): Promise<unknown>;
}
declare global { interface Window { noorNote: NoorPluginApi } }
