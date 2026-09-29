import { baseSchema, newBase, readBaseDefinition, safeFileStem, withBaseDefinition, type Base, type BaseDefinition } from '@noor-note/core';
import type { VaultRepository } from '@noor-note/storage';

/** Base records only save a query and view configuration; rows remain Markdown notes. */
export class BasesStore {
  constructor(private readonly repository: VaultRepository, private readonly vaultId: string) {}

  async list(): Promise<Base[]> {
    const objects = await this.repository.listObjects('base', this.vaultId);
    return objects.map((item) => { const base = baseSchema.parse(item); readBaseDefinition(base); return base; }).sort((a, b) => a.title.localeCompare(b.title));
  }

  async create(name: string): Promise<Base> {
    const base = newBase(this.vaultId, name, await this.list());
    await this.repository.putObject('base', base);
    return base;
  }

  async save(base: Base, definition: BaseDefinition): Promise<Base> {
    if (base.vaultId !== this.vaultId || base.deletedAt) throw new Error('Base is not available in this vault');
    const updated = withBaseDefinition(base, definition);
    await this.repository.putObject('base', updated);
    return updated;
  }

  async rename(base: Base, name: string): Promise<Base> {
    if (base.vaultId !== this.vaultId || base.deletedAt) throw new Error('Base is not available in this vault');
    const title = name.trim();
    if (!title || title.length > 200) throw new Error('Enter a Base name up to 200 characters');
    const path = `/Bases/${safeFileStem(title)}.base`;
    if ((await this.list()).some((item) => item.id !== base.id && !item.deletedAt && item.path.toLocaleLowerCase() === path.toLocaleLowerCase())) throw new Error('A Base with this name already exists');
    const updated = baseSchema.parse({ ...base, title, path, updatedAt: new Date().toISOString() });
    await this.repository.putObject('base', updated);
    return updated;
  }

  async remove(base: Base): Promise<Base> {
    if (base.vaultId !== this.vaultId) throw new Error('Base is not available in this vault');
    const now = new Date().toISOString();
    const updated = baseSchema.parse({ ...base, deletedAt: now, updatedAt: now });
    await this.repository.putObject('base', updated);
    return updated;
  }

  async restore(base: Base): Promise<Base> {
    if (base.vaultId !== this.vaultId) throw new Error('Base is not available in this vault');
    if ((await this.list()).some((item) => item.id !== base.id && !item.deletedAt && item.path.toLocaleLowerCase() === base.path.toLocaleLowerCase())) throw new Error('Rename the existing Base before restoring this one');
    const updated = baseSchema.parse({ ...base, deletedAt: null, updatedAt: new Date().toISOString() });
    await this.repository.putObject('base', updated);
    return updated;
  }
}
