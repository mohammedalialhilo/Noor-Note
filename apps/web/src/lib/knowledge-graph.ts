import { createLinkResolver, parseInternalLinks, type Attachment, type InternalLink } from '@noor-note/core';
import type { NoteEntry } from '@noor-note/storage';

export type GraphNodeKind = 'note' | 'tag' | 'attachment';
export type GraphEdgeKind = 'link' | 'embed' | 'tag';
export interface KnowledgeNode { id: string; kind: GraphNodeKind; label: string; path: string; folderId: string | null; degree: number }
export interface KnowledgeEdge { id: string; source: string; target: string; kind: GraphEdgeKind; count: number }
export interface KnowledgeGraph { nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }
export interface GraphPosition { x: number; y: number }
export type GraphPositions = Record<string, GraphPosition>;
export interface GraphFilters { showTags: boolean; showAttachments: boolean; showLinks: boolean; showEmbeds: boolean; showTagEdges: boolean; hideOrphans: boolean }

export const defaultGraphFilters: GraphFilters = { showTags: false, showAttachments: false, showLinks: true, showEmbeds: true, showTagEdges: true, hideOrphans: false };

function attachmentTarget(target: string, sourcePath: string, attachments: Attachment[]): Attachment | undefined {
  const decoded = (() => { try { return decodeURIComponent(target); } catch { return target; } })().replaceAll('\\', '/');
  const sourceFolder = sourcePath.slice(0, sourcePath.lastIndexOf('/'));
  const absolute = decoded.startsWith('/') ? decoded : `${sourceFolder}/${decoded}`;
  const normalized = absolute.split('/').reduce<string[]>((parts, part) => { if (part === '..') parts.pop(); else if (part && part !== '.') parts.push(part); return parts; }, []).join('/').toLocaleLowerCase();
  return attachments.find((item) => item.path.slice(1).toLocaleLowerCase() === normalized)
    ?? attachments.find((item) => item.name.toLocaleLowerCase() === decoded.toLocaleLowerCase() && item.folderId === null);
}

/** Builds one vault's graph from metadata plus parsed note links. Binary attachment content is never loaded. */
export function buildKnowledgeGraph(notes: NoteEntry[], attachments: Attachment[], linksByNote: ReadonlyMap<string, InternalLink[]>): KnowledgeGraph {
  const live = notes.filter((note) => !note.deletedAt);
  const files = attachments.filter((item) => !item.deletedAt);
  const resolver = createLinkResolver(live);
  const nodes: KnowledgeNode[] = live.map((note) => ({ id: note.id, kind: 'note', label: note.title || 'Untitled note', path: note.path, folderId: note.folderId, degree: 0 }));
  const nodeIds = new Set(nodes.map((node) => node.id));
  for (const attachment of files) nodes.push({ id: attachment.id, kind: 'attachment', label: attachment.name, path: attachment.path, folderId: attachment.folderId, degree: 0 });
  const edgeMap = new Map<string, KnowledgeEdge>();
  const add = (source: string, target: string, kind: GraphEdgeKind) => {
    const id = `${kind}:${source}:${target}`;
    const existing = edgeMap.get(id);
    if (existing) existing.count += 1;
    else edgeMap.set(id, { id, source, target, kind, count: 1 });
  };
  for (const note of live) {
    for (const tag of note.tags) {
      const tagId = `tag:${tag.toLocaleLowerCase()}`;
      if (!nodeIds.has(tagId)) { nodes.push({ id: tagId, kind: 'tag', label: `#${tag}`, path: '', folderId: null, degree: 0 }); nodeIds.add(tagId); }
      add(note.id, tagId, 'tag');
    }
    for (const link of linksByNote.get(note.id) ?? []) {
      const target = resolver.resolve(link, note);
      if (target) { add(note.id, target.id, link.kind === 'embed' ? 'embed' : 'link'); continue; }
      if (link.kind === 'embed') {
        const attachment = attachmentTarget(link.target, note.path, files);
        if (attachment) add(note.id, attachment.id, 'embed');
      }
    }
  }
  const edges = [...edgeMap.values()];
  const degree = new Map<string, number>();
  for (const edge of edges) { degree.set(edge.source, (degree.get(edge.source) ?? 0) + edge.count); degree.set(edge.target, (degree.get(edge.target) ?? 0) + edge.count); }
  for (const node of nodes) node.degree = degree.get(node.id) ?? 0;
  return { nodes, edges };
}

export function visibleGraph(graph: KnowledgeGraph, filters: GraphFilters): KnowledgeGraph {
  const nodes = graph.nodes.filter((node) => node.kind === 'note' || node.kind === 'tag' && filters.showTags || node.kind === 'attachment' && filters.showAttachments);
  const ids = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target) && (edge.kind === 'link' && filters.showLinks || edge.kind === 'embed' && filters.showEmbeds || edge.kind === 'tag' && filters.showTagEdges));
  if (!filters.hideOrphans) return { nodes, edges };
  const connected = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
  return { nodes: nodes.filter((node) => connected.has(node.id)), edges };
}

export function localGraph(graph: KnowledgeGraph, rootId: string, depth: number, direction: 'both' | 'inbound' | 'outbound' = 'both'): KnowledgeGraph {
  if (!graph.nodes.some((node) => node.id === rootId)) return { nodes: [], edges: [] };
  const included = new Set([rootId]);
  let frontier = new Set([rootId]);
  for (let step = 0; step < Math.max(1, Math.floor(depth)); step += 1) {
    const next = new Set<string>();
    for (const edge of graph.edges) {
      if (direction !== 'inbound' && frontier.has(edge.source)) next.add(edge.target);
      if (direction !== 'outbound' && frontier.has(edge.target)) next.add(edge.source);
    }
    for (const id of next) included.add(id);
    frontier = next;
    if (!frontier.size) break;
  }
  return { nodes: graph.nodes.filter((node) => included.has(node.id)), edges: graph.edges.filter((edge) => included.has(edge.source) && included.has(edge.target)) };
}

export function parseGraphLinks(markdown: string): InternalLink[] { return parseInternalLinks(markdown); }
