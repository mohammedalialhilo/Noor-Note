// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DexieVaultRepository } from '@noor-note/storage';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardsView } from '../src/components/DashboardsView';
import { DashboardsStore } from '../src/lib/dashboards';

vi.mock('../src/auth/AuthProvider', () => ({ useAccount: () => ({ client: null, user: null }) }));

describe('dashboard layout controls', () => {
  let repository: DexieVaultRepository;
  let name: string;
  afterEach(async () => { cleanup(); repository.close(); await Dexie.delete(name); });

  it('creates a template, hides and restores widgets, and saves the layout', async () => {
    name = `noor-note-dashboard-ui-${crypto.randomUUID()}`;
    repository = new DexieVaultRepository(name);
    const vault = await repository.initialize();
    render(<DashboardsView vaultId={vault.id} repository={repository} notes={[]} folders={[]} bookmarks={[]} recentIds={[]} bases={[]} selectedNoteId={null} activityEnabled={false} onOpenNote={vi.fn()} onOpenBase={vi.fn()} onNavigate={vi.fn()} onOpenBookmark={vi.fn()} onOpenNavigation={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Recent notes' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Customize' }));
    const recent = screen.getByRole('region', { name: 'Recent notes' });
    fireEvent.click(recent.querySelector('button:last-child')!);
    expect(screen.queryByRole('heading', { name: 'Recent notes' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show Recent notes' }));
    expect(screen.getByRole('heading', { name: 'Recent notes' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('New from template'), { target: { value: 'Study' } });
    await waitFor(() => expect(screen.getByRole('option', { name: 'Study' })).toBeTruthy());
    const saved = await new DashboardsStore(repository, vault.id).list();
    expect(saved).toHaveLength(2);
    expect(saved.find((item) => item.template === 'Study')?.widgets.some((item) => item.kind === 'baseView')).toBe(true);
  });
});
