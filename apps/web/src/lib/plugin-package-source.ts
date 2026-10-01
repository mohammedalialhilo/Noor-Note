import { pluginBundleSchema, supportsNoorVersion, type PluginBundle } from '@noor-note/plugin-sdk';

/** Sources supply an untrusted bundle; the host applies the same validation and grant review to every source. */
export interface PluginPackageSource {
  readonly label: string;
  readonly canRefresh: boolean;
  load(): Promise<PluginBundle>;
}

export async function readPluginBundleFile(file: File): Promise<PluginBundle> {
  if (file.size > 500_000) throw new Error('Plugin bundle exceeds 500 KB');
  let parsed: unknown;
  try { parsed = JSON.parse(await file.text()); }
  catch { throw new Error('Plugin bundle is not valid JSON'); }
  const bundle = pluginBundleSchema.parse(parsed);
  if (!supportsNoorVersion(bundle.manifest.minimumNoorVersion)) throw new Error('This plugin needs a newer Noor Note version');
  return bundle;
}

export function localPluginFile(file: File): PluginPackageSource {
  return { label: file.name, canRefresh: false, load: () => readPluginBundleFile(file) };
}

export interface LocalPluginFileHandle {
  readonly name: string;
  getFile(): Promise<File>;
}

export function developmentPluginFile(handle: LocalPluginFileHandle): PluginPackageSource {
  return { label: handle.name, canRefresh: true, load: async () => readPluginBundleFile(await handle.getFile()) };
}
