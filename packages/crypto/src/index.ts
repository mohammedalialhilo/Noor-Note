import { z } from 'zod';

const encoded = z.string().regex(/^[A-Za-z0-9_-]+$/u).max(4_000_000);
const nonceEncoded = encoded.refine((value) => fromBase64Url(value).length === 12, 'Expected a 96-bit nonce');
const saltEncoded = encoded.refine((value) => fromBase64Url(value).length === 16, 'Expected a 128-bit salt');
const keyEpoch = z.number().int().positive().max(0xffffffff);
const uuid = z.uuid();
const text = (value: string) => new TextEncoder().encode(value);
const asBuffer = (value: Uint8Array): BufferSource => value as BufferSource;
const random = (size: number) => crypto.getRandomValues(new Uint8Array(size));

export const sealedBoxSchema = z.object({ version: z.literal(1), epoch: keyEpoch, nonce: nonceEncoded, ciphertext: encoded }).strict();
export type SealedBox = z.infer<typeof sealedBoxSchema>;
export const recoveryEnvelopeSchema = z.object({ version: z.literal(1), vaultId: uuid, epoch: keyEpoch, wrappedKey: sealedBoxSchema }).strict();
export type RecoveryEnvelope = z.infer<typeof recoveryEnvelopeSchema>;
export const vaultEncryptionProfileSchema = z.object({
  version: z.literal(1), vaultId: uuid, epoch: keyEpoch,
  passphrase: z.object({ kdf: z.literal('PBKDF2-HMAC-SHA256'), salt: saltEncoded, iterations: z.number().int().min(600_000).max(5_000_000), wrappedKey: sealedBoxSchema }).strict(),
  recovery: recoveryEnvelopeSchema,
}).strict();
export type VaultEncryptionProfile = z.infer<typeof vaultEncryptionProfileSchema>;

function toBase64Url(value: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < value.length; offset += 0x8000) chunks.push(String.fromCharCode(...value.subarray(offset, offset + 0x8000)));
  return btoa(chunks.join('')).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}
function fromBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error('Invalid encoded key material');
  const binary = atob(value.replace(/-/gu, '+').replace(/_/gu, '/') + '='.repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
async function aesKey(raw: Uint8Array, uses: KeyUsage[] = ['encrypt', 'decrypt']): Promise<CryptoKey> {
  if (raw.length !== 32) throw new Error('Expected a 256-bit key');
  return crypto.subtle.importKey('raw', asBuffer(raw), 'AES-GCM', false, uses);
}
async function seal(key: CryptoKey, plaintext: Uint8Array, aad: Uint8Array, epoch: number): Promise<SealedBox> {
  const nonce = random(12);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: asBuffer(nonce), additionalData: asBuffer(aad), tagLength: 128 }, key, asBuffer(plaintext)));
  return sealedBoxSchema.parse({ version: 1, epoch, nonce: toBase64Url(nonce), ciphertext: toBase64Url(ciphertext) });
}
async function open(key: CryptoKey, input: SealedBox, aad: Uint8Array, epoch: number): Promise<Uint8Array> {
  const box = sealedBoxSchema.parse(input);
  if (box.epoch !== epoch) throw new Error('Encryption key epoch mismatch');
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: asBuffer(fromBase64Url(box.nonce)), additionalData: asBuffer(aad), tagLength: 128 }, key, asBuffer(fromBase64Url(box.ciphertext))));
}
function aad(vaultId: string, epoch: number, purpose: string, itemId: string): Uint8Array {
  return text(`noor-note/e2ee/v1/${vaultId}/${epoch}/${purpose}/${itemId}`);
}
async function passphraseKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  if (passphrase.length < 12 || passphrase.length > 1024) throw new Error('Use an encryption passphrase of 12–1024 characters');
  const source = await crypto.subtle.importKey('raw', asBuffer(text(passphrase)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: asBuffer(salt), iterations }, source, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export class VaultCipher {
  private constructor(readonly vaultId: string, readonly epoch: number, private readonly key: CryptoKey) {}
  static async fromRaw(vaultId: string, epoch: number, raw: Uint8Array): Promise<VaultCipher> {
    uuid.parse(vaultId); keyEpoch.parse(epoch);
    return new VaultCipher(vaultId, epoch, await aesKey(raw));
  }
  async sealJson(kind: string, itemId: string, value: unknown): Promise<SealedBox> {
    uuid.parse(itemId);
    return seal(this.key, text(JSON.stringify(value)), aad(this.vaultId, this.epoch, kind, itemId), this.epoch);
  }
  async openJson(kind: string, itemId: string, box: SealedBox): Promise<unknown> {
    uuid.parse(itemId);
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await open(this.key, box, aad(this.vaultId, this.epoch, kind, itemId), this.epoch)));
  }
  async sealAttachment(itemId: string, blob: Blob): Promise<Blob> {
    uuid.parse(itemId);
    if (blob.size > 64 * 1024 * 1024) throw new Error('Encrypted attachments are limited to 64 MiB until streaming encryption is available');
    const nonce = random(12);
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: asBuffer(nonce), additionalData: asBuffer(aad(this.vaultId, this.epoch, 'attachment-bytes', itemId)), tagLength: 128 }, this.key, await blob.arrayBuffer());
    const header = new Uint8Array(22);
    header.set(text('NNENC1'), 0);
    new DataView(header.buffer).setUint32(6, this.epoch, false);
    header.set(nonce, 10);
    return new Blob([header, ciphertext], { type: 'application/octet-stream' });
  }
  async openAttachment(itemId: string, blob: Blob, mime: string): Promise<Blob> {
    uuid.parse(itemId);
    if (blob.size < 38 || blob.size > 64 * 1024 * 1024 + 38) throw new Error('Invalid encrypted attachment size');
    const raw = new Uint8Array(await blob.arrayBuffer());
    if (new TextDecoder().decode(raw.subarray(0, 6)) !== 'NNENC1' || new DataView(raw.buffer).getUint32(6, false) !== this.epoch) throw new Error('Encrypted attachment format or key epoch mismatch');
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: asBuffer(raw.subarray(10, 22)), additionalData: asBuffer(aad(this.vaultId, this.epoch, 'attachment-bytes', itemId)), tagLength: 128 }, this.key, asBuffer(raw.subarray(22)));
    return new Blob([plaintext], { type: mime });
  }
}

const ITERATIONS = 600_000;
async function wrapPassphrase(raw: Uint8Array, vaultId: string, epoch: number, passphrase: string) {
  const salt = random(16);
  const key = await passphraseKey(passphrase, salt, ITERATIONS);
  return { kdf: 'PBKDF2-HMAC-SHA256' as const, salt: toBase64Url(salt), iterations: ITERATIONS,
    wrappedKey: await seal(key, raw, aad(vaultId, epoch, 'passphrase-key', vaultId), epoch) };
}
function recoveryBytes(code: string): Uint8Array {
  if (!code.startsWith('NNR1-')) throw new Error('Invalid Noor Note recovery code');
  const raw = fromBase64Url(code.slice(5));
  if (raw.length !== 32) throw new Error('Invalid Noor Note recovery code');
  return raw;
}
export async function createVaultEncryption(vaultId: string, passphrase: string): Promise<{ profile: VaultEncryptionProfile; recoveryCode: string; cipher: VaultCipher }> {
  uuid.parse(vaultId);
  const raw = random(32), recovery = random(32), epoch = 1;
  try {
    const profile = vaultEncryptionProfileSchema.parse({ version: 1, vaultId, epoch,
      passphrase: await wrapPassphrase(raw, vaultId, epoch, passphrase),
      recovery: { version: 1, vaultId, epoch, wrappedKey: await seal(await aesKey(recovery), raw, aad(vaultId, epoch, 'recovery-key', vaultId), epoch) },
    });
    return { profile, recoveryCode: `NNR1-${toBase64Url(recovery)}`, cipher: await VaultCipher.fromRaw(vaultId, epoch, raw) };
  } finally { raw.fill(0); recovery.fill(0); }
}
export async function unlockVault(profileInput: VaultEncryptionProfile, passphrase: string): Promise<VaultCipher> {
  const profile = vaultEncryptionProfileSchema.parse(profileInput);
  try {
    const key = await passphraseKey(passphrase, fromBase64Url(profile.passphrase.salt), profile.passphrase.iterations);
    const raw = await open(key, profile.passphrase.wrappedKey, aad(profile.vaultId, profile.epoch, 'passphrase-key', profile.vaultId), profile.epoch);
    try { return await VaultCipher.fromRaw(profile.vaultId, profile.epoch, raw); } finally { raw.fill(0); }
  } catch { throw new Error('Incorrect passphrase or damaged vault key'); }
}
export async function recoverVault(envelopeInput: RecoveryEnvelope, code: string, newPassphrase: string): Promise<{ profile: VaultEncryptionProfile; cipher: VaultCipher }> {
  const envelope = recoveryEnvelopeSchema.parse(envelopeInput);
  const recovery = recoveryBytes(code);
  try {
    const raw = await open(await aesKey(recovery), envelope.wrappedKey, aad(envelope.vaultId, envelope.epoch, 'recovery-key', envelope.vaultId), envelope.epoch);
    try {
      const profile = vaultEncryptionProfileSchema.parse({ version: 1, vaultId: envelope.vaultId, epoch: envelope.epoch,
        passphrase: await wrapPassphrase(raw, envelope.vaultId, envelope.epoch, newPassphrase), recovery: envelope });
      return { profile, cipher: await VaultCipher.fromRaw(envelope.vaultId, envelope.epoch, raw) };
    } finally { raw.fill(0); }
  } catch { throw new Error('Incorrect recovery code or damaged vault key'); }
  finally { recovery.fill(0); }
}

const publicDeviceKeySchema = z.object({ kty: z.literal('EC'), crv: z.literal('P-256'), x: encoded, y: encoded });
export type PublicDeviceKey = z.infer<typeof publicDeviceKeySchema>;
export const deviceEnvelopeSchema = z.object({ version: z.literal(1), vaultId: uuid, epoch: keyEpoch, recipientFingerprint: z.string().regex(/^[a-f0-9]{64}$/u), ephemeralPublicKey: publicDeviceKeySchema, salt: saltEncoded, wrappedKey: sealedBoxSchema }).strict();
export type DeviceEnvelope = z.infer<typeof deviceEnvelopeSchema>;
export async function deviceFingerprint(publicKey: PublicDeviceKey): Promise<string> {
  const key = publicDeviceKeySchema.parse(publicKey);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', asBuffer(text(`P-256:${key.x}:${key.y}`))));
  return Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('');
}
export async function createDeviceKeyPair(): Promise<{ privateKey: CryptoKey; publicKey: PublicDeviceKey; fingerprint: string }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const publicKey = publicDeviceKeySchema.parse(await crypto.subtle.exportKey('jwk', pair.publicKey));
  return { privateKey: pair.privateKey, publicKey, fingerprint: await deviceFingerprint(publicKey) };
}
async function agreementKey(privateKey: CryptoKey, publicKey: PublicDeviceKey, salt: Uint8Array, vaultId: string, epoch: number, recipientFingerprint: string): Promise<CryptoKey> {
  const imported = await crypto.subtle.importKey('jwk', publicDeviceKeySchema.parse(publicKey), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: imported }, privateKey, 256));
  try {
    const source = await crypto.subtle.importKey('raw', asBuffer(shared), 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: asBuffer(salt), info: asBuffer(aad(vaultId, epoch, 'device-agreement', recipientFingerprint)) }, source, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  } finally { shared.fill(0); }
}
export async function wrapVaultKeyForDevice(rawVaultKey: Uint8Array, vaultId: string, epoch: number, recipientPublicKey: PublicDeviceKey): Promise<DeviceEnvelope> {
  uuid.parse(vaultId); keyEpoch.parse(epoch);
  if (rawVaultKey.length !== 32) throw new Error('Expected a 256-bit vault key');
  const fingerprint = await deviceFingerprint(recipientPublicKey);
  const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const salt = random(16);
  const key = await agreementKey(ephemeral.privateKey, recipientPublicKey, salt, vaultId, epoch, fingerprint);
  return deviceEnvelopeSchema.parse({ version: 1, vaultId, epoch, recipientFingerprint: fingerprint,
    ephemeralPublicKey: await crypto.subtle.exportKey('jwk', ephemeral.publicKey), salt: toBase64Url(salt),
    wrappedKey: await seal(key, rawVaultKey, aad(vaultId, epoch, 'device-key', fingerprint), epoch) });
}
export async function unwrapVaultKeyForDevice(envelopeInput: DeviceEnvelope, privateKey: CryptoKey, ownPublicKey: PublicDeviceKey): Promise<VaultCipher> {
  const envelope = deviceEnvelopeSchema.parse(envelopeInput);
  const fingerprint = await deviceFingerprint(ownPublicKey);
  if (fingerprint !== envelope.recipientFingerprint) throw new Error('Key envelope is for another device');
  const key = await agreementKey(privateKey, envelope.ephemeralPublicKey, fromBase64Url(envelope.salt), envelope.vaultId, envelope.epoch, fingerprint);
  const raw = await open(key, envelope.wrappedKey, aad(envelope.vaultId, envelope.epoch, 'device-key', fingerprint), envelope.epoch);
  try { return await VaultCipher.fromRaw(envelope.vaultId, envelope.epoch, raw); } finally { raw.fill(0); }
}

export async function wrapUnlockedVaultForDevice(profileInput: VaultEncryptionProfile, passphrase: string, recipientPublicKey: PublicDeviceKey): Promise<DeviceEnvelope> {
  const profile = vaultEncryptionProfileSchema.parse(profileInput);
  const key = await passphraseKey(passphrase, fromBase64Url(profile.passphrase.salt), profile.passphrase.iterations);
  const raw = await open(key, profile.passphrase.wrappedKey, aad(profile.vaultId, profile.epoch, 'passphrase-key', profile.vaultId), profile.epoch);
  try { return await wrapVaultKeyForDevice(raw, profile.vaultId, profile.epoch, recipientPublicKey); } finally { raw.fill(0); }
}
