import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { CloudBackupStore } from '../src/lib/cloud-backup';

describe('cloud backup commit', () => {
  it('uploads encrypted chunks before the manifest and scopes paths to the account', async () => {
    const owner = crypto.randomUUID();
    const uploaded: { path: string; blob: Blob }[] = [];
    const client = { storage: { from: (bucket: string) => {
      expect(bucket).toBe('noor-note-backups');
      return {
        upload: async (path: string, blob: Blob) => { uploaded.push({ path, blob }); return { error: null }; },
        remove: async () => ({ error: null }),
      };
    } } } as unknown as SupabaseClient;
    const manifest = await new CloudBackupStore(client, owner).create(new Blob(['ZIP payload']), 'long backup passphrase');
    expect(uploaded.map((item) => item.path)).toEqual([
      `${owner}/${manifest.id}/0000.chunk`, `${owner}/${manifest.id}/manifest.json`,
    ]);
    expect(await uploaded[0]!.blob.text()).not.toContain('ZIP payload');
    expect(JSON.parse(await uploaded[1]!.blob.text())).toEqual(manifest);
    expect(JSON.stringify(manifest)).not.toContain('ZIP payload');
  });

  it('ignores unfinished snapshots but reports unexpected listing failures', async () => {
    const owner = crypto.randomUUID();
    const backupId = crypto.randomUUID();
    const client = { storage: { from: () => ({
      list: async () => ({ data: [{ name: backupId }], error: null }),
      download: async () => ({ data: null, error: new Error('Object not found') }),
    }) } } as unknown as SupabaseClient;
    expect(await new CloudBackupStore(client, owner).list()).toEqual([]);
    const failed = { storage: { from: () => ({ list: async () => ({ data: null, error: new Error('Network unavailable') }) }) } } as unknown as SupabaseClient;
    await expect(new CloudBackupStore(failed, owner).list()).rejects.toThrow('Network unavailable');
  });
});
