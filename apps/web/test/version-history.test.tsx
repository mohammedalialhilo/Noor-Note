// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeVaultNote, type Revision } from '@noor-note/core';
import type { VaultRepository } from '@noor-note/storage';
import { VersionHistory } from '../src/components/VersionHistory';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('version history dialog', () => {
  it('previews an older checkpoint and restores it only after confirmation', async () => {
    const current = await makeVaultNote({ vaultId: crypto.randomUUID(), title: 'Plan', markdown: 'New text' });
    const older: Revision = { id: crypto.randomUUID(), vaultId: current.vaultId, noteId: current.id, number: 1, title: 'Draft', path: current.path, markdown: 'Old text', checksum: current.checksum, createdAt: current.createdAt, kind: 'manual', metadata: { folderId: null, aliases: [], properties: {} } };
    const latest: Revision = { ...older, id: crypto.randomUUID(), number: 2, title: current.title, markdown: current.markdown, createdAt: current.updatedAt };
    const restoreRevision = vi.fn(async () => ({ ...current, markdown: older.markdown, revision: 3 }));
    const repository = { getNote: async () => ({ ...current, revision: 2 }), listRevisions: async () => [latest, older], restoreRevision, duplicateRevision: async () => current } as unknown as VaultRepository;
    const onRestored = vi.fn(async () => undefined);
    vi.stubGlobal('confirm', vi.fn(() => true));
    render(<VersionHistory noteId={current.id} repository={repository} flushPending={async () => undefined} onClose={() => undefined} onRestored={onRestored} onDuplicated={async () => undefined} />);
    expect(await screen.findByText('2 changed lines')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Side by side' }));
    expect(screen.getByRole('region', { name: 'Side by side Markdown diff' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.getByText('Old text')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Restore revision' }));
    await waitFor(() => expect(restoreRevision).toHaveBeenCalledWith(current.id, older.id, 2));
    expect(onRestored).toHaveBeenCalledOnce();
  });
});
