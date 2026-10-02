// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DexieVaultRepository } from '@noor-note/storage';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackupCenter } from '../src/components/BackupCenter';

afterEach(() => { cleanup(); });

describe('Backup Center', () => {
  it('verifies a manual backup and restores it into a separate vault', async () => {
    const databaseName = `noor-backup-ui-${crypto.randomUUID()}`;
    const repository = new DexieVaultRepository(databaseName);
    try {
      const vault = await repository.initialize();
      await repository.createNote(vault.id, null, 'Plan', '# Plan');
      const restored = vi.fn(async (id: string) => { expect(id).toMatch(/^[0-9a-f-]{36}$/u); });
      render(<BackupCenter repository={repository} vaultId={vault.id} beforeBackup={async () => undefined} onRestored={restored} client={null} userId={null} onClose={() => undefined} />);
      fireEvent.click(screen.getByRole('button', { name: 'Create manual backup' }));
      await waitFor(() => expect(screen.getByLabelText('Verified backup preview')).toBeTruthy());
      expect(screen.getByText(/Your current vault remains in place/)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Restore into new vault' }));
      await waitFor(() => expect(restored).toHaveBeenCalledOnce());
      expect(restored.mock.calls[0]?.[0]).not.toBe(vault.id);
      expect((await repository.listVaults()).length).toBe(2);
    } finally {
      repository.close();
      await Dexie.delete(databaseName);
    }
  });
});
