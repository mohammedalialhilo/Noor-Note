import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dashboardSchema } from '@noor-note/core';
import { DexieVaultRepository } from '@noor-note/storage';
import { DashboardsStore, dashboardTemplates, moveWidget, newDashboard, patchWidget } from '../src/lib/dashboards';
import { exportVaultZip, importVaultZip } from '../src/lib/vault-archive';

describe('vault dashboards', () => {
  let repository: DexieVaultRepository;
  let databaseName: string;
  beforeEach(() => {
    vi.stubGlobal('window', {});
    databaseName = `noor-note-dashboard-test-${crypto.randomUUID()}`;
    repository = new DexieVaultRepository(databaseName);
  });
  afterEach(async () => { repository.close(); await Dexie.delete(databaseName); vi.unstubAllGlobals(); });

  it('provides five distinct templates with valid widgets', async () => {
    const vault = await repository.initialize();
    expect(Object.keys(dashboardTemplates)).toEqual(['Home', 'Productivity', 'Research', 'Writing', 'Study']);
    for (const template of Object.keys(dashboardTemplates) as (keyof typeof dashboardTemplates)[]) {
      const dashboard = newDashboard(vault.id, template);
      expect(dashboardSchema.parse(dashboard).widgets.length).toBeGreaterThan(0);
      expect(new Set(dashboard.widgets.map((widget) => widget.id)).size).toBe(dashboard.widgets.length);
    }
  });

  it('persists reordering, sizing, hiding, and Base configuration', async () => {
    const vault = await repository.initialize();
    const store = new DashboardsStore(repository, vault.id);
    let dashboard = newDashboard(vault.id, 'Study');
    const first = dashboard.widgets[0]!, second = dashboard.widgets[1]!;
    dashboard = moveWidget(dashboard, first.id, second.id);
    dashboard = patchWidget(dashboard, first.id, { width: 2, height: 2, hidden: true, limit: 10 });
    const baseWidget = dashboard.widgets.find((item) => item.kind === 'baseView')!;
    dashboard = patchWidget(dashboard, baseWidget.id, { baseId: crypto.randomUUID() });
    await store.save(dashboard);
    const [stored] = await store.list();
    expect(stored!.widgets[0]!.id).toBe(second.id);
    expect(stored!.widgets.find((item) => item.id === first.id)).toMatchObject({ width: 2, height: 2, hidden: true, limit: 10 });
    expect(stored!.widgets.find((item) => item.id === baseWidget.id)?.baseId).toBeTruthy();
    await expect(new DashboardsStore(repository, crypto.randomUUID()).save(dashboard)).rejects.toThrow(/another vault/u);
  });

  it('round trips dashboards through vault ZIP and remaps Base references', async () => {
    const vault = await repository.initialize();
    const dashboard = newDashboard(vault.id, 'Research');
    const baseWidget = dashboard.widgets.find((item) => item.kind === 'baseView')!;
    await new DashboardsStore(repository, vault.id).save(patchWidget(dashboard, baseWidget.id, { baseId: crypto.randomUUID() }));
    const zip = await exportVaultZip(repository, vault.id);
    const importedVaultId = await importVaultZip(repository, zip);
    const [restored] = await new DashboardsStore(repository, importedVaultId).list();
    expect(restored?.name).toBe('Research');
    expect(restored?.id).not.toBe(dashboard.id);
    expect(restored?.widgets.find((item) => item.kind === 'baseView')?.baseId).toBeNull();
  });
});
