import { z } from 'zod';

export const CLOUD_BACKUP_CHUNK_BYTES = 4 * 1024 * 1024;
export const MAX_CLOUD_BACKUP_BYTES = 512 * 1024 * 1024;
const ITERATIONS = 600_000;
const hexSalt = z.string().regex(/^[a-f0-9]{32}$/u);

export const encryptedBackupManifestSchema = z.object({
  format: z.literal('noor-note-encrypted-backup'),
  version: z.literal(1),
  id: z.uuid(),
  createdAt: z.iso.datetime({ offset: true }),
  kdf: z.literal('PBKDF2-HMAC-SHA256'),
  iterations: z.literal(ITERATIONS),
  salt: hexSalt,
  chunkBytes: z.literal(CLOUD_BACKUP_CHUNK_BYTES),
  plaintextBytes: z.number().int().positive().max(MAX_CLOUD_BACKUP_BYTES),
  chunks: z.number().int().positive().max(MAX_CLOUD_BACKUP_BYTES / CLOUD_BACKUP_CHUNK_BYTES),
}).strict().superRefine((manifest, context) => {
  if (manifest.chunks !== Math.ceil(manifest.plaintextBytes / manifest.chunkBytes)) context.addIssue({ code: 'custom', path: ['chunks'], message: 'Backup chunk count is inconsistent' });
});
export type EncryptedBackupManifest = z.infer<typeof encryptedBackupManifestSchema>;

function bytes(value: Uint8Array): ArrayBuffer { return Uint8Array.from(value).buffer; }
function saltBytes(hex: string): Uint8Array { return Uint8Array.from(hex.match(/.{2}/gu) ?? [], (part) => Number.parseInt(part, 16)); }
function hex(value: Uint8Array): string { return Array.from(value, (part) => part.toString(16).padStart(2, '0')).join(''); }
function aad(manifest: EncryptedBackupManifest, index: number): ArrayBuffer { return bytes(new TextEncoder().encode(`${JSON.stringify(manifest)}:${index}`)); }

async function keyFor(passphrase: string, manifest: EncryptedBackupManifest): Promise<CryptoKey> {
  if (passphrase.length < 12 || passphrase.length > 1024) throw new Error('Use a backup passphrase between 12 and 1,024 characters');
  const source = await crypto.subtle.importKey('raw', bytes(new TextEncoder().encode(passphrase)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: bytes(saltBytes(manifest.salt)), iterations: manifest.iterations }, source, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Writes each authenticated chunk before returning the manifest commit marker. */
export async function encryptBackup(archive: Blob, passphrase: string, writeChunk: (manifest: EncryptedBackupManifest, index: number, encrypted: Blob) => Promise<void>): Promise<EncryptedBackupManifest> {
  if (archive.size < 1 || archive.size > MAX_CLOUD_BACKUP_BYTES) throw new Error('Cloud backup supports archives up to 512 MiB');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const manifest = encryptedBackupManifestSchema.parse({
    format: 'noor-note-encrypted-backup', version: 1, id: crypto.randomUUID(), createdAt: new Date().toISOString(),
    kdf: 'PBKDF2-HMAC-SHA256', iterations: ITERATIONS, salt: hex(salt), chunkBytes: CLOUD_BACKUP_CHUNK_BYTES,
    plaintextBytes: archive.size, chunks: Math.ceil(archive.size / CLOUD_BACKUP_CHUNK_BYTES),
  });
  const key = await keyFor(passphrase, manifest);
  for (let index = 0; index < manifest.chunks; index++) {
    const plain = await archive.slice(index * manifest.chunkBytes, (index + 1) * manifest.chunkBytes).arrayBuffer();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: bytes(iv), additionalData: aad(manifest, index), tagLength: 128 }, key, plain);
    await writeChunk(manifest, index, new Blob([bytes(iv), cipher], { type: 'application/octet-stream' }));
  }
  return manifest;
}

export async function decryptBackup(input: unknown, passphrase: string, readChunk: (index: number) => Promise<Blob>): Promise<Blob> {
  const manifest = encryptedBackupManifestSchema.parse(input);
  const key = await keyFor(passphrase, manifest);
  const plainParts: BlobPart[] = [];
  for (let index = 0; index < manifest.chunks; index++) {
    const encrypted = await readChunk(index);
    const expected = Math.min(manifest.chunkBytes, manifest.plaintextBytes - index * manifest.chunkBytes);
    if (encrypted.size !== expected + 28) throw new Error('Encrypted backup chunk has the wrong size');
    const iv = new Uint8Array(await encrypted.slice(0, 12).arrayBuffer());
    try {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(iv), additionalData: aad(manifest, index), tagLength: 128 }, key, await encrypted.slice(12).arrayBuffer());
      if (plain.byteLength !== expected) throw new Error('Encrypted backup chunk has the wrong size');
      plainParts.push(plain);
    } catch { throw new Error('Backup passphrase is incorrect or the backup is damaged'); }
  }
  return new Blob(plainParts, { type: 'application/zip' });
}
