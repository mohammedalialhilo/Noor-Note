import { describe, expect, it } from 'vitest';
import {
  alignCanvasNodes, appendCanvasNode, connectCanvasNodes, copyCanvasSelection, createCanvasNode,
  deleteCanvasSelection, exportJsonCanvas, groupCanvasNodes, importJsonCanvas, lassoCanvasNodes,
  layoutCanvasNodes, moveCanvasNodes, newCanvasDocument, pasteCanvasSelection, ungroupCanvasNode,
  updateCanvasEdge, updateCanvasNode,
} from '../src/canvas-engine';

describe('Canvas document operations', () => {
  const pair = () => {
    const first = createCanvasNode('text', 10, 20, { text: '# Idea' });
    const second = createCanvasNode('text', 500, 90, { text: 'Next' });
    return { first, second, document: appendCanvasNode(appendCanvasNode(newCanvasDocument(), first), second) };
  };

  it('moves, aligns, lassos, and deletes cards while keeping connectors consistent', () => {
    const { first, second, document } = pair();
    const connected = connectCanvasNodes(document, first.id, second.id);
    expect(connected.edges).toHaveLength(1);
    const moved = moveCanvasNodes(connected, new Set([first.id]), 50, 20);
    expect(moved.nodes[0]).toMatchObject({ x: 60, y: 40 });
    const aligned = alignCanvasNodes(moved, new Set([first.id, second.id]), 'top');
    expect(aligned.nodes.map((node) => node.y)).toEqual([40, 40]);
    expect(lassoCanvasNodes(aligned, { x: 50, y: 30, width: 100, height: 100 })).toEqual(new Set([first.id]));
    const removed = deleteCanvasSelection(aligned, new Set([first.id]));
    expect(removed.nodes.map((node) => node.id)).toEqual([second.id]);
    expect(removed.edges).toHaveLength(0);
  });

  it('copies groups, member cards, frames, and internal connectors with fresh IDs', () => {
    const { first, second, document } = pair();
    const connected = connectCanvasNodes(document, first.id, second.id);
    const grouped = groupCanvasNodes(connected, new Set([first.id, second.id]));
    expect(grouped.document.nodes.filter((node) => node.groupId === grouped.groupId)).toHaveLength(2);
    const copied = copyCanvasSelection(grouped.document, new Set([grouped.groupId]));
    const pasted = pasteCanvasSelection(grouped.document, copied, 80);
    expect(pasted.selected.size).toBe(3);
    expect(pasted.document.edges).toHaveLength(2);
    const newGroup = pasted.document.nodes.find((node) => pasted.selected.has(node.id) && node.kind === 'group');
    expect(newGroup).toBeDefined();
    expect(pasted.document.nodes.filter((node) => node.groupId === newGroup?.id)).toHaveLength(2);
    const ungrouped = ungroupCanvasNode(pasted.document, grouped.groupId);
    expect(ungrouped.nodes.find((node) => node.id === first.id)?.groupId).toBeNull();
  });

  it('lays out connected cards and edits connector endpoints', () => {
    const { first, second, document } = pair();
    const connected = connectCanvasNodes(document, first.id, second.id);
    const layout = layoutCanvasNodes(connected, new Set([first.id, second.id]), 'tree');
    expect(layout.nodes.find((node) => node.id === second.id)!.y).toBeGreaterThan(layout.nodes.find((node) => node.id === first.id)!.y);
    const updated = updateCanvasEdge(layout, layout.edges[0]!.id, { fromSide: 'right', toEnd: 'none', label: 'follows' });
    expect(updated.edges[0]).toMatchObject({ fromSide: 'right', toEnd: 'none', label: 'follows' });
    expect(() => updateCanvasNode(layout, first.id, { width: 0 })).toThrow();
    expect(() => createCanvasNode('url', 0, 0, { url: 'javascript:alert(1)' })).toThrow();
  });

  it('round trips JSON Canvas with stable references and namespaced frame metadata', () => {
    const noteId = crypto.randomUUID();
    const note = createCanvasNode('note', 0, 0, { noteId, filePath: '/Project.md' });
    const frame = createCanvasNode('frame', -40, -40, { label: 'Opening' });
    const source = appendCanvasNode(appendCanvasNode(newCanvasDocument(), note), frame);
    const json = exportJsonCanvas(source, [{ id: noteId, path: '/Project.md' }]);
    expect(json['noor-note']).toMatchObject({ version: 1 });
    expect((json.nodes as Array<{ file?: string }>)[0]?.file).toBe('../Project.md');
    const imported = importJsonCanvas(json, [{ id: noteId, path: '/Project.md' }]);
    expect(imported.nodes.find((node) => node.kind === 'note')?.noteId).toBe(noteId);
    expect(imported.frameOrder).toEqual([frame.id]);
  });

  it('rejects malformed JSON Canvas and keeps unresolved files portable', () => {
    const file = { id: 'file-a', type: 'file', x: 0, y: 0, width: 200, height: 100, file: 'missing.pdf' };
    expect(importJsonCanvas({ nodes: [file] }).nodes[0]).toMatchObject({ kind: 'attachment', filePath: 'missing.pdf' });
    expect(() => importJsonCanvas({ nodes: [file, file] })).toThrow('Duplicate JSON Canvas node IDs');
    expect(() => importJsonCanvas({ nodes: [file], edges: [{ id: 'a', fromNode: 'file-a', toNode: 'missing' }] })).toThrow();
    expect(() => importJsonCanvas({ nodes: [{ ...file, type: 'link', url: 'javascript:evil()' }] })).toThrow();
  });
});
