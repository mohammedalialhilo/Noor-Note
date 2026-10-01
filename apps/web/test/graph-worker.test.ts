import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NoteEntry } from '@noor-note/storage';
import type { GraphPositions, KnowledgeGraph } from '../src/lib/knowledge-graph';

afterEach(() => vi.unstubAllGlobals());

describe('graph worker', () => {
  it('lays out a large graph off the UI path and reuses coordinates when topology is unchanged', async () => {
    const responses: { id: number; graph?: KnowledgeGraph; positions?: GraphPositions; error?: string }[] = [];
    const worker = { onmessage: null as ((event: MessageEvent<unknown>) => void) | null, postMessage: (response: typeof responses[number]) => { responses.push(response); } };
    vi.stubGlobal('self', worker);
    await import('../src/lib/graph-worker');
    const dispatch = (data: unknown) => worker.onmessage?.({ data } as MessageEvent<unknown>);
    const vaultId = crypto.randomUUID();
    const now = new Date().toISOString();
    const notes: NoteEntry[] = Array.from({ length: 650 }, (_, index) => ({ id: crypto.randomUUID(), vaultId, folderId: null, path: `/Note ${index}.md`, title: `Note ${index}`, excerpt: '', tags: [], links: [], tasks: [], taskCount: 0, createdAt: now, updatedAt: now, deletedAt: null, trashGroupId: null, aliases: [], properties: {}, collaborative: false, revision: 1, checksum: '0'.repeat(64) }));
    dispatch({ id: 1, kind: 'update', notes: notes.slice(0, -1).map((note, index) => ({ id: note.id, markdown: `[[Next]]<!-- noor-note-id:${notes[index + 1]!.id} -->` })), removed: [] });
    dispatch({ id: 2, kind: 'build', notes, attachments: [] });
    const first = responses.at(-1);
    expect(first?.error).toBeUndefined();
    expect(first?.graph?.nodes).toHaveLength(650);
    expect(first?.graph?.edges).toHaveLength(649);
    expect(Object.values(first?.positions ?? {}).every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
    const renamed = notes.map((note, index) => index === 0 ? { ...note, title: 'Renamed' } : note);
    dispatch({ id: 3, kind: 'build', notes: renamed, attachments: [] });
    expect(responses.at(-1)?.positions).toEqual(first?.positions);
  });
});
