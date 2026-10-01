// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { NoteEntry } from '@noor-note/storage';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VaultExplorer } from '../src/components/VaultExplorer';
import type { useVaultWorkspace } from '../src/hooks/useVaultWorkspace';

afterEach(cleanup);

describe('large file explorer', () => {
  it('renders a bounded window and keeps distant rows reachable', async () => {
    const vaultId = '00000000-0000-4000-8000-000000000001';
    const notes: NoteEntry[] = Array.from({ length: 400 }, (_, index) => ({
      id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, vaultId, folderId: null,
      path: `/Note ${String(index).padStart(4, '0')}.md`, title: `Note ${String(index).padStart(4, '0')}`,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null, trashGroupId: null,
      aliases: [], properties: {}, revision: 1, checksum: 'a'.repeat(64), collaborative: false,
      excerpt: '', tags: [], links: [], tasks: [], taskCount: 0,
    }));
    const vault = { id: vaultId, name: 'Large vault', createdAt: notes[0]!.createdAt, updatedAt: notes[0]!.updatedAt, deletedAt: null, settings: { sortBy: 'name', sortDirection: 'asc' } };
    const workspace = { activeVault: vault, vaults: [vault], notes, folders: [], attachments: [], selectedFolderId: null, setSelectedFolderId: vi.fn(), repository: null } as unknown as ReturnType<typeof useVaultWorkspace>;
    render(<VaultExplorer workspace={workspace} onSelectNote={vi.fn()} onCreateNote={vi.fn()} onOpenTrash={vi.fn()} onOpenPdf={vi.fn()} onOpenOcr={vi.fn()} onOpenTranscript={vi.fn()} onImport={vi.fn()} />);
    const tree = screen.getByRole('tree', { name: 'Vault files' });
    expect(screen.getAllByRole('treeitem').length).toBeLessThanOrEqual(36);
    expect(screen.queryByRole('treeitem', { name: /Note 0200/u })).toBeNull();
    fireEvent.scroll(tree, { target: { scrollTop: 31 * 200 } });
    expect(screen.getByRole('treeitem', { name: /Note 0200/u })).toBeTruthy();
    expect(screen.getAllByRole('treeitem').length).toBeLessThanOrEqual(36);
    fireEvent.keyDown(tree, { key: 'End' });
    await waitFor(() => expect(screen.getByRole('treeitem', { name: /Note 0399/u })).toBeTruthy());
  });
});
