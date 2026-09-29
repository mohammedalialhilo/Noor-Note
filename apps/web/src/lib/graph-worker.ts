/// <reference lib="webworker" />
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import type { Attachment, InternalLink } from '@noor-note/core';
import type { NoteEntry } from '@noor-note/storage';
import { buildKnowledgeGraph, parseGraphLinks, type GraphPositions, type KnowledgeGraph } from './knowledge-graph';

type Request = { id: number; kind: 'reset' } | { id: number; kind: 'update'; notes: { id: string; markdown: string }[]; removed: string[] } | { id: number; kind: 'build'; notes: NoteEntry[]; attachments: Attachment[] };
type Response = { id: number; graph?: KnowledgeGraph; positions?: GraphPositions; error?: string };
const worker = self as DedicatedWorkerGlobalScope;
const links = new Map<string, InternalLink[]>();
let topology = '';
let positions: GraphPositions = {};

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  return result >>> 0;
}

function layout(graph: KnowledgeGraph): GraphPositions {
  const next = new Graph({ type: 'directed', multi: true });
  for (const node of graph.nodes) {
    const angle = hash(node.id) / 4294967296 * Math.PI * 2;
    const radius = 5 + (hash(`${node.id}:radius`) % 1000) / 100;
    next.addNode(node.id, positions[node.id] ?? { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  }
  for (const edge of graph.edges) next.addDirectedEdgeWithKey(edge.id, edge.source, edge.target, { weight: Math.min(edge.count, 4) });
  if (next.size) forceAtlas2.assign(next, { iterations: next.order > 2000 ? 24 : next.order > 400 ? 48 : 90, settings: { barnesHutOptimize: next.order > 100, gravity: 0.7, scalingRatio: 8, slowDown: 3 } });
  const result: GraphPositions = {};
  next.forEachNode((id, attributes) => { result[id] = { x: Number(attributes.x), y: Number(attributes.y) }; });
  return result;
}

worker.onmessage = (event: MessageEvent<Request>) => {
  const request = event.data;
  try {
    if (request.kind === 'reset') { links.clear(); positions = {}; topology = ''; }
    if (request.kind === 'update') {
      for (const id of request.removed) links.delete(id);
      for (const note of request.notes) links.set(note.id, parseGraphLinks(note.markdown));
    }
    if (request.kind === 'build') {
      const graph = buildKnowledgeGraph(request.notes, request.attachments, links);
      const signature = `${graph.nodes.map((node) => node.id).join('|')}::${graph.edges.map((edge) => edge.id).join('|')}`;
      if (signature !== topology) { positions = layout(graph); topology = signature; }
      worker.postMessage({ id: request.id, graph, positions } satisfies Response);
      return;
    }
    worker.postMessage({ id: request.id } satisfies Response);
  } catch (error) {
    worker.postMessage({ id: request.id, error: error instanceof Error ? error.message : 'Could not build graph' } satisfies Response);
  }
};
