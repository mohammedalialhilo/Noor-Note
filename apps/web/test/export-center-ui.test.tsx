// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DexieVaultRepository } from '@noor-note/storage';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExportCenter } from '../src/components/ExportCenter';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Export Center dialog', () => {
  it('shows format-specific omissions before allowing download', async () => {
    const name = `noor-export-ui-${crypto.randomUUID()}`;
    const repository = new DexieVaultRepository(name);
    try {
      const vault = await repository.initialize();
      await repository.createNote(vault.id, null, 'Plan', '# Plan');
      const beforeExport = vi.fn(async () => undefined);
      render(<ExportCenter repository={repository} vaultId={vault.id} beforeExport={beforeExport} onClose={() => undefined} />);
      await waitFor(() => expect(screen.getByRole('region', { name: 'Portability report' })).toBeTruthy());
      expect(screen.getByText(/Local revisions and supported structured vault records/)).toBeTruthy();
      fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'note-md' } });
      expect(screen.getByText('Linked attachments and other notes are not bundled.')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Export' })).toBeTruthy();
      fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'note-pdf' } });
      expect(screen.getByText(/PDF is created through the browser print dialog/)).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Open print view' })).toBeTruthy();
      expect(beforeExport).toHaveBeenCalledOnce();
    } finally {
      repository.close();
      await Dexie.delete(name);
    }
  });
});
