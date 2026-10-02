import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { decryptBackup, encryptBackup, encryptedBackupManifestSchema, type EncryptedBackupManifest } from './encrypted-backup';
import { verifyVaultZip, type VaultBackupPreview } from './vault-archive';

const BUCKET = 'noor-note-backups';
const uuid = z.uuid();
const MAX_MANIFEST_BYTES = 4096;

export interface CloudBackupItem { manifest: EncryptedBackupManifest }

/** Cloud snapshots are independent of sync. A manifest is uploaded only after every encrypted chunk. */
export class CloudBackupStore {
  constructor(private readonly client: SupabaseClient, private readonly ownerId: string) { uuid.parse(ownerId); }

  private path(id: string, filename: string): string { return `${this.ownerId}/${uuid.parse(id)}/${filename}`; }
  private chunkPath(id: string, index: number): string { return this.path(id, `${String(index).padStart(4, '0')}.chunk`); }
  private manifestPath(id: string): string { return this.path(id, 'manifest.json'); }

  async create(archive: Blob, passphrase: string): Promise<EncryptedBackupManifest> {
    const uploaded: string[] = [];
    try {
      const manifest = await encryptBackup(archive, passphrase, async (metadata, index, chunk) => {
        const path = this.chunkPath(metadata.id, index);
        const { error } = await this.client.storage.from(BUCKET).upload(path, chunk, { upsert: false, contentType: 'application/octet-stream' });
        if (error) throw error;
        uploaded.push(path);
      });
      const path = this.manifestPath(manifest.id);
      const { error } = await this.client.storage.from(BUCKET).upload(path, new Blob([JSON.stringify(manifest)], { type: 'application/json' }), { upsert: false, contentType: 'application/json' });
      if (error) throw error;
      return manifest;
    } catch (error) {
      if (uploaded.length) await this.client.storage.from(BUCKET).remove(uploaded).catch(() => undefined);
      throw error;
    }
  }

  async manifest(id: string): Promise<EncryptedBackupManifest> {
    const { data, error } = await this.client.storage.from(BUCKET).download(this.manifestPath(id));
    if (error || !data) throw error ?? new Error('Backup manifest is unavailable');
    if (data.size > MAX_MANIFEST_BYTES) throw new Error('Backup manifest is too large');
    const parsed = encryptedBackupManifestSchema.parse(JSON.parse(await data.text()));
    if (parsed.id !== id) throw new Error('Backup manifest ID does not match its path');
    return parsed;
  }

  async list(): Promise<CloudBackupItem[]> {
    const result: CloudBackupItem[] = [];
    for (let offset = 0; offset < 1000; offset += 100) {
      const { data, error } = await this.client.storage.from(BUCKET).list(this.ownerId, { limit: 100, offset, sortBy: { column: 'name', order: 'desc' } });
      if (error) throw error;
      for (const item of data ?? []) {
        if (!uuid.safeParse(item.name).success) continue;
        try { result.push({ manifest: await this.manifest(item.name) }); }
        catch (cause) {
          // An interrupted upload has no commit manifest; other errors need to be visible.
          if (!(cause instanceof Error && /not found|does not exist|404/iu.test(cause.message))) throw cause;
        }
      }
      if (!data || data.length < 100) break;
    }
    return result.sort((a, b) => b.manifest.createdAt.localeCompare(a.manifest.createdAt));
  }

  async open(id: string, passphrase: string): Promise<{ archive: Blob; preview: VaultBackupPreview }> {
    const manifest = await this.manifest(id);
    const archive = await decryptBackup(manifest, passphrase, async (index) => {
      const { data, error } = await this.client.storage.from(BUCKET).download(this.chunkPath(id, index));
      if (error || !data) throw error ?? new Error('Backup chunk is unavailable');
      return data;
    });
    return { archive, preview: await verifyVaultZip(archive) };
  }
}
