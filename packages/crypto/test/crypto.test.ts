import { describe, expect, it } from 'vitest';
import { createDeviceKeyPair, createVaultEncryption, recoverVault, unlockVault, unwrapVaultKeyForDevice, wrapUnlockedVaultForDevice } from '../src';

describe('vault encryption', () => {
  it('encrypts authenticated records and recovers the same key with a recovery code', async () => {
    const vaultId = crypto.randomUUID(), noteId = crypto.randomUUID();
    const created = await createVaultEncryption(vaultId, 'correct horse battery staple');
    const sealed = await created.cipher.sealJson('note', noteId, { markdown: 'private #ideas' });
    expect(JSON.stringify(sealed)).not.toContain('private');
    expect(await (await unlockVault(created.profile, 'correct horse battery staple')).openJson('note', noteId, sealed)).toEqual({ markdown: 'private #ideas' });
    await expect(unlockVault(created.profile, 'incorrect passphrase')).rejects.toThrow(/Incorrect passphrase/);
    await expect(created.cipher.openJson('note', crypto.randomUUID(), sealed)).rejects.toThrow();
    await expect(created.cipher.openJson('folder', noteId, sealed)).rejects.toThrow();
    const recovered = await recoverVault(created.profile.recovery, created.recoveryCode, 'another long passphrase');
    expect(await recovered.cipher.openJson('note', noteId, sealed)).toEqual({ markdown: 'private #ideas' });
    await expect(recoverVault(created.profile.recovery, `NNR1-${'A'.repeat(43)}`, 'another long passphrase')).rejects.toThrow();
  });

  it('encrypts attachment bytes, rejects tampering, and restores the original MIME type', async () => {
    const { cipher } = await createVaultEncryption(crypto.randomUUID(), 'correct horse battery staple');
    const id = crypto.randomUUID(), original = new Blob([new Uint8Array([0, 1, 2, 254, 255])], { type: 'image/png' });
    const sealed = await cipher.sealAttachment(id, original);
    expect(sealed.type).toBe('application/octet-stream');
    expect(sealed.size).toBeGreaterThan(original.size);
    const restored = await cipher.openAttachment(id, sealed, original.type);
    expect(restored.type).toBe('image/png');
    expect(new Uint8Array(await restored.arrayBuffer())).toEqual(new Uint8Array(await original.arrayBuffer()));
    await expect(cipher.openAttachment(crypto.randomUUID(), sealed, original.type)).rejects.toThrow();
    const corrupted = new Uint8Array(await sealed.arrayBuffer()); corrupted[corrupted.length - 1] = corrupted[corrupted.length - 1]! ^ 1;
    await expect(cipher.openAttachment(id, new Blob([corrupted]), original.type)).rejects.toThrow();
  });

  it('wraps a vault key to a verified recipient device without storing a shared plaintext password', async () => {
    const vaultId = crypto.randomUUID();
    const created = await createVaultEncryption(vaultId, 'correct horse battery staple');
    const recipient = await createDeviceKeyPair(), other = await createDeviceKeyPair();
    const envelope = await wrapUnlockedVaultForDevice(created.profile, 'correct horse battery staple', recipient.publicKey);
    expect(envelope.recipientFingerprint).toBe(recipient.fingerprint);
    const opened = await unwrapVaultKeyForDevice(envelope, recipient.privateKey, recipient.publicKey);
    const id = crypto.randomUUID(), sealed = await created.cipher.sealJson('note', id, { text: 'shared' });
    expect(await opened.openJson('note', id, sealed)).toEqual({ text: 'shared' });
    await expect(unwrapVaultKeyForDevice(envelope, other.privateKey, other.publicKey)).rejects.toThrow(/another device/);
  });
});
