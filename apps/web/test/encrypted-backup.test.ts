import { describe, expect, it } from 'vitest';
import { CLOUD_BACKUP_CHUNK_BYTES, decryptBackup, encryptBackup } from '../src/lib/encrypted-backup';

describe('passphrase-encrypted backup', () => {
  it('round trips multiple chunks without exposing plaintext in stored chunks', async () => {
    const archive = new Blob([new Uint8Array(CLOUD_BACKUP_CHUNK_BYTES + 19).fill(73)]);
    const chunks = new Map<number, Blob>();
    const manifest = await encryptBackup(archive, 'long independent passphrase', async (_metadata, index, blob) => { chunks.set(index, blob); });
    expect(manifest.chunks).toBe(2);
    expect(chunks.get(0)?.size).toBe(CLOUD_BACKUP_CHUNK_BYTES + 28);
    expect(new Uint8Array(await chunks.get(0)!.slice(0, 20).arrayBuffer())).not.toEqual(new Uint8Array(20).fill(73));
    const restored = await decryptBackup(manifest, 'long independent passphrase', async (index) => chunks.get(index)!);
    expect(restored.size).toBe(archive.size);
    expect(new Uint8Array(await restored.slice(0, 32).arrayBuffer())).toEqual(new Uint8Array(32).fill(73));
    expect(new Uint8Array(await restored.slice(-32).arrayBuffer())).toEqual(new Uint8Array(32).fill(73));
  }, 30_000);

  it('rejects wrong passphrases, altered ciphertext, and changed manifest metadata', async () => {
    let chunk: Blob | null = null;
    const manifest = await encryptBackup(new Blob(['secret ZIP']), 'long independent passphrase', async (_metadata, _index, blob) => { chunk = blob; });
    expect(chunk).not.toBeNull();
    await expect(decryptBackup(manifest, 'incorrect passphrase', async () => chunk!)).rejects.toThrow('incorrect or the backup is damaged');
    const tampered = new Uint8Array(await chunk!.arrayBuffer());
    tampered[tampered.length - 1]! ^= 1;
    await expect(decryptBackup(manifest, 'long independent passphrase', async () => new Blob([tampered]))).rejects.toThrow('incorrect or the backup is damaged');
    await expect(decryptBackup({ ...manifest, id: crypto.randomUUID() }, 'long independent passphrase', async () => chunk!)).rejects.toThrow('incorrect or the backup is damaged');
  });
});
