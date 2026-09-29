import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendCanvasNode, createCanvasNode, readCanvasDocument } from '@noor-note/core';
import { DexieVaultRepository } from '@noor-note/storage';
import { CanvasesStore } from '../src/lib/canvases';

describe('Canvas storage', () => {
  let repository: DexieVaultRepository;
  let databaseName: string;
  beforeEach(() => { vi.stubGlobal('window', {}); databaseName = `noor-note-canvas-${crypto.randomUUID()}`; repository = new DexieVaultRepository(databaseName); });
  afterEach(async () => { repository.close(); await Dexie.delete(databaseName); vi.unstubAllGlobals(); });

  it('persists cards and viewport, enforces names, and supports trash and restore', async () => {
    const vault = await repository.initialize();
    const store = new CanvasesStore(repository, vault.id);
    const created = await store.create('Research');
    await expect(store.create('research')).rejects.toThrow('already exists');
    const document = appendCanvasNode(readCanvasDocument(created), createCanvasNode('text', 20, 30, { text: 'A durable thought' }));
    await store.save(created, { ...document, viewport: { x: 100, y: 50, zoom: 1.5 } });
    expect(readCanvasDocument((await store.list())[0]!).nodes[0]?.text).toBe('A durable thought');
    expect(readCanvasDocument((await store.list())[0]!).viewport.zoom).toBe(1.5);
    const renamed = await store.rename((await store.list())[0]!, 'Storyboard');
    expect(renamed.path).toBe('/Canvases/Storyboard.canvas');
    const removed = await store.remove(renamed);
    expect(removed.deletedAt).not.toBeNull();
    expect((await store.restore(removed)).deletedAt).toBeNull();
  });
});
