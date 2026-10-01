'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type ChangeEvent } from 'react';
import type { PluginBundle, PluginContribution, PluginPermission } from '@noor-note/plugin-sdk';
import type { PluginHost } from '../lib/plugin-host';
import { developmentPluginFile, localPluginFile, type LocalPluginFileHandle, type PluginPackageSource } from '../lib/plugin-package-source';
import styles from './PluginManager.module.css';

const developerModeKey = 'noor-note-plugin-developer-mode';
const developerModeEvent = 'noor-note-plugin-mode';
let sessionDeveloperMode = false;
function getDeveloperMode(): boolean { try { return localStorage.getItem(developerModeKey) === 'true'; } catch { return sessionDeveloperMode; } }
function subscribeDeveloperMode(listener: () => void): () => void {
  window.addEventListener('storage', listener);
  window.addEventListener(developerModeEvent, listener);
  return () => { window.removeEventListener('storage', listener); window.removeEventListener(developerModeEvent, listener); };
}
const permissionDescriptions: Record<PluginPermission, string> = {
  'notes.read': 'Read note summaries and Markdown in the active vault',
  'notes.write': 'Propose changes to notes through review',
  'attachments.read': 'Reserved for an attachment API',
  'attachments.write': 'Reserved for an attachment API',
  network: 'Request declared HTTPS origins through the host',
  editor: 'Insert text through the active editor',
  commands: 'Add commands to the palette',
  views: 'Add text views, panels, and status items',
  settings: 'Store plugin-scoped settings',
  clipboard: 'Write text to the clipboard',
  ai: 'Reserved for an AI capability API',
  properties: 'Declare a property type',
  bases: 'Declare a Base view',
  canvas: 'Declare a Canvas text-card tool',
  processors: 'Propose processed note Markdown for review',
};
const unavailableGrants: readonly PluginPermission[] = ['attachments.read', 'attachments.write', 'ai'];

interface DevelopmentPickerWindow extends Window {
  showOpenFilePicker?: (options: { types: { description: string; accept: Record<string, string[]> }[]; multiple: false }) => Promise<LocalPluginFileHandle[]>;
}

function PluginSettingControl({ host, pluginId, setting }: { host: PluginHost; pluginId: string; setting: Extract<PluginContribution, { kind: 'setting' }> }) {
  const [value, setValue] = useState<string | number | boolean>(setting.defaultValue);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void host.readSetting(pluginId, setting.id).then((saved) => { if (active && saved !== null) setValue(saved); }).catch(() => { if (active) setMessage('Could not load setting'); });
    return () => { active = false; };
  }, [host, pluginId, setting.id]);
  const save = async () => {
    try { await host.writeSetting(pluginId, setting.id, value); setMessage('Saved'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save setting'); }
  };
  return <div className={styles.setting}><label>{setting.title}{setting.valueKind === 'boolean' ? <input type="checkbox" checked={Boolean(value)} onChange={(event) => setValue(event.target.checked)} /> : <input type={setting.valueKind === 'number' ? 'number' : 'text'} value={String(value)} onChange={(event) => setValue(setting.valueKind === 'number' ? Number(event.target.value) : event.target.value)} />}</label><button type="button" onClick={() => { void save(); }}>Save</button>{message && <small role="status">{message}</small>}</div>;
}

export function PluginManager({ host }: { host: PluginHost }) {
  const snapshot = useSyncExternalStore(host.subscribe, host.getSnapshot, host.getSnapshot);
  const developmentInput = useRef<HTMLInputElement>(null);
  const developerMode = useSyncExternalStore(subscribeDeveloperMode, getDeveloperMode, () => false);
  const [candidate, setCandidate] = useState<{ bundle: PluginBundle; source: PluginPackageSource } | null>(null);
  const [grants, setGrants] = useState<PluginPermission[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const setMode = (enabled: boolean) => {
    sessionDeveloperMode = enabled;
    try { localStorage.setItem(developerModeKey, String(enabled)); }
    catch { setMessage({ text: 'Developer mode is available for this session only in this browser.', error: false }); }
    window.dispatchEvent(new Event(developerModeEvent));
  };
  const showError = (error: unknown, fallback: string) => setMessage({ text: error instanceof Error ? error.message : fallback, error: true });
  const review = async (source: PluginPackageSource) => {
    try {
      const bundle = await source.load();
      setCandidate({ bundle, source }); setGrants([]); setMessage(null);
    } catch (error) { setCandidate(null); showError(error, 'Could not read the plugin bundle'); }
  };
  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void review(localPluginFile(file));
  };
  const chooseDevelopmentFile = async () => {
    const pickerWindow = window as DevelopmentPickerWindow;
    if (!pickerWindow.showOpenFilePicker) { developmentInput.current?.click(); return; }
    try {
      const [handle] = await pickerWindow.showOpenFilePicker({ types: [{ description: 'Noor Note plugin bundle', accept: { 'application/json': ['.json'] } }], multiple: false });
      if (handle) await review(developmentPluginFile(handle));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      showError(error, 'Could not open the development bundle');
    }
  };
  const install = async () => {
    if (!candidate || busy) return;
    setBusy(true);
    try {
      await host.installFromSource(candidate.source, candidate.bundle, grants);
      setMessage({ text: `${candidate.bundle.manifest.name} installed locally.`, error: false });
      setCandidate(null); setGrants([]);
    } catch (error) { showError(error, 'Could not install the plugin'); }
    finally { setBusy(false); }
  };
  const act = async (action: () => Promise<void> | void, success: string) => {
    if (busy) return;
    setBusy(true);
    try { await action(); setMessage({ text: success, error: false }); }
    catch (error) { showError(error, 'Plugin action failed'); }
    finally { setBusy(false); }
  };
  const remove = (id: string) => {
    if (!window.confirm('Remove this plugin and its local settings?')) return;
    void act(() => host.remove(id), 'Plugin and its local settings removed.');
  };

  return <section className={styles.card} aria-labelledby="plugins-heading">
    <div className={styles.heading}><h2 id="plugins-heading">Plugins</h2><p>Install a local Noor Note plugin bundle. Review every permission before its code runs.</p></div>
    <label className={styles.file}>Choose plugin bundle <input type="file" accept=".json,.noor-plugin.json,application/json" onChange={chooseFile} /></label>
    <div className={styles.developer}>
      <label><input type="checkbox" checked={developerMode} onChange={(event) => setMode(event.target.checked)} /> Developer mode</label>
      {developerMode && <><p>Load a local bundle while developing. Browsers with file-handle support can reread it after edits; other browsers require selecting the updated file again. Plugin permissions still require review.</p><button type="button" disabled={busy} onClick={() => { void chooseDevelopmentFile(); }}>Open development bundle</button><input ref={developmentInput} className={styles.hiddenInput} type="file" accept=".json,.noor-plugin.json,application/json" aria-label="Development plugin bundle" onChange={chooseFile} /></>}
    </div>
    {message && <p role={message.error ? 'alert' : 'status'} className={message.error ? styles.error : styles.message}>{message.text}</p>}
    {candidate && <div className={styles.review}>
      <h3>{candidate.bundle.manifest.name} <small>{candidate.bundle.manifest.version}</small></h3>
      <p>{candidate.bundle.manifest.description}</p><p>By {candidate.bundle.manifest.author} · ID {candidate.bundle.manifest.id}</p>
      <p>Requires Noor Note {candidate.bundle.manifest.minimumNoorVersion} or later · Source: {candidate.source.label}</p>
      <strong>Requested permissions</strong>
      {candidate.bundle.manifest.permissions.length ? <div className={styles.permissions}>{candidate.bundle.manifest.permissions.map((permission) => <label key={permission}><input type="checkbox" disabled={unavailableGrants.includes(permission)} checked={grants.includes(permission)} onChange={(event) => setGrants((current) => event.target.checked ? [...current, permission] : current.filter((item) => item !== permission))} /><span><strong>{permission}</strong><small>{permissionDescriptions[permission]}</small></span></label>)}</div> : <p>No host permissions requested.</p>}
      {candidate.bundle.manifest.networkOrigins.length > 0 && <p>Network origins: {candidate.bundle.manifest.networkOrigins.join(', ')}</p>}
      <p className={styles.warning}>A plugin given note access can copy the content it reads. Install only code you trust.</p>
      <div className={styles.actions}><button type="button" disabled={busy} onClick={() => { void install(); }}>Install with selected permissions</button><button type="button" disabled={busy} onClick={() => setCandidate(null)}>Cancel</button></div>
    </div>}
    {snapshot.installations.length === 0 ? <p>No plugins installed.</p> : <div className={styles.installed}>{snapshot.installations.map((item) => <div className={styles.plugin} key={item.id}>
      <div><div className={styles.pluginTitle}><strong>{item.bundle.manifest.name}</strong><small>{item.bundle.manifest.version}</small><span className={styles.state}>{snapshot.errors[item.id] ? 'Error' : item.enabled ? 'Enabled' : 'Disabled'}</span></div>
        <p>{item.bundle.manifest.description}</p>
        <small>{snapshot.contributions.filter((entry) => entry.pluginId === item.id).length} active contributions</small>
        <details><summary>Metadata and permissions</summary><div className={styles.details}><p>ID: {item.id}</p><p>Author: {item.bundle.manifest.author}</p><p>Minimum Noor Note version: {item.bundle.manifest.minimumNoorVersion}</p><p>Installed: {new Date(item.installedAt).toLocaleString()}</p><p>Entry point: {item.bundle.manifest.entryPoints.sandbox}</p><strong>Requested permissions</strong>{item.bundle.manifest.permissions.length ? <ul>{item.bundle.manifest.permissions.map((permission) => <li key={permission}>{permission} — {permissionDescriptions[permission]} ({item.grants.includes(permission) ? 'granted' : 'not granted'})</li>)}</ul> : <p>None</p>}{item.bundle.manifest.networkOrigins.length > 0 && <p>Network origins: {item.bundle.manifest.networkOrigins.join(', ')}</p>}</div></details>
        <details open={Boolean(snapshot.errors[item.id])}><summary>Errors</summary><p role={snapshot.errors[item.id] ? 'alert' : undefined} className={snapshot.errors[item.id] ? styles.error : undefined}>{snapshot.errors[item.id] ?? 'No errors reported.'}</p></details>
        {snapshot.contributions.filter((entry) => entry.pluginId === item.id && entry.contribution.kind === 'setting').map((entry) => entry.contribution.kind === 'setting' ? <PluginSettingControl key={entry.contribution.id} host={host} pluginId={item.id} setting={entry.contribution} /> : null)}
      </div>
      <div className={styles.actions}><button type="button" disabled={busy} onClick={() => { void act(() => host.setEnabled(item.id, !item.enabled), item.enabled ? 'Plugin disabled.' : 'Plugin enabled.'); }}>{item.enabled ? 'Disable' : 'Enable'}</button><button type="button" disabled={busy || !item.enabled} onClick={() => { void act(() => host.reload(item.id), 'Plugin reloaded.'); }}>Reload</button>{developerMode && host.canReloadFromSource(item.id) && <button type="button" disabled={busy} onClick={() => { void act(() => host.reloadFromSource(item.id), 'Development bundle reloaded from disk.'); }}>Reload from file</button>}<button type="button" disabled={busy} onClick={() => remove(item.id)}>Uninstall</button></div>
    </div>)}</div>}
  </section>;
}
