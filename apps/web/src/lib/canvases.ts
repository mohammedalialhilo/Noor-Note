import { canvasSchema, newCanvas, readCanvasDocument, safeFileStem, withCanvasDocument, type Canvas, type CanvasDocument } from '@noor-note/core';
import type { VaultRepository } from '@noor-note/storage';

/** Persists only Canvas layout and references; note and attachment data stay in the vault. */
export class CanvasesStore {
  constructor(private readonly repository: VaultRepository, private readonly vaultId: string) {}

  async list(): Promise<Canvas[]> {
    return (await this.repository.listObjects('canvas', this.vaultId)).map((item) => { const canvas = canvasSchema.parse(item); readCanvasDocument(canvas); return canvas; }).sort((a, b) => a.title.localeCompare(b.title));
  }
  async create(name: string, document?: CanvasDocument): Promise<Canvas> {
    const canvas = newCanvas(this.vaultId, name, await this.list(), document);
    await this.repository.putObject('canvas', canvas);
    return canvas;
  }
  async save(canvas: Canvas, document: CanvasDocument): Promise<Canvas> {
    if (canvas.vaultId !== this.vaultId || canvas.deletedAt) throw new Error('Canvas is unavailable in this vault');
    const updated = withCanvasDocument(canvas, document);
    await this.repository.putObject('canvas', updated);
    return updated;
  }
  async rename(canvas: Canvas, name: string): Promise<Canvas> {
    if (canvas.vaultId !== this.vaultId || canvas.deletedAt) throw new Error('Canvas is unavailable in this vault');
    const title = name.trim();
    if (!title || title.length > 200) throw new Error('Enter a Canvas name up to 200 characters');
    const path = `/Canvases/${safeFileStem(title)}.canvas`;
    if ((await this.list()).some((item) => item.id !== canvas.id && !item.deletedAt && item.path.toLocaleLowerCase() === path.toLocaleLowerCase())) throw new Error('A Canvas with this name already exists');
    const updated = canvasSchema.parse({ ...canvas, title, path, updatedAt: new Date().toISOString() });
    await this.repository.putObject('canvas', updated);
    return updated;
  }
  async remove(canvas: Canvas): Promise<Canvas> {
    if (canvas.vaultId !== this.vaultId) throw new Error('Canvas is unavailable in this vault');
    const updated = canvasSchema.parse({ ...canvas, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    await this.repository.putObject('canvas', updated);
    return updated;
  }
  async restore(canvas: Canvas): Promise<Canvas> {
    if (canvas.vaultId !== this.vaultId) throw new Error('Canvas is unavailable in this vault');
    if ((await this.list()).some((item) => item.id !== canvas.id && !item.deletedAt && item.path.toLocaleLowerCase() === canvas.path.toLocaleLowerCase())) throw new Error('Rename the existing Canvas before restoring this one');
    const updated = canvasSchema.parse({ ...canvas, deletedAt: null, updatedAt: new Date().toISOString() });
    await this.repository.putObject('canvas', updated);
    return updated;
  }
}
