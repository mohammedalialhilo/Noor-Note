/// <reference lib="webworker" />
import type { Attachment, InternalLink } from '@noor-note/core';
import type { NoteEntry } from '@noor-note/storage';
import { buildKnowledgeGraph, parseGraphLinks, type GraphPositions, type KnowledgeGraph } from './knowledge-graph';
import { layoutKnowledgeGraph } from './graph-layout';

type Request = { id: number; kind: 'reset' } | { id: number; kind: 'update'; notes: { id: string; markdown: string }[]; removed: string[] } | { id: number; kind: 'build'; notes: NoteEntry[]; attachments: Attachment[] };
type Response = { id: number; graph?: KnowledgeGraph; positions?: GraphPositions; error?: string };
const worker = self as DedicatedWorkerGlobalScope;
const links = new Map<string, InternalLink[]>();
let topology = '';
let positions: GraphPositions = {};

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
      if (signature !== topology) { positions = layoutKnowledgeGraph(graph, positions); topology = signature; }
      worker.postMessage({ id: request.id, graph, positions } satisfies Response);
      return;
    }
    worker.postMessage({ id: request.id } satisfies Response);
  } catch (error) {
    worker.postMessage({ id: request.id, error: error instanceof Error ? error.message : 'Could not build graph' } satisfies Response);
  }
};
