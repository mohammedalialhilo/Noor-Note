import Dexie, { type Table } from 'dexie';
import { vaultEncryptionProfileSchema, type VaultEncryptionProfile } from '@noor-note/crypto';

class EncryptionDatabase extends Dexie {
  profiles!: Table<VaultEncryptionProfile, string>;
  constructor(name: string) { super(name); this.version(1).stores({ profiles: 'vaultId' }); }
}

/** Stores wrapped keys only. Unwrapped vault keys remain in the active tab's memory. */
export class VaultEncryptionStore {
  private readonly db: EncryptionDatabase;
  constructor(name = 'noor-note-encryption') { this.db = new EncryptionDatabase(name); }
  async profile(vaultId: string): Promise<VaultEncryptionProfile | null> {
    const stored = await this.db.profiles.get(vaultId);
    if (!stored) return null;
    const profile = vaultEncryptionProfileSchema.parse(stored);
    if (profile.vaultId !== vaultId) throw new Error('Vault key profile identity mismatch');
    return profile;
  }
  async save(profileInput: VaultEncryptionProfile): Promise<void> {
    const profile = vaultEncryptionProfileSchema.parse(profileInput);
    const existing = await this.profile(profile.vaultId);
    if (existing && existing.epoch > profile.epoch) throw new Error('Cannot replace a newer vault key');
    await this.db.profiles.put(profile);
  }
  close(): void { this.db.close(); }
}
