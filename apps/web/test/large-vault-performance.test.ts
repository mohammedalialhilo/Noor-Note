// Opt-in benchmark: NOOR_PERF=1 NOOR_PERF_SIZE=1000 vitest run test/large-vault-performance.test.ts
import 'fake-indexeddb/auto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { Table } from 'dexie';
import { applyBaseView, newBaseDefinition, parseInternalLinks, parseTaskRecords, scanLinks, selectBaseNotes, type Folder, type VaultNote } from '@noor-note/core';
import { DexieVaultRepository, toNoteEntry, type NoteEntry } from '@noor-note/storage';
import { makeSearchDocument, SearchEngine } from '@noor-note/search';
import { buildKnowledgeGraph } from '../src/lib/knowledge-graph';
import { layoutKnowledgeGraph } from '../src/lib/graph-layout';
import { flattenVaultTree } from '../src/components/VaultExplorer';
import { CloudSyncStore, type SyncQueueItem } from '../src/lib/cloud-sync-store';
import { SearchClient } from '../src/lib/search-client';

const size = Number(process.env.NOOR_PERF_SIZE ?? 1_000);
const enabled = process.env.NOOR_PERF === '1' && [1_000, 5_000, 10_000, 25_000].includes(size);
const timestamp = '2026-09-01T10:00:00.000Z';
const vaultId = '00000000-0000-4000-8000-000000000001';
const ownerId = '00000000-0000-4000-8000-000000000002';
const idFor = (index: number) => `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
const elapsed = <T>(action: () => T): { value: T; ms: number } => { const start = performance.now(); const value = action(); return { value, ms: performance.now() - start }; };
const timed = async <T>(action: () => Promise<T>): Promise<{ value: T; ms: number }> => { const start = performance.now(); const value = await action(); return { value, ms: performance.now() - start }; };
const round = (value: number) => Math.round(value * 10) / 10;

function fixture(count: number): { notes: VaultNote[]; entries: NoteEntry[]; folders: Folder[] } {
  const folders: Folder[] = Array.from({ length: 100 }, (_, index) => ({
    id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, vaultId, parentId: null,
    name: `Project ${index + 1}`, path: `/Project ${index + 1}`, createdAt: timestamp, updatedAt: timestamp, deletedAt: null, trashGroupId: null,
  }));
  const notes: VaultNote[] = Array.from({ length: count }, (_, index) => {
    const folder = folders[index % folders.length]!;
    const title = `Note ${String(index).padStart(6, '0')}`;
    const next = `Note ${String((index + 1) % count).padStart(6, '0')}`;
    const related = `Note ${String((index + 17) % count).padStart(6, '0')}`;
    const markdown = `---\nstatus: ${index % 4 === 0 ? 'active' : 'draft'}\npriority: ${index % 5}\n---\n# ${title}\nResearch notes for project ${index % 100}. The experiment records decisions, source material, and a short summary.\n\n## Findings\nA useful connection to [[${next}]] and [[${related}]]. #research/project-${index % 20}\n\n- [ ] Review evidence 📅 2026-10-15\n- [x] Capture source\n\nA second paragraph gives search a realistic passage with repeated vocabulary and note-specific term ref-${index}.`;
    return { id: idFor(index), vaultId, folderId: folder.id, path: `${folder.path}/${title}.md`, title, markdown,
      createdAt: timestamp, updatedAt: timestamp, deletedAt: null, trashGroupId: null,
      aliases: [], properties: { status: index % 4 === 0 ? 'active' : 'draft', priority: index % 5 }, revision: 1,
      checksum: 'a'.repeat(64), collaborative: false };
  });
  return { notes, entries: notes.map(toNoteEntry), folders };
}

interface SeedDatabase { folders: Table<Folder, string>; noteEntries: Table<NoteEntry, string>; noteBodies: Table<{ id: string; markdown: string }, string>; delete(): Promise<void> }
interface QueueDatabase { queue: Table<SyncQueueItem, string>; delete(): Promise<void> }

describe.skipIf(!enabled)('large vault performance', () => {
  const names: string[] = [];
  afterAll(async () => {
    const Dexie = (await import('dexie')).default;
    for (const name of names) await Dexie.delete(name);
  });

  it('measures realistic local paths without network latency', async () => {
    vi.stubGlobal('window', {});
    const generated = elapsed(() => fixture(size));
    const { notes, entries, folders } = generated.value;
    const results: Record<string, number> = { fixtureMs: round(generated.ms) };

    const dbName = `noor-perf-vault-${size}-${crypto.randomUUID()}`;
    names.push(dbName);
    const repository = new DexieVaultRepository(dbName);
    const vault = await repository.createVault('Performance vault');
    // Production reads and writes are timed; test data is loaded in batches outside the timer.
    const db = Reflect.get(repository, 'database') as SeedDatabase;
    await db.folders.bulkPut(folders.map((folder) => ({ ...folder, vaultId: vault.id })));
    for (let offset = 0; offset < size; offset += 500) {
      await db.noteEntries.bulkPut(entries.slice(offset, offset + 500).map((entry) => ({ ...entry, vaultId: vault.id })));
      await db.noteBodies.bulkPut(notes.slice(offset, offset + 500).map((note) => ({ id: note.id, markdown: note.markdown })));
    }
    const startup = await timed(() => repository.listTree(vault.id));
    results.startupTreeMs = round(startup.ms);
    expect(startup.value.notes).toHaveLength(size);
    const opened = await timed(() => repository.getNote(notes[Math.floor(size / 2)]!.id));
    results.openNoteMs = round(opened.ms);

    const expanded = new Set(folders.map((folder) => folder.id));
    const tree = elapsed(() => flattenVaultTree(folders, entries, [], expanded));
    results.fileTreeFlattenMs = round(tree.ms);
    expect(tree.value).toHaveLength(size + folders.length);

    const documents = elapsed(() => notes.map(makeSearchDocument));
    const search = new SearchEngine();
    const indexing = elapsed(() => { for (const document of documents.value) search.upsert(document); });
    results.searchDocumentsMs = round(documents.ms);
    results.searchIndexMs = round(indexing.ms);
    results.searchSelectiveMs = round(elapsed(() => search.search(`ref-${Math.floor(size / 2)}`, 20)).ms);
    results.searchFilteredMs = round(elapsed(() => search.search('tag:research/project-3', 20)).ms);
    const changed = { ...documents.value[0]!, revision: 2, markdown: `${documents.value[0]!.markdown}\nOne more finding.` };
    results.searchIncrementalUpdateMs = round(elapsed(() => search.upsert(changed)).ms);
    const client = new SearchClient();
    const coldSearch = await timed(() => client.search(repository, vault.id, `ref-${Math.floor(size / 2)}`, 20, startup.value));
    const warmSearch = await timed(() => client.search(repository, vault.id, `ref-${Math.floor(size / 2)}`, 20, startup.value));
    results.searchColdEndToEndMs = round(coldSearch.ms);
    results.searchWarmEndToEndMs = round(warmSearch.ms);
    expect(coldSearch.value.length).toBeGreaterThan(0);
    client.close();

    const parsedLinks = elapsed(() => new Map(notes.map((note) => [note.id, parseInternalLinks(note.markdown)])));
    results.linkParseMs = round(parsedLinks.ms);
    if (size <= 5_000 || process.env.NOOR_PERF_GRAPH_ALL === '1') {
      results.backlinksScanMs = round(elapsed(() => scanLinks(notes)).ms);
      const graph = elapsed(() => buildKnowledgeGraph(entries, [], parsedLinks.value));
      results.graphBuildMs = round(graph.ms);
      const layout = elapsed(() => layoutKnowledgeGraph(graph.value));
      results.graphLayoutMs = round(layout.ms);
      expect(graph.value.nodes.length).toBeGreaterThan(size);
      expect(Object.keys(layout.value)).toHaveLength(graph.value.nodes.length);
    }

    const definition = newBaseDefinition();
    const selected = elapsed(() => selectBaseNotes(entries, { ...definition.query, tag: 'research/project-3' }, folders));
    const baseView = elapsed(() => applyBaseView(selected.value, { ...definition.views[0]!, sort: { field: 'title', direction: 'asc' } }, folders));
    results.basesFilterMs = round(selected.ms);
    results.basesSortMs = round(baseView.ms);
    results.taskParseMs = round(elapsed(() => notes.reduce((total, note) => total + parseTaskRecords(note.markdown).length, 0)).ms);

    const target = notes[Math.floor(size / 2)]!;
    const save = await timed(() => repository.saveNote(target.id, { markdown: `${target.markdown}\nAutosave edit.` }));
    results.autosaveMs = round(save.ms);

    const syncName = `noor-perf-sync-${size}-${crypto.randomUUID()}`;
    names.push(syncName);
    const sync = new CloudSyncStore(syncName);
    const queueDb = Reflect.get(sync, 'db') as QueueDatabase;
    const queueCount = Math.min(size, 1_000);
    const queue: SyncQueueItem[] = entries.slice(0, queueCount).map((entry, index) => ({
      id: crypto.randomUUID(), ownerId, vaultId, kind: 'note', itemId: entry.id,
      revisionId: crypto.randomUUID(), fingerprint: `revision:${index}`,
      record: { kind: 'note', item: notes[index]! }, attempts: 0, nextAttemptAt: 0, error: null, createdAt: index,
    }));
    await queueDb.queue.bulkPut(queue);
    const due = await timed(() => sync.due(ownerId, vaultId));
    results.syncDue1000Ms = round(due.ms);
    expect(due.value).toHaveLength(queueCount);
    const enqueue = await timed(() => sync.enqueue(ownerId, vaultId, { kind: 'note', item: { ...notes[0]!, revision: 2 } }));
    results.syncEnqueueMs = round(enqueue.ms);
    const inspectorCount = Math.min(size, 5_000);
    const inspectorLoad = await timed(async () => {
      const loaded: VaultNote[] = [];
      for (let offset = 0; offset < inspectorCount; offset += 500) loaded.push(...await repository.getNotes(entries.slice(offset, offset + 500).map((entry) => entry.id)));
      return loaded;
    });
    results.inspectorBodiesMs = round(inspectorLoad.ms);
    results.inspectorBodiesCount = inspectorCount;
    expect(inspectorLoad.value).toHaveLength(inspectorCount);
    console.log(`NOOR_PERF ${JSON.stringify({ count: size, ...results })}`);
    repository.close();
    await sync.close();
    vi.unstubAllGlobals();
  }, 600_000);
});
