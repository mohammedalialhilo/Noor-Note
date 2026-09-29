import { z } from 'zod';
import { canvasSchema, safeFileStem, type Attachment, type Canvas, type VaultNote } from './vault-domain';

const id = z.uuid();
const point = z.number().finite().min(-10_000_000).max(10_000_000);
const extent = z.number().finite().min(40).max(20_000);
const side = z.enum(['auto', 'top', 'right', 'bottom', 'left']);
const endpoint = z.enum(['none', 'arrow']);
const kind = z.enum(['text', 'note', 'image', 'pdf', 'audio', 'video', 'url', 'attachment', 'group', 'frame']);
const color = z.string().regex(/^(?:[1-6]|#[0-9a-fA-F]{6})$/u).nullable().default(null);
const httpUrl = z.url().refine((value) => /^https?:\/\//iu.test(value), 'Only HTTP(S) links are supported');

export const canvasNodeSchema = z.object({
  id, kind, x: point, y: point, width: extent, height: extent, color,
  label: z.string().max(500).default(''), text: z.string().max(100_000).default(''),
  noteId: id.nullable().default(null), attachmentId: id.nullable().default(null),
  filePath: z.string().max(1000).nullable().default(null), url: httpUrl.nullable().default(null),
  groupId: id.nullable().default(null),
}).strict().superRefine((node, context) => {
  if (node.kind === 'url' && !node.url) context.addIssue({ code: 'custom', message: 'Website cards require an HTTP(S) URL' });
});
export const canvasEdgeSchema = z.object({ id, fromNode: id, toNode: id, fromSide: side.default('auto'), toSide: side.default('auto'), fromEnd: endpoint.default('none'), toEnd: endpoint.default('arrow'), label: z.string().max(500).default(''), color }).strict();
export const canvasDocumentSchema = z.object({
  version: z.literal(1), nodes: z.array(canvasNodeSchema).max(5000), edges: z.array(canvasEdgeSchema).max(10000),
  viewport: z.object({ x: point, y: point, zoom: z.number().finite().min(0.1).max(4) }).strict().default({ x: 0, y: 0, zoom: 1 }),
  grid: z.object({ visible: z.boolean(), snap: z.boolean(), size: z.number().int().min(8).max(200) }).strict().default({ visible: true, snap: false, size: 24 }),
  frameOrder: z.array(id).max(500).default([]),
}).strict().superRefine((value, context) => {
  const nodes = new Map(value.nodes.map((node) => [node.id, node]));
  if (nodes.size !== value.nodes.length) context.addIssue({ code: 'custom', message: 'Duplicate canvas node IDs' });
  if (new Set(value.edges.map((edge) => edge.id)).size !== value.edges.length) context.addIssue({ code: 'custom', message: 'Duplicate canvas edge IDs' });
  for (const node of value.nodes) if (node.groupId && (node.groupId === node.id || nodes.get(node.groupId)?.kind !== 'group')) context.addIssue({ code: 'custom', message: 'Invalid canvas group' });
  for (const edge of value.edges) if (!nodes.has(edge.fromNode) || !nodes.has(edge.toNode)) context.addIssue({ code: 'custom', message: 'Canvas edge references a missing node' });
  if (new Set(value.frameOrder).size !== value.frameOrder.length || value.frameOrder.some((frameId) => nodes.get(frameId)?.kind !== 'frame')) context.addIssue({ code: 'custom', message: 'Invalid frame order' });
});
export type CanvasNode = z.infer<typeof canvasNodeSchema>;
export type CanvasEdge = z.infer<typeof canvasEdgeSchema>;
export type CanvasDocument = z.infer<typeof canvasDocumentSchema>;
export type CanvasNodeKind = z.infer<typeof kind>;
export type CanvasSide = z.infer<typeof side>;
export type CanvasEndpoint = z.infer<typeof endpoint>;
export type CanvasLayout = 'horizontal' | 'vertical' | 'tree' | 'mind-map' | 'flowchart';

export function newCanvasDocument(): CanvasDocument { return canvasDocumentSchema.parse({ version: 1, nodes: [], edges: [] }); }
export function readCanvasDocument(canvas: Canvas): CanvasDocument { return canvasDocumentSchema.parse(canvas.document); }
export function newCanvas(vaultId: string, title: string, existing: readonly Canvas[], document = newCanvasDocument()): Canvas {
  const name = title.trim();
  if (!name || name.length > 200) throw new Error('Enter a Canvas name up to 200 characters');
  const path = `/Canvases/${safeFileStem(name)}.canvas`;
  if (existing.some((item) => !item.deletedAt && item.path.toLocaleLowerCase() === path.toLocaleLowerCase())) throw new Error('A Canvas with this name already exists');
  const now = new Date().toISOString();
  return canvasSchema.parse({ id: crypto.randomUUID(), vaultId, path, title: name, document: canvasDocumentSchema.parse(document), createdAt: now, updatedAt: now, deletedAt: null });
}
export function withCanvasDocument(canvas: Canvas, document: CanvasDocument): Canvas { return canvasSchema.parse({ ...canvas, document: canvasDocumentSchema.parse(document), updatedAt: new Date().toISOString() }); }
export function createCanvasNode(nodeKind: CanvasNodeKind, x: number, y: number, patch: Partial<CanvasNode> = {}): CanvasNode {
  const dimensions = nodeKind === 'frame' ? { width: 800, height: 500 } : nodeKind === 'group' ? { width: 380, height: 260 } : nodeKind === 'text' ? { width: 280, height: 190 } : { width: 300, height: 220 };
  return canvasNodeSchema.parse({ id: crypto.randomUUID(), kind: nodeKind, x, y, ...dimensions, ...patch });
}
export function appendCanvasNode(document: CanvasDocument, node: CanvasNode): CanvasDocument { return canvasDocumentSchema.parse({ ...document, nodes: [...document.nodes, node], frameOrder: node.kind === 'frame' ? [...document.frameOrder, node.id] : document.frameOrder }); }
export function updateCanvasNode(document: CanvasDocument, id: string, patch: Partial<CanvasNode>): CanvasDocument { return canvasDocumentSchema.parse({ ...document, nodes: document.nodes.map((node) => node.id === id ? canvasNodeSchema.parse({ ...node, ...patch, id: node.id, kind: node.kind }) : node) }); }
export function deleteCanvasSelection(document: CanvasDocument, selected: ReadonlySet<string>): CanvasDocument {
  const removed = new Set(selected);
  for (const node of document.nodes) if (node.groupId && selected.has(node.groupId)) removed.add(node.id);
  return canvasDocumentSchema.parse({ ...document, nodes: document.nodes.filter((node) => !removed.has(node.id)).map((node) => node.groupId && removed.has(node.groupId) ? { ...node, groupId: null } : node), edges: document.edges.filter((edge) => !removed.has(edge.id) && !removed.has(edge.fromNode) && !removed.has(edge.toNode)), frameOrder: document.frameOrder.filter((id) => !removed.has(id)) });
}
export function moveCanvasNodes(document: CanvasDocument, selected: ReadonlySet<string>, dx: number, dy: number): CanvasDocument {
  const moving = new Set(selected);
  for (const node of document.nodes) if (node.groupId && selected.has(node.groupId)) moving.add(node.id);
  const snap = (value: number) => document.grid.snap ? Math.round(value / document.grid.size) * document.grid.size : value;
  const clamp = (value: number) => Math.max(-10_000_000, Math.min(10_000_000, snap(value)));
  return canvasDocumentSchema.parse({ ...document, nodes: document.nodes.map((node) => moving.has(node.id) ? { ...node, x: clamp(node.x + dx), y: clamp(node.y + dy) } : node) });
}
export function duplicateCanvasSelection(document: CanvasDocument, selected: ReadonlySet<string>, offset = 40): { document: CanvasDocument; selected: Set<string> } {
  const originals = document.nodes.filter((node) => selected.has(node.id));
  const ids = new Map(originals.map((node) => [node.id, crypto.randomUUID()]));
  const copies = originals.map((node) => canvasNodeSchema.parse({ ...node, id: ids.get(node.id), x: node.x + offset, y: node.y + offset, groupId: node.groupId && ids.has(node.groupId) ? ids.get(node.groupId) : null }));
  const edges = document.edges.filter((edge) => ids.has(edge.fromNode) && ids.has(edge.toNode)).map((edge) => canvasEdgeSchema.parse({ ...edge, id: crypto.randomUUID(), fromNode: ids.get(edge.fromNode), toNode: ids.get(edge.toNode) }));
  return { document: canvasDocumentSchema.parse({ ...document, nodes: [...document.nodes, ...copies], edges: [...document.edges, ...edges], frameOrder: [...document.frameOrder, ...copies.filter((node) => node.kind === 'frame').map((node) => node.id)] }), selected: new Set(copies.map((node) => node.id)) };
}
export function copyCanvasSelection(document: CanvasDocument, selected: ReadonlySet<string>): CanvasDocument {
  const nodes = document.nodes.filter((node) => selected.has(node.id) || node.groupId && selected.has(node.groupId));
  const ids = new Set(nodes.map((node) => node.id));
  return canvasDocumentSchema.parse({ ...document, nodes, edges: document.edges.filter((edge) => ids.has(edge.fromNode) && ids.has(edge.toNode)), frameOrder: document.frameOrder.filter((id) => ids.has(id)) });
}
export function pasteCanvasSelection(document: CanvasDocument, copied: CanvasDocument, offset = 40): { document: CanvasDocument; selected: Set<string> } {
  const ids = new Map(copied.nodes.map((node) => [node.id, crypto.randomUUID()]));
  const nodes = copied.nodes.map((node) => canvasNodeSchema.parse({ ...node, id: ids.get(node.id), x: node.x + offset, y: node.y + offset, groupId: node.groupId ? ids.get(node.groupId) ?? null : null }));
  const edges = copied.edges.map((edge) => canvasEdgeSchema.parse({ ...edge, id: crypto.randomUUID(), fromNode: ids.get(edge.fromNode), toNode: ids.get(edge.toNode) }));
  return { document: canvasDocumentSchema.parse({ ...document, nodes: [...document.nodes, ...nodes], edges: [...document.edges, ...edges], frameOrder: [...document.frameOrder, ...copied.frameOrder.map((id) => ids.get(id)!)] }), selected: new Set(nodes.map((node) => node.id)) };
}
export function alignCanvasNodes(document: CanvasDocument, selected: ReadonlySet<string>, alignment: 'left' | 'right' | 'top' | 'bottom' | 'center-x' | 'center-y'): CanvasDocument {
  const nodes = document.nodes.filter((node) => selected.has(node.id));
  if (nodes.length < 2) return document;
  const left = Math.min(...nodes.map((node) => node.x)), right = Math.max(...nodes.map((node) => node.x + node.width));
  const top = Math.min(...nodes.map((node) => node.y)), bottom = Math.max(...nodes.map((node) => node.y + node.height));
  return canvasDocumentSchema.parse({ ...document, nodes: document.nodes.map((node) => !selected.has(node.id) ? node : { ...node, x: alignment === 'left' ? left : alignment === 'right' ? right - node.width : alignment === 'center-x' ? (left + right - node.width) / 2 : node.x, y: alignment === 'top' ? top : alignment === 'bottom' ? bottom - node.height : alignment === 'center-y' ? (top + bottom - node.height) / 2 : node.y }) });
}
export function groupCanvasNodes(document: CanvasDocument, selected: ReadonlySet<string>): { document: CanvasDocument; groupId: string } {
  const members = document.nodes.filter((node) => selected.has(node.id) && node.kind !== 'group' && node.kind !== 'frame');
  if (!members.length) throw new Error('Select cards to group');
  const x = Math.min(...members.map((node) => node.x)) - 28, y = Math.min(...members.map((node) => node.y)) - 48;
  const right = Math.max(...members.map((node) => node.x + node.width)) + 28, bottom = Math.max(...members.map((node) => node.y + node.height)) + 28;
  const group = createCanvasNode('group', x, y, { width: right - x, height: bottom - y, label: 'Group' });
  return { document: canvasDocumentSchema.parse({ ...document, nodes: [group, ...document.nodes.map((node) => selected.has(node.id) && node.kind !== 'group' && node.kind !== 'frame' ? { ...node, groupId: group.id } : node)] }), groupId: group.id };
}
export function ungroupCanvasNode(document: CanvasDocument, groupId: string): CanvasDocument { return canvasDocumentSchema.parse({ ...document, nodes: document.nodes.filter((node) => node.id !== groupId).map((node) => node.groupId === groupId ? { ...node, groupId: null } : node), edges: document.edges.filter((edge) => edge.fromNode !== groupId && edge.toNode !== groupId) }); }
export function connectCanvasNodes(document: CanvasDocument, fromNode: string, toNode: string, patch: Partial<CanvasEdge> = {}): CanvasDocument {
  if (fromNode === toNode || !document.nodes.some((node) => node.id === fromNode) || !document.nodes.some((node) => node.id === toNode)) throw new Error('Choose two different cards to connect');
  return canvasDocumentSchema.parse({ ...document, edges: [...document.edges, canvasEdgeSchema.parse({ ...patch, id: crypto.randomUUID(), fromNode, toNode })] });
}
export function updateCanvasEdge(document: CanvasDocument, id: string, patch: Partial<CanvasEdge>): CanvasDocument { return canvasDocumentSchema.parse({ ...document, edges: document.edges.map((edge) => edge.id === id ? canvasEdgeSchema.parse({ ...edge, ...patch, id: edge.id }) : edge) }); }
export function lassoCanvasNodes(document: CanvasDocument, rectangle: { x: number; y: number; width: number; height: number }): Set<string> {
  const left = Math.min(rectangle.x, rectangle.x + rectangle.width), right = Math.max(rectangle.x, rectangle.x + rectangle.width);
  const top = Math.min(rectangle.y, rectangle.y + rectangle.height), bottom = Math.max(rectangle.y, rectangle.y + rectangle.height);
  return new Set(document.nodes.filter((node) => node.x < right && node.x + node.width > left && node.y < bottom && node.y + node.height > top).map((node) => node.id));
}

export function layoutCanvasNodes(document: CanvasDocument, selected: ReadonlySet<string>, layout: CanvasLayout): CanvasDocument {
  const nodes = document.nodes.filter((node) => selected.has(node.id) && node.kind !== 'group' && node.kind !== 'frame');
  if (nodes.length < 2) return document;
  const originX = Math.min(...nodes.map((node) => node.x)), originY = Math.min(...nodes.map((node) => node.y));
  const positions = new Map<string, { x: number; y: number }>();
  if (layout === 'horizontal' || layout === 'vertical') {
    let cursor = 0;
    for (const node of nodes) { positions.set(node.id, { x: originX + (layout === 'horizontal' ? cursor : 0), y: originY + (layout === 'vertical' ? cursor : 0) }); cursor += (layout === 'horizontal' ? node.width : node.height) + 80; }
  } else {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const incoming = new Map(nodes.map((node) => [node.id, 0]));
    for (const edge of document.edges) if (byId.has(edge.fromNode) && byId.has(edge.toNode)) incoming.set(edge.toNode, (incoming.get(edge.toNode) ?? 0) + 1);
    const roots = nodes.filter((node) => incoming.get(node.id) === 0);
    const queue = (roots.length ? roots : nodes.slice(0, 1)).map((node) => ({ id: node.id, depth: 0 }));
    const levels = new Map<number, string[]>(), visited = new Set<string>();
    while (queue.length) {
      const next = queue.shift()!; if (visited.has(next.id)) continue;
      visited.add(next.id); levels.set(next.depth, [...(levels.get(next.depth) ?? []), next.id]);
      for (const edge of document.edges) if (edge.fromNode === next.id && byId.has(edge.toNode) && !visited.has(edge.toNode)) queue.push({ id: edge.toNode, depth: next.depth + 1 });
    }
    for (const node of nodes) if (!visited.has(node.id)) levels.set(0, [...(levels.get(0) ?? []), node.id]);
    for (const [depth, ids] of levels) ids.forEach((id, index) => {
      const horizontal = layout === 'mind-map';
      positions.set(id, horizontal && depth > 0 ? { x: originX + (index % 2 ? -1 : 1) * depth * 410, y: originY + Math.floor(index / 2) * 300 } : { x: originX + (horizontal ? 0 : index * 400), y: originY + (horizontal ? index * 300 : depth * 320) });
    });
  }
  return canvasDocumentSchema.parse({ ...document, nodes: document.nodes.map((node) => positions.has(node.id) ? { ...node, ...positions.get(node.id)! } : node) });
}

export function canvasEdgePoints(edge: CanvasEdge, from: CanvasNode, to: CanvasNode): { x1: number; y1: number; x2: number; y2: number } {
  const center = (node: CanvasNode) => ({ x: node.x + node.width / 2, y: node.y + node.height / 2 });
  const a = center(from), b = center(to);
  const inferred = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? [b.x >= a.x ? 'right' : 'left', b.x >= a.x ? 'left' : 'right'] : [b.y >= a.y ? 'bottom' : 'top', b.y >= a.y ? 'top' : 'bottom'];
  const pointAt = (node: CanvasNode, location: string) => location === 'left' ? { x: node.x, y: node.y + node.height / 2 } : location === 'right' ? { x: node.x + node.width, y: node.y + node.height / 2 } : location === 'top' ? { x: node.x + node.width / 2, y: node.y } : { x: node.x + node.width / 2, y: node.y + node.height };
  const start = pointAt(from, edge.fromSide === 'auto' ? inferred[0]! : edge.fromSide);
  const end = pointAt(to, edge.toSide === 'auto' ? inferred[1]! : edge.toSide);
  return { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
}

type Reference = Pick<VaultNote, 'id' | 'path'> | Pick<Attachment, 'id' | 'path'>;
function relativeCanvasFilePath(path: string, canvasPath: string): string {
  const source = canvasPath.split('/').filter(Boolean).slice(0, -1);
  const target = path.split('/').filter(Boolean);
  while (source.length && target.length && source[0]!.toLocaleLowerCase() === target[0]!.toLocaleLowerCase()) { source.shift(); target.shift(); }
  return `${'../'.repeat(source.length)}${target.join('/')}`;
}
function absoluteCanvasFilePath(path: string, canvasPath: string): string | null {
  if (path.startsWith('/')) return path;
  const parts = canvasPath.split('/').filter(Boolean).slice(0, -1);
  for (const part of path.split('/')) {
    if (part === '..') { if (!parts.length) return null; parts.pop(); }
    else if (part && part !== '.') parts.push(part);
  }
  return `/${parts.join('/')}`;
}
export function exportJsonCanvas(document: CanvasDocument, notes: readonly Reference[] = [], attachments: readonly Reference[] = [], canvasPath = '/Canvases/Untitled.canvas'): Record<string, unknown> {
  const parsed = canvasDocumentSchema.parse(document);
  return { nodes: parsed.nodes.map((node) => {
    const common = { id: node.id, x: Math.round(node.x), y: Math.round(node.y), width: Math.round(node.width), height: Math.round(node.height), ...(node.color ? { color: node.color } : {}) };
    const metadata = { kind: node.kind, ...(node.noteId ? { noteId: node.noteId } : {}), ...(node.attachmentId ? { attachmentId: node.attachmentId } : {}), ...(node.groupId ? { groupId: node.groupId } : {}) };
    if (node.kind === 'text') return { ...common, type: 'text', text: node.text, 'noor-note': metadata };
    if (node.kind === 'url') return { ...common, type: 'link', url: node.url, 'noor-note': metadata };
    if (node.kind === 'group' || node.kind === 'frame') return { ...common, type: 'group', label: node.label, 'noor-note': metadata };
    const file = node.noteId ? notes.find((item) => item.id === node.noteId)?.path : node.attachmentId ? attachments.find((item) => item.id === node.attachmentId)?.path : null;
    const filePath = file ?? node.filePath ?? '';
    return { ...common, type: 'file', file: filePath.startsWith('/') ? relativeCanvasFilePath(filePath, canvasPath) : filePath, 'noor-note': metadata };
  }), edges: parsed.edges.map((edge) => ({ id: edge.id, fromNode: edge.fromNode, toNode: edge.toNode, ...(edge.fromSide === 'auto' ? {} : { fromSide: edge.fromSide }), ...(edge.toSide === 'auto' ? {} : { toSide: edge.toSide }), fromEnd: edge.fromEnd, toEnd: edge.toEnd, ...(edge.label ? { label: edge.label } : {}), ...(edge.color ? { color: edge.color } : {}) })), 'noor-note': { version: 1, viewport: parsed.viewport, grid: parsed.grid, frameOrder: parsed.frameOrder } };
}

const jsonNodeSchema = z.object({ id: z.string().min(1).max(200), type: z.enum(['text', 'file', 'link', 'group']), x: point, y: point, width: extent, height: extent, color: color.optional(), text: z.string().max(100_000).optional(), file: z.string().max(1000).optional(), url: httpUrl.optional(), label: z.string().max(500).optional(), 'noor-note': z.object({ kind: kind.optional(), noteId: id.optional(), attachmentId: id.optional(), groupId: z.string().optional() }).passthrough().optional() }).passthrough();
const jsonEdgeSchema = z.object({ id: z.string().min(1).max(200), fromNode: z.string(), toNode: z.string(), fromSide: side.optional(), toSide: side.optional(), fromEnd: endpoint.optional(), toEnd: endpoint.optional(), label: z.string().max(500).optional(), color: color.optional() }).passthrough();
const jsonCanvasSchema = z.object({ nodes: z.array(jsonNodeSchema).max(5000).default([]), edges: z.array(jsonEdgeSchema).max(10000).default([]), 'noor-note': z.object({ version: z.literal(1).optional(), viewport: canvasDocumentSchema.shape.viewport.optional(), grid: canvasDocumentSchema.shape.grid.optional(), frameOrder: z.array(z.string()).optional() }).passthrough().optional() }).passthrough();
export function importJsonCanvas(input: unknown, notes: readonly Reference[] = [], attachments: readonly Reference[] = [], canvasPath = '/Canvases/Untitled.canvas'): CanvasDocument {
  const source = jsonCanvasSchema.parse(input);
  if (new Set(source.nodes.map((node) => node.id)).size !== source.nodes.length) throw new Error('Duplicate JSON Canvas node IDs');
  if (new Set(source.edges.map((edge) => edge.id)).size !== source.edges.length) throw new Error('Duplicate JSON Canvas edge IDs');
  const ids = new Map(source.nodes.map((node) => [node.id, z.uuid().safeParse(node.id).success ? node.id : crypto.randomUUID()]));
  const lookup = (path: string, items: readonly Reference[]) => {
    const resolved = absoluteCanvasFilePath(path, canvasPath);
    return items.find((item) => item.path.normalize('NFKC').toLocaleLowerCase() === resolved?.normalize('NFKC').toLocaleLowerCase());
  };
  const nodes = source.nodes.map((node) => {
    const metadata = node['noor-note'];
    if (node.type === 'text' && node.text === undefined || node.type === 'link' && !node.url || node.type === 'file' && !node.file) throw new Error(`Incomplete JSON Canvas node: ${node.id}`);
    const note = node.type === 'file' ? notes.find((item) => item.id === metadata?.noteId) ?? lookup(node.file ?? '', notes) : undefined;
    const attachment = node.type === 'file' ? attachments.find((item) => item.id === metadata?.attachmentId) ?? lookup(node.file ?? '', attachments) : undefined;
    const requested = metadata?.kind;
    const nodeKind: CanvasNodeKind = node.type === 'text' ? 'text' : node.type === 'link' ? 'url' : node.type === 'group' ? requested === 'frame' ? 'frame' : 'group' : note ? 'note' : attachment ? requested && ['image', 'pdf', 'audio', 'video', 'attachment'].includes(requested) ? requested : 'attachment' : 'attachment';
    return canvasNodeSchema.parse({ id: ids.get(node.id), kind: nodeKind, x: node.x, y: node.y, width: node.width, height: node.height, color: node.color ?? null, label: node.label ?? '', text: node.text ?? '', url: node.type === 'link' ? node.url : null, noteId: note?.id ?? null, attachmentId: attachment?.id ?? null, filePath: node.type === 'file' ? node.file ?? null : null, groupId: metadata?.groupId ? ids.get(metadata.groupId) ?? null : null });
  });
  const edges = source.edges.map((edge) => canvasEdgeSchema.parse({ id: z.uuid().safeParse(edge.id).success ? edge.id : crypto.randomUUID(), fromNode: ids.get(edge.fromNode), toNode: ids.get(edge.toNode), fromSide: edge.fromSide ?? 'auto', toSide: edge.toSide ?? 'auto', fromEnd: edge.fromEnd ?? 'none', toEnd: edge.toEnd ?? 'arrow', label: edge.label ?? '', color: edge.color ?? null }));
  const frames = nodes.filter((node) => node.kind === 'frame').map((node) => node.id);
  const order = [...new Set([...(source['noor-note']?.frameOrder?.map((value) => ids.get(value)).filter((value): value is string => Boolean(value)) ?? []), ...frames])];
  return canvasDocumentSchema.parse({ version: 1, nodes, edges, viewport: source['noor-note']?.viewport, grid: source['noor-note']?.grid, frameOrder: order });
}
