'use client';

import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import type Sigma from 'sigma';
import type { Attachment, VaultNote } from '@noor-note/core';
import type { NoteEntry, VaultRepository } from '@noor-note/storage';
import { ArrowDownLeft, ArrowUpRight, Check, FileText, Focus, Link2, Maximize2, Menu, MoreHorizontal, Network, Search, X, ZoomIn, ZoomOut } from 'lucide-react';
import { GraphClient } from '../lib/graph-client';
import { defaultGraphFilters, localGraph, visibleGraph, type GraphFilters, type GraphPositions, type KnowledgeGraph, type KnowledgeNode } from '../lib/knowledge-graph';
import type { WorkspaceLayout } from '../lib/workspace-layout';
import { useTheme } from '../theme/ThemeProvider';
import styles from './GraphView.module.css';

interface Props {
  vaultId: string;
  notes: NoteEntry[];
  attachments: Attachment[];
  selectedNote: VaultNote | null;
  repository: VaultRepository | null;
  client: GraphClient;
  scope: 'global' | 'local';
  onScopeChange: (scope: 'global' | 'local') => void;
  onOpenNote: (id: string, mode: 'current' | 'tab' | 'split') => void;
  onShowLocalGraph: (id: string) => void;
  onFilterTag: (tag: string) => void;
  onOpenNotes: () => void;
  onOpenNavigation: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  initialState?: WorkspaceLayout['graph'];
  onStateChange?: (state: WorkspaceLayout['graph']) => void;
}

const blankGraph: KnowledgeGraph = { nodes: [], edges: [] };
const groupTokens = ['--nn-graph-group-1', '--nn-graph-group-2', '--nn-graph-group-3', '--nn-graph-group-4', '--nn-graph-group-5', '--nn-graph-group-6'];
function groupIndex(value: string): number { let code = 0; for (const letter of value) code = (Math.imul(code, 31) + letter.charCodeAt(0)) | 0; return Math.abs(code) % groupTokens.length; }

function GraphCanvas({ graph, positions, rootId, query, grouping, nodeSize, onNode, onContext, onError }: {
  graph: KnowledgeGraph; positions: GraphPositions; rootId: string | null; query: string; grouping: 'type' | 'folder'; nodeSize: 'uniform' | 'connections';
  onNode: (node: KnowledgeNode) => void; onContext: (node: KnowledgeNode, x: number, y: number) => void; onError: (message: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<Sigma | null>(null);
  const onNodeRef = useRef(onNode);
  const onContextRef = useRef(onContext);
  const draggedPositionsRef = useRef<GraphPositions>({});
  const nodesRef = useRef(new Map(graph.nodes.map((node) => [node.id, node])));
  const [ready, setReady] = useState(false);
  useEffect(() => { onNodeRef.current = onNode; onContextRef.current = onContext; nodesRef.current = new Map(graph.nodes.map((node) => [node.id, node])); }, [onNode, onContext, graph.nodes]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let renderer: Sigma | null = null;
    void Promise.all([import('sigma'), import('graphology'), import('sigma/rendering')]).then(([sigmaModule, graphModule, rendering]) => {
      if (disposed) return;
      const graphology = new graphModule.default({ type: 'directed', multi: true });
      renderer = new sigmaModule.default(graphology, container, { renderEdgeLabels: false, labelDensity: 0.12, labelGridCellSize: 90, edgeProgramClasses: { arrow: rendering.EdgeArrowProgram }, defaultEdgeType: 'arrow' });
      rendererRef.current = renderer;
      let dragged: string | null = null;
      let moved = false;
      renderer.on('clickNode', ({ node }) => { if (!moved) { const item = nodesRef.current.get(node); if (item) onNodeRef.current(item); } moved = false; });
      renderer.on('rightClickNode', ({ node, event }) => { event.original.preventDefault(); const item = nodesRef.current.get(node); if (item) onContextRef.current(item, event.x, event.y); });
      renderer.on('downNode', ({ node, preventSigmaDefault }) => { dragged = node; moved = false; preventSigmaDefault(); });
      renderer.getMouseCaptor().on('mousemove', (event) => {
        if (!dragged || !renderer || !graphology.hasNode(dragged)) return;
        const point = renderer.viewportToGraph(event);
        graphology.setNodeAttribute(dragged, 'x', point.x); graphology.setNodeAttribute(dragged, 'y', point.y);
        draggedPositionsRef.current[dragged] = point;
        renderer.refresh(); moved = true;
      });
      renderer.getMouseCaptor().on('mouseup', () => { dragged = null; });
      renderer.getMouseCaptor().on('mouseleave', () => { dragged = null; });
      setReady(true);
    }).catch(() => { if (!disposed) onError('This browser could not start the graph renderer.'); });
    return () => { disposed = true; renderer?.kill(); rendererRef.current = null; };
  }, [onError]);

  useEffect(() => {
    const render = () => {
      const renderer = rendererRef.current;
      if (!renderer || !containerRef.current) return;
      const graphology = renderer.getGraph();
      const camera = renderer.getCamera().getState();
      graphology.clear();
      const css = getComputedStyle(containerRef.current);
      const color = (token: string) => css.getPropertyValue(token).trim();
      const needle = query.trim().toLocaleLowerCase();
      for (const node of graph.nodes) {
        const point = draggedPositionsRef.current[node.id] ?? positions[node.id] ?? { x: 0, y: 0 };
        const matches = !needle || `${node.label} ${node.path}`.toLocaleLowerCase().includes(needle);
        const base = node.kind === 'tag' ? color('--nn-gold-muted') : node.kind === 'attachment' ? color('--nn-text-muted') : grouping === 'folder' ? color(groupTokens[groupIndex(node.folderId ?? 'root')]!) : color('--nn-graph-node');
        graphology.addNode(node.id, { x: point.x, y: point.y, label: node.label, size: node.id === rootId ? 15 : nodeSize === 'connections' ? Math.min(17, 5 + Math.sqrt(node.degree) * 2) : 7, color: matches ? base : color('--nn-graph-dim'), highlighted: node.id === rootId, zIndex: node.id === rootId ? 2 : 0 });
      }
      for (const edge of graph.edges) graphology.addDirectedEdgeWithKey(edge.id, edge.source, edge.target, { type: 'arrow', size: Math.min(3, 0.7 + Math.log2(edge.count + 1) * 0.35), color: edge.kind === 'tag' ? color('--nn-graph-tag-edge') : edge.kind === 'embed' ? color('--nn-graph-embed-edge') : rootId && edge.target === rootId ? color('--nn-graph-inbound') : rootId && edge.source === rootId ? color('--nn-graph-outbound') : color('--nn-graph-edge') });
      renderer.refresh();
      renderer.getCamera().setState(camera);
    };
    render();
  }, [graph, positions, rootId, query, grouping, nodeSize, ready]);

  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const zoom = (ratio: number) => { const camera = rendererRef.current?.getCamera(); if (camera) { const state = { ratio: camera.ratio * ratio }; if (reducedMotion()) camera.setState(state); else camera.animate(state, { duration: 180 }); } };
  return <div className={styles.canvasWrap}>
    <div ref={containerRef} className={styles.canvas} role="img" aria-label={`Knowledge graph with ${graph.nodes.length} nodes and ${graph.edges.length} connections. Use the searchable node list to navigate by keyboard.`} />
    <div className={styles.zoomControls}><button type="button" aria-label="Zoom in" onClick={() => zoom(0.7)}><ZoomIn size={17} /></button><button type="button" aria-label="Zoom out" onClick={() => zoom(1.4)}><ZoomOut size={17} /></button><button type="button" aria-label="Fit graph" onClick={() => { const camera = rendererRef.current?.getCamera(); if (!camera) return; if (reducedMotion()) camera.setState({ x: 0.5, y: 0.5, ratio: 1, angle: 0 }); else camera.animatedReset({ duration: 220 }); }}><Maximize2 size={17} /></button></div>
  </div>;
}

export function GraphView({ vaultId, notes, attachments, selectedNote, repository, client, scope, onScopeChange, onOpenNote, onShowLocalGraph, onFilterTag, onOpenNotes, onOpenNavigation, initialState, onStateChange }: Props) {
  const { appearanceRevision, resolvedTheme } = useTheme();
  const [data, setData] = useState<{ graph: KnowledgeGraph; positions: GraphPositions }>({ graph: blankGraph, positions: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<GraphFilters>(initialState?.filters ?? defaultGraphFilters);
  const [query, setQuery] = useState(initialState?.query ?? '');
  const [depth, setDepth] = useState(initialState?.depth ?? 2);
  const [direction, setDirection] = useState<'both' | 'inbound' | 'outbound'>(initialState?.direction ?? 'both');
  const [grouping, setGrouping] = useState<'type' | 'folder'>(initialState?.grouping ?? 'type');
  const [nodeSize, setNodeSize] = useState<'uniform' | 'connections'>(initialState?.nodeSize ?? 'connections');
  const onStateChangeRef = useRef(onStateChange);
  useEffect(() => { onStateChangeRef.current = onStateChange; }, [onStateChange]);
  useEffect(() => { onStateChangeRef.current?.({ scope, filters, query, depth, direction, grouping, nodeSize }); }, [scope, filters, query, depth, direction, grouping, nodeSize]);
  const [context, setContext] = useState<{ node: KnowledgeNode; x: number; y: number } | null>(null);
  const contextTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const rootId = selectedNote?.id ?? null;

  useEffect(() => {
    if (!repository) return;
    let alive = true;
    const timer = window.setTimeout(() => { setLoading(true); setError(null); }, 0);
    void client.load(repository, vaultId, notes, attachments, selectedNote).then((result) => { if (alive) { window.clearTimeout(timer); setData(result); setLoading(false); } }).catch((caught: unknown) => { if (alive) { window.clearTimeout(timer); setError(caught instanceof Error ? caught.message : 'Could not open the graph.'); setLoading(false); } });
    return () => { alive = false; window.clearTimeout(timer); };
  }, [client, repository, vaultId, notes, attachments, selectedNote]);
  useEffect(() => {
    if (!context) return;
    const close = () => setContext(null);
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') { close(); contextTriggerRef.current?.focus(); } };
    window.addEventListener('click', close); window.addEventListener('keydown', onKeyDown);
    const timer = window.setTimeout(() => document.querySelector<HTMLButtonElement>('[role="menu"][aria-label^="Actions for"] [role="menuitem"]')?.focus(), 0);
    return () => { window.clearTimeout(timer); window.removeEventListener('click', close); window.removeEventListener('keydown', onKeyDown); };
  }, [context]);

  const visible = useMemo(() => visibleGraph(data.graph, filters), [data.graph, filters]);
  const graph = useMemo(() => scope === 'local' && rootId ? localGraph(visible, rootId, depth, direction) : scope === 'local' ? blankGraph : visible, [visible, scope, rootId, depth, direction]);
  const results = useMemo(() => graph.nodes.filter((node) => !query.trim() || `${node.label} ${node.path}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort((a, b) => a.label.localeCompare(b.label)).slice(0, 40), [graph.nodes, query]);
  const downloadAttachment = async (id: string) => {
    try {
      const blob = await repository?.getAttachmentBlob(id);
      if (!blob) { setNotice('Attachment is unavailable.'); return; }
      const attachment = attachments.find((item) => item.id === id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = attachment?.name ?? 'attachment'; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setNotice('Attachment downloaded.');
    } catch { setNotice('Could not download this attachment.'); }
  };
  const handleNode = (node: KnowledgeNode) => { if (node.kind === 'note') onOpenNote(node.id, 'current'); else if (node.kind === 'tag') onFilterTag(node.label.slice(1)); else void downloadAttachment(node.id); };
  const copyLink = async (node: KnowledgeNode) => {
    const link = `[[${node.label}]]<!-- noor-note-id:${node.id} -->`;
    try { await navigator.clipboard.writeText(link); setNotice('Note link copied.'); } catch { setNotice(`Copy this link: ${link}`); }
    setContext(null);
  };
  const toggle = (name: keyof GraphFilters) => setFilters((current) => ({ ...current, [name]: !current[name] }));

  return <main className={styles.view}>
    <div className={styles.topbar}><button type="button" className="icon-button mobile-menu" aria-label="Open navigation" onClick={onOpenNavigation}><Menu size={21} /></button><Network size={17} /><strong>Knowledge graph</strong><span className={styles.count}>{graph.nodes.length} nodes · {graph.edges.length} connections</span></div>
    <div className={styles.toolbar}>
      <div className={styles.scope} role="group" aria-label="Graph scope"><button type="button" aria-pressed={scope === 'global'} onClick={() => onScopeChange('global')}>Global</button><button type="button" aria-pressed={scope === 'local'} disabled={!rootId} onClick={() => onScopeChange('local')}>Local</button></div>
      <label className={styles.search}><Search size={16} /><input aria-label="Search graph nodes" placeholder="Find a node" value={query} onChange={(event) => setQuery(event.target.value)} />{query && <button type="button" aria-label="Clear graph search" onClick={() => setQuery('')}><X size={14} /></button>}</label>
      {scope === 'local' && <><label className={styles.selectLabel}>Depth <select aria-label="Local graph depth" value={depth} onChange={(event) => setDepth(Number(event.target.value))}><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option><option value={4}>4</option></select></label><label className={styles.selectLabel}>Direction <select aria-label="Local graph direction" value={direction} onChange={(event) => setDirection(event.target.value as typeof direction)}><option value="both">Both</option><option value="inbound">Inbound</option><option value="outbound">Outbound</option></select></label></>}
      <label className={styles.selectLabel}>Group <select aria-label="Group graph nodes" value={grouping} onChange={(event) => setGrouping(event.target.value as typeof grouping)}><option value="type">Type</option><option value="folder">Folder</option></select></label>
      <label className={styles.selectLabel}>Size <select aria-label="Graph node size" value={nodeSize} onChange={(event) => setNodeSize(event.target.value as typeof nodeSize)}><option value="connections">Connections</option><option value="uniform">Uniform</option></select></label>
    </div>
    <div className={styles.body}>
      <section className={styles.graphPanel} aria-label="Graph visualization">
        {loading && <div className={styles.message} role="status">Building your graph locally…</div>}
        {error && <div className={styles.message} role="alert">{error}<button type="button" onClick={() => { if (!repository) return; setError(null); setLoading(true); void client.load(repository, vaultId, notes, attachments, selectedNote).then((result) => { setData(result); setLoading(false); }).catch((caught: unknown) => { setError(caught instanceof Error ? caught.message : 'Could not open the graph.'); setLoading(false); }); }}>Retry</button></div>}
        {!loading && !error && !graph.nodes.length && <div className={styles.message}><strong>{scope === 'local' ? 'No visible connections' : notes.length ? 'No visible graph nodes' : 'Your graph is empty'}</strong><p>{scope === 'local' ? rootId ? 'This note has no visible links at the current depth and filters.' : 'Open a note to see its local graph.' : notes.length ? 'The current graph filters may hide your notes.' : 'Create a note to start your knowledge graph.'}</p><button type="button" onClick={scope === 'local' ? () => onScopeChange('global') : notes.length ? () => setFilters(defaultGraphFilters) : onOpenNotes}>{scope === 'local' ? 'Show global graph' : notes.length ? 'Reset graph filters' : 'Open notes'}</button></div>}
        {!error && graph.nodes.length > 0 && <GraphCanvas key={`${resolvedTheme}:${appearanceRevision}`} graph={graph} positions={data.positions} rootId={scope === 'local' ? rootId : null} query={query} grouping={grouping} nodeSize={nodeSize} onNode={handleNode} onContext={(node, x, y) => { if (node.kind === 'note') { contextTriggerRef.current = null; setContext({ node, x, y }); } }} onError={setError} />}
        {context && <div className={styles.context} role="menu" aria-label={`Actions for ${context.node.label}`} style={{ left: Math.min(context.x, 500), top: Math.min(context.y, 360) }} onClick={(event) => event.stopPropagation()} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setContext(null); }} onKeyDown={(event) => { if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]; const current = items.indexOf(document.activeElement as HTMLButtonElement); const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; items[next]?.focus(); }}>
          <button role="menuitem" type="button" onClick={() => { onOpenNote(context.node.id, 'tab'); setContext(null); }}>Open in new tab</button><button role="menuitem" type="button" onClick={() => { onOpenNote(context.node.id, 'split'); setContext(null); }}>Open in split</button><button role="menuitem" type="button" onClick={() => { void copyLink(context.node); }}>Copy note link</button><button role="menuitem" type="button" onClick={() => { onShowLocalGraph(context.node.id); setContext(null); }}>Show local graph</button>
        </div>}
        <div className={styles.legend}><span><i className={styles.noteDot} /> Note</span>{filters.showTags && <span><i className={styles.tagDot} /> Tag</span>}{filters.showAttachments && <span><i className={styles.attachmentDot} /> Attachment</span>}{scope === 'local' && <><span><ArrowDownLeft size={13} /> Inbound</span><span><ArrowUpRight size={13} /> Outbound</span></>}</div>
      </section>
      <aside className={styles.inspector} aria-label="Graph controls and nodes">
        <div className={styles.inspectorScroll}><h2>View options</h2><div className={styles.checks}>
          {([['showLinks', 'Note links'], ['showEmbeds', 'Embeds'], ['showTags', 'Tags'], ['showAttachments', 'Attachments'], ['showTagEdges', 'Tag relationships'], ['hideOrphans', 'Hide orphans']] as [keyof GraphFilters, string][]).map(([key, label]) => <label key={key}><input type="checkbox" checked={filters[key]} onChange={() => toggle(key)} />{label}</label>)}
        </div><div className={styles.rule} /><h2>Nodes <span>{graph.nodes.length}</span></h2><p className={styles.hint}>Search, then open a node here with your keyboard.</p><div className={styles.nodeList}>{results.map((node) => <div className={styles.nodeRow} key={node.id}><button type="button" onClick={() => handleNode(node)}><span className={styles.nodeIcon}>{node.kind === 'note' ? <FileText size={15} /> : node.kind === 'tag' ? <Link2 size={15} /> : <Focus size={15} />}</span><span><strong>{node.label}</strong><small>{node.path || node.kind}</small></span><span className={styles.degree}>{node.degree}</span></button>{node.kind === 'note' && <button type="button" className={styles.nodeActions} aria-label={`Actions for ${node.label}`} onClick={(event) => { contextTriggerRef.current = event.currentTarget; setContext({ node, x: 15, y: 20 }); }}><MoreHorizontal size={16} /></button>}</div>)}{!results.length && <p className={styles.hint}>{query.trim() ? 'No nodes match this search.' : 'No nodes in this view.'}</p>}</div></div>
        {notice && <div className={styles.notice} role="status"><Check size={14} />{notice}<button type="button" aria-label="Dismiss message" onClick={() => setNotice(null)}><X size={13} /></button></div>}
      </aside>
    </div>
  </main>;
}
