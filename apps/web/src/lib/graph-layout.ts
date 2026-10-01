import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import type { GraphPositions, KnowledgeGraph } from './knowledge-graph';

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  return result >>> 0;
}

/** Runs only in the graph worker in the app; exported for reproducible profiling. */
export function layoutKnowledgeGraph(graph: KnowledgeGraph, previous: GraphPositions = {}): GraphPositions {
  const next = new Graph({ type: 'directed', multi: true });
  for (const node of graph.nodes) {
    const angle = hash(node.id) / 4294967296 * Math.PI * 2;
    const radius = 5 + (hash(`${node.id}:radius`) % 1000) / 100;
    next.addNode(node.id, previous[node.id] ?? { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  }
  for (const edge of graph.edges) next.addDirectedEdgeWithKey(edge.id, edge.source, edge.target, { weight: Math.min(edge.count, 4) });
  if (next.size) forceAtlas2.assign(next, { iterations: next.order > 2000 ? 24 : next.order > 400 ? 48 : 90, settings: { barnesHutOptimize: next.order > 100, gravity: 0.7, scalingRatio: 8, slowDown: 3 } });
  const result: GraphPositions = {};
  next.forEachNode((id, attributes) => { result[id] = { x: Number(attributes.x), y: Number(attributes.y) }; });
  return result;
}
