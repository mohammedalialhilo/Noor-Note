import { dashboardSchema, dashboardWidgetKindSchema, type Dashboard, type DashboardWidget, type DashboardWidgetKind } from '@noor-note/core';
import type { VaultRepository } from '@noor-note/storage';

export const dashboardTemplates = {
  Home: ['recentNotes', 'tasks', 'calendar', 'favorites', 'graphSummary', 'recentlyModified'],
  Productivity: ['tasks', 'calendar', 'recentNotes', 'bookmarks', 'recentActivity'],
  Research: ['bookmarks', 'baseView', 'unlinkedMentions', 'graphSummary', 'recentNotes', 'aiSuggestions'],
  Writing: ['writingStatistics', 'recentlyModified', 'recentNotes', 'unlinkedMentions', 'favorites'],
  Study: ['tasks', 'calendar', 'bookmarks', 'baseView', 'writingStatistics', 'aiSuggestions'],
} as const satisfies Record<string, readonly DashboardWidgetKind[]>;
export type DashboardTemplate = keyof typeof dashboardTemplates;
export const widgetLabels: Record<DashboardWidgetKind, string> = {
  recentNotes: 'Recent notes', recentlyModified: 'Recently modified', tasks: 'Tasks', calendar: 'Calendar',
  favorites: 'Favorites', bookmarks: 'Bookmarks', unlinkedMentions: 'Unlinked mentions', graphSummary: 'Graph summary',
  writingStatistics: 'Writing statistics', baseView: 'Base view', aiSuggestions: 'AI suggestions', recentActivity: 'Recent activity',
};
export const widgetKinds = dashboardWidgetKindSchema.options;

export function newWidget(kind: DashboardWidgetKind): DashboardWidget {
  return { id: crypto.randomUUID(), kind, width: kind === 'calendar' || kind === 'baseView' ? 2 : 1, height: 1, hidden: false, limit: 5, baseId: null };
}
export function newDashboard(vaultId: string, template: DashboardTemplate, name: string = template): Dashboard {
  const now = new Date().toISOString();
  return dashboardSchema.parse({ id: crypto.randomUUID(), vaultId, name, template, widgets: dashboardTemplates[template].map(newWidget), createdAt: now, updatedAt: now });
}
export function moveWidget(dashboard: Dashboard, widgetId: string, targetId: string): Dashboard {
  const from = dashboard.widgets.findIndex((item) => item.id === widgetId);
  const to = dashboard.widgets.findIndex((item) => item.id === targetId);
  if (from < 0 || to < 0 || from === to) return dashboard;
  const widgets = [...dashboard.widgets];
  const [item] = widgets.splice(from, 1);
  widgets.splice(to, 0, item!);
  return dashboardSchema.parse({ ...dashboard, widgets, updatedAt: new Date().toISOString() });
}
export function patchWidget(dashboard: Dashboard, widgetId: string, patch: Partial<Pick<DashboardWidget, 'width' | 'height' | 'hidden' | 'limit' | 'baseId'>>): Dashboard {
  return dashboardSchema.parse({ ...dashboard, widgets: dashboard.widgets.map((widget) => widget.id === widgetId ? { ...widget, ...patch } : widget), updatedAt: new Date().toISOString() });
}

export class DashboardsStore {
  constructor(private readonly repository: VaultRepository, private readonly vaultId: string) {}
  async list(): Promise<Dashboard[]> {
    return (await this.repository.listObjects('dashboard', this.vaultId)).map((item) => dashboardSchema.parse(item)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async save(input: Dashboard): Promise<Dashboard> {
    const dashboard = dashboardSchema.parse(input);
    if (dashboard.vaultId !== this.vaultId) throw new Error('Dashboard belongs to another vault.');
    await this.repository.putObject('dashboard', dashboard);
    return dashboard;
  }
  async remove(dashboard: Dashboard): Promise<void> {
    if (dashboard.vaultId !== this.vaultId) throw new Error('Dashboard belongs to another vault.');
    await this.repository.deleteObject(dashboard.id);
  }
}
