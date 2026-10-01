import Dexie, { type EntityTable } from 'dexie';
import { pluginBundleSchema, pluginPermissionSchema, validateGrant, type PluginBundle, type PluginPermission } from '@noor-note/plugin-sdk';
import { z } from 'zod';

export interface InstalledPlugin {
  id: string;
  bundle: PluginBundle;
  grants: PluginPermission[];
  enabled: boolean;
  installedAt: string;
}
export interface PluginSetting { key: string; pluginId: string; value: string | number | boolean; }
const installedSchema = z.object({
  id: z.string(), bundle: pluginBundleSchema, grants: z.array(pluginPermissionSchema), enabled: z.boolean(), installedAt: z.iso.datetime(),
}).strict();
const settingSchema = z.union([z.string().max(2000), z.number().finite(), z.boolean()]);

export class PluginStore extends Dexie {
  plugins!: EntityTable<InstalledPlugin, 'id'>;
  settings!: EntityTable<PluginSetting, 'key'>;
  constructor(name = 'noor-note-plugins') {
    super(name);
    this.version(1).stores({ plugins: 'id', settings: 'key,pluginId' });
  }
  async list(): Promise<InstalledPlugin[]> {
    const rows = await this.plugins.toArray();
    return rows.flatMap((row) => {
      const parsed = installedSchema.safeParse(row);
      if (!parsed.success || parsed.data.bundle.manifest.id !== parsed.data.id) return [];
      try { return [{ ...parsed.data, grants: validateGrant(parsed.data.bundle.manifest, parsed.data.grants) }]; }
      catch { return []; }
    });
  }
  async put(bundle: PluginBundle, grants: PluginPermission[], enabled = true): Promise<InstalledPlugin> {
    const parsed = pluginBundleSchema.parse(bundle);
    const row: InstalledPlugin = {
      id: parsed.manifest.id, bundle: parsed, grants: validateGrant(parsed.manifest, grants), enabled,
      installedAt: new Date().toISOString(),
    };
    await this.plugins.put(row);
    return row;
  }
  async setEnabled(id: string, enabled: boolean): Promise<void> {
    if (!await this.plugins.update(id, { enabled })) throw new Error('Plugin is not installed');
  }
  async replaceBundle(id: string, bundle: PluginBundle): Promise<InstalledPlugin> {
    const parsed = pluginBundleSchema.parse(bundle);
    const existing = await this.plugins.get(id);
    if (!existing) throw new Error('Plugin is not installed');
    if (parsed.manifest.id !== id) throw new Error('Development bundle has a different plugin ID');
    if (JSON.stringify([...parsed.manifest.permissions].sort()) !== JSON.stringify([...existing.bundle.manifest.permissions].sort()) ||
      JSON.stringify([...parsed.manifest.networkOrigins].sort()) !== JSON.stringify([...existing.bundle.manifest.networkOrigins].sort())) {
      throw new Error('Plugin permissions or network origins changed. Reinstall and review the new bundle.');
    }
    const updated = { ...existing, bundle: parsed };
    await this.plugins.put(updated);
    return updated;
  }
  async removePlugin(id: string): Promise<void> {
    await this.transaction('rw', this.plugins, this.settings, async () => {
      await this.settings.where('pluginId').equals(id).delete();
      await this.plugins.delete(id);
    });
  }
  async getSetting(pluginId: string, name: string): Promise<string | number | boolean | null> {
    const row = await this.settings.get(`${pluginId}:${name}`);
    return row ? settingSchema.safeParse(row.value).data ?? null : null;
  }
  async setSetting(pluginId: string, name: string, value: string | number | boolean): Promise<void> {
    await this.settings.put({ key: `${pluginId}:${name}`, pluginId, value: settingSchema.parse(value) });
  }
}
