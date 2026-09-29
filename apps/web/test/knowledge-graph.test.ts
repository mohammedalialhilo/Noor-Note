import { describe, expect, it } from 'vitest';
import { makeVaultNote, type Attachment, type InternalLink } from '@noor-note/core';
import { toNoteEntry } from '@noor-note/storage';
import { buildKnowledgeGraph, defaultGraphFilters, localGraph, parseGraphLinks, visibleGraph } from '../src/lib/knowledge-graph';

describe('knowledge graph', () => {
  it('resolves note links by stable ID, distinguishes embeds, and includes tags and attachment references', async () => {
    const vaultId = crypto.randomUUID();
    const target = await makeVaultNote({ vaultId, title: 'Renamed', markdown: '' });
    const source = await makeVaultNote({ vaultId, title: 'Source', markdown: `[[Old name]]<!-- noor-note-id:${target.id} -->\n![[Renamed]]\n![[image.png]]\n#research` });
    const attachment: Attachment = { id: crypto.randomUUID(), vaultId, folderId: null, path: '/image.png', name: 'image.png', mime: 'image/png', size: 10, storage: 'indexeddb', createdAt: source.createdAt, updatedAt: source.updatedAt, deletedAt: null, trashGroupId: null };
    const graph = buildKnowledgeGraph([toNoteEntry(source), toNoteEntry(target)], [attachment], new Map([[source.id, parseGraphLinks(source.markdown)]]));
    expect(graph.edges.find((edge) => edge.source === source.id && edge.target === target.id && edge.kind === 'link')).toBeDefined();
    expect(graph.edges.find((edge) => edge.source === source.id && edge.target === target.id && edge.kind === 'embed')).toBeDefined();
    expect(graph.edges.find((edge) => edge.source === source.id && edge.target === attachment.id && edge.kind === 'embed')).toBeDefined();
    expect(graph.edges.find((edge) => edge.source === source.id && edge.target === 'tag:research' && edge.kind === 'tag')).toBeDefined();
    const plain = visibleGraph(graph, defaultGraphFilters);
    expect(plain.nodes.every((node) => node.kind === 'note')).toBe(true);
    expect(plain.edges).toHaveLength(2);
    expect(visibleGraph(graph, { ...defaultGraphFilters, showTags: true, showAttachments: true }).nodes).toHaveLength(4);
  });

  it('filters orphans and traverses inbound and outbound paths by depth', () => {
    const graph = {
      nodes: ['a', 'b', 'c', 'd', 'orphan'].map((id) => ({ id, kind: 'note' as const, label: id, path: `/${id}.md`, folderId: null, degree: id === 'orphan' ? 0 : 1 })),
      edges: [
        { id: 'ab', source: 'a', target: 'b', kind: 'link' as const, count: 1 },
        { id: 'bc', source: 'b', target: 'c', kind: 'link' as const, count: 1 },
        { id: 'cd', source: 'c', target: 'd', kind: 'link' as const, count: 1 },
      ],
    };
    expect(localGraph(graph, 'b', 1, 'outbound').nodes.map((node) => node.id)).toEqual(['b', 'c']);
    expect(localGraph(graph, 'b', 1, 'inbound').nodes.map((node) => node.id)).toEqual(['a', 'b']);
    expect(localGraph(graph, 'a', 3).nodes.map((node) => node.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(visibleGraph(graph, { ...defaultGraphFilters, hideOrphans: true }).nodes.some((node) => node.id === 'orphan')).toBe(false);
    expect(visibleGraph(graph, { ...defaultGraphFilters, showLinks: false, hideOrphans: true }).nodes).toHaveLength(0);
  });

  it('does not include links to deleted notes', async () => {
    const vaultId = crypto.randomUUID();
    const target = await makeVaultNote({ vaultId, title: 'Gone', markdown: '' });
    const source = await makeVaultNote({ vaultId, title: 'Source', markdown: '[[Gone]]' });
    const links = new Map<string, InternalLink[]>([[source.id, parseGraphLinks(source.markdown)]]);
    expect(buildKnowledgeGraph([toNoteEntry(source), toNoteEntry({ ...target, deletedAt: target.updatedAt })], [], links).edges).toHaveLength(0);
  });
});
