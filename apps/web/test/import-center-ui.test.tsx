// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DexieVaultRepository, type AttachmentBytesStore } from '@noor-note/storage';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImportCenter } from '../src/components/ImportCenter';

afterEach(cleanup);

describe('Import Center preview', () => {
  it('requires explicit confirmation before overwriting a previewed note conflict', async () => {
    const databaseName = `noor-import-ui-${crypto.randomUUID()}`;
    const blobs = new Map<string, Blob>();
    const bytes: AttachmentBytesStore = { async write(id, blob) { blobs.set(id, blob); return 'indexeddb'; }, async read(item) { return blobs.get(item.id); }, async remove(item) { blobs.delete(item.id); } };
    const repository = new DexieVaultRepository(databaseName, bytes);
    try {
      const vault = await repository.initialize();
      const current = await repository.createNote(vault.id, null, 'Plan', '# Old');
      const input = new File(['# New'], 'Plan.md');
      Object.defineProperty(input, 'text', { value: async () => '# New' });
      const onClose = vi.fn();
      const onImported = vi.fn(async () => undefined);
      const beforeImport = vi.fn(async () => undefined);
      render(<ImportCenter files={[input]} repository={repository} vaults={[vault]} initialVaultId={vault.id} initialFolderId={null} beforeImport={beforeImport} onClose={onClose} onImported={onImported} />);
      await waitFor(() => expect(screen.getByText('1 potential conflicts')).toBeTruthy());
      expect(screen.getByText(/Plan \(imported 2\)\.md/)).toBeTruthy();
      fireEvent.click(screen.getByRole('radio', { name: 'Overwrite existing notes' }));
      const submit = screen.getByRole('button', { name: 'Import 1 item' }) as HTMLButtonElement;
      expect(submit.disabled).toBe(true);
      fireEvent.click(screen.getByRole('checkbox', { name: /I confirm existing note content/ }));
      await waitFor(() => expect(submit.disabled).toBe(false));
      fireEvent.click(submit);
      await waitFor(() => expect(onImported).toHaveBeenCalledWith(1, vault.id));
      expect(beforeImport).toHaveBeenCalledOnce();
      expect((await repository.getNote(current.id))?.markdown).toBe('# New');
      expect(screen.getByText(/Imported 1 item/)).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Download report' })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      expect(onClose).toHaveBeenCalledOnce();
    } finally {
      repository.close();
      await Dexie.delete(databaseName);
    }
  });
});
