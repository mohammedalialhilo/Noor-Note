'use client';

import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import { canvasEdgePoints, lassoCanvasNodes, moveCanvasNodes, updateCanvasNode, type Attachment, type CanvasDocument, type CanvasNode } from '@noor-note/core';
import type { NoteEntry, VaultRepository } from '@noor-note/storage';
import { CanvasCardContent } from './CanvasCard';
import styles from './CanvasView.module.css';

type Viewport = CanvasDocument['viewport'];
interface Props {
  document: CanvasDocument; viewport: Viewport; selected: ReadonlySet<string>; selectedEdge: string | null; tool: 'select' | 'pan';
  notes: NoteEntry[]; attachments: Attachment[]; repository: VaultRepository | null; readonly?: boolean;
  onViewport: (viewport: Viewport) => void; onCommit: (document: CanvasDocument) => void; onSelect: (selected: Set<string>) => void; onSelectEdge: (id: string | null) => void;
  onOpenNote: (id: string) => void; onEditText: (id: string) => void; onShortcut?: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
}
type Drag = { type: 'pan' | 'move' | 'lasso' | 'resize'; x: number; y: number; viewport: Viewport; document: CanvasDocument; selected: Set<string>; nodeId?: string; shift: boolean };
const colorToken = (color: string | null) => color?.startsWith('#') ? color : color ? `var(--nn-canvas-color-${color})` : 'var(--nn-accent)';

export function CanvasBoard({ document, viewport, selected, selectedEdge, tool, notes, attachments, repository, readonly = false, onViewport, onCommit, onSelect, onSelectEdge, onOpenNote, onEditText, onShortcut }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const spaceRef = useRef(false);
  const [preview, setPreview] = useState<CanvasDocument | null>(null);
  const [lasso, setLasso] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [size, setSize] = useState({ width: 900, height: 600 });
  const marker = useId().replaceAll(':', '');
  const shown = preview ?? document;
  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    const measure = () => setSize({ width: element.clientWidth || 900, height: element.clientHeight || 600 });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const local = (clientX: number, clientY: number) => { const rect = rootRef.current?.getBoundingClientRect(); return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) }; };
  const selectNode = (id: string, shift: boolean): Set<string> => {
    const next = shift ? new Set(selected) : selected.has(id) ? new Set(selected) : new Set<string>();
    if (shift && next.has(id)) next.delete(id); else next.add(id);
    onSelect(next); onSelectEdge(null); return next;
  };
  const beginNode = (event: ReactPointerEvent<HTMLDivElement>, node: CanvasNode) => {
    if (readonly || event.button !== 0 || event.target instanceof HTMLElement && event.target.closest('button,a,input,textarea,select,audio,video,iframe')) return;
    event.stopPropagation(); event.preventDefault();
    rootRef.current?.focus();
    const current = selectNode(node.id, event.shiftKey);
    if (!current.has(node.id)) return;
    dragRef.current = { type: 'move', x: event.clientX, y: event.clientY, viewport, document, selected: current, shift: event.shiftKey };
    rootRef.current?.setPointerCapture(event.pointerId);
  };
  const beginResize = (event: ReactPointerEvent<HTMLButtonElement>, node: CanvasNode) => {
    if (readonly) return;
    event.stopPropagation(); event.preventDefault();
    onSelect(new Set([node.id])); onSelectEdge(null);
    dragRef.current = { type: 'resize', x: event.clientX, y: event.clientY, viewport, document, selected: new Set([node.id]), nodeId: node.id, shift: false };
    rootRef.current?.setPointerCapture(event.pointerId);
  };
  const beginBackground = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (readonly || event.button !== 0 && event.button !== 1) return;
    if (event.target instanceof HTMLElement && event.target.closest(`.${styles.node}`)) return;
    rootRef.current?.focus();
    const type = tool === 'pan' || spaceRef.current || event.button === 1 ? 'pan' : 'lasso';
    dragRef.current = { type, x: event.clientX, y: event.clientY, viewport, document, selected: new Set(selected), shift: event.shiftKey };
    if (type === 'lasso') { const point = local(event.clientX, event.clientY); setLasso({ ...point, width: 0, height: 0 }); }
    rootRef.current?.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (drag.type === 'pan') { onViewport({ ...drag.viewport, x: drag.viewport.x + dx, y: drag.viewport.y + dy }); return; }
    if (drag.type === 'move') { setPreview(moveCanvasNodes(drag.document, drag.selected, dx / drag.viewport.zoom, dy / drag.viewport.zoom)); return; }
    if (drag.type === 'resize' && drag.nodeId) {
      const node = drag.document.nodes.find((item) => item.id === drag.nodeId);
      if (!node) return;
      const snap = (value: number) => drag.document.grid.snap ? Math.round(value / drag.document.grid.size) * drag.document.grid.size : value;
      setPreview(updateCanvasNode(drag.document, node.id, { width: Math.min(20_000, Math.max(40, snap(node.width + dx / drag.viewport.zoom))), height: Math.min(20_000, Math.max(40, snap(node.height + dy / drag.viewport.zoom))) }));
      return;
    }
    const point = local(drag.x, drag.y);
    setLasso({ ...point, width: dx, height: dy });
  };
  const pointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (rootRef.current?.hasPointerCapture(event.pointerId)) rootRef.current.releasePointerCapture(event.pointerId);
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (drag.type === 'move' && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) onCommit(moveCanvasNodes(drag.document, drag.selected, dx / drag.viewport.zoom, dy / drag.viewport.zoom));
    if (drag.type === 'resize' && drag.nodeId && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) {
      const node = drag.document.nodes.find((item) => item.id === drag.nodeId);
      if (node) {
        const snap = (value: number) => drag.document.grid.snap ? Math.round(value / drag.document.grid.size) * drag.document.grid.size : value;
        onCommit(updateCanvasNode(drag.document, node.id, { width: Math.min(20_000, Math.max(40, snap(node.width + dx / drag.viewport.zoom))), height: Math.min(20_000, Math.max(40, snap(node.height + dy / drag.viewport.zoom))) }));
      }
    }
    if (drag.type === 'lasso') {
      const start = local(drag.x, drag.y), rectangle = { x: (start.x - drag.viewport.x) / drag.viewport.zoom, y: (start.y - drag.viewport.y) / drag.viewport.zoom, width: dx / drag.viewport.zoom, height: dy / drag.viewport.zoom };
      const hits = Math.abs(dx) < 4 && Math.abs(dy) < 4 ? new Set<string>() : lassoCanvasNodes(drag.document, rectangle);
      onSelect(drag.shift ? new Set([...drag.selected, ...hits]) : hits); onSelectEdge(null);
    }
    setPreview(null); setLasso(null);
  };
  const wheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (readonly) return;
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const point = local(event.clientX, event.clientY);
      const zoom = Math.min(4, Math.max(0.1, viewport.zoom * Math.exp(-event.deltaY * 0.002)));
      onViewport({ x: point.x - (point.x - viewport.x) * zoom / viewport.zoom, y: point.y - (point.y - viewport.y) * zoom / viewport.zoom, zoom });
    } else onViewport({ ...viewport, x: viewport.x - event.deltaX, y: viewport.y - event.deltaY });
  };
  const keyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.code === 'Space' && !(event.target instanceof HTMLElement && event.target.closest('input,textarea,select,[contenteditable="true"]'))) { spaceRef.current = true; event.preventDefault(); }
    onShortcut?.(event);
  };
  const visibleNodes = [...shown.nodes.filter((node) => node.kind === 'frame' || node.kind === 'group'), ...shown.nodes.filter((node) => node.kind !== 'frame' && node.kind !== 'group')];
  const bounds = shown.nodes.length ? { left: Math.min(...shown.nodes.map((node) => node.x), -viewport.x / viewport.zoom), top: Math.min(...shown.nodes.map((node) => node.y), -viewport.y / viewport.zoom), right: Math.max(...shown.nodes.map((node) => node.x + node.width), (size.width - viewport.x) / viewport.zoom), bottom: Math.max(...shown.nodes.map((node) => node.y + node.height), (size.height - viewport.y) / viewport.zoom) } : { left: -viewport.x / viewport.zoom, top: -viewport.y / viewport.zoom, right: (size.width - viewport.x) / viewport.zoom, bottom: (size.height - viewport.y) / viewport.zoom };
  const mapWidth = 190, mapHeight = 126, scale = Math.min(mapWidth / Math.max(1, bounds.right - bounds.left), mapHeight / Math.max(1, bounds.bottom - bounds.top));
  const mapX = (x: number) => (x - bounds.left) * scale, mapY = (y: number) => (y - bounds.top) * scale;
  return <div ref={rootRef} className={`${styles.board} ${tool === 'pan' ? styles.panTool : ''}`} role="region" aria-label="Noor Canvas board" tabIndex={0} onPointerDown={beginBackground} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => { dragRef.current = null; setPreview(null); setLasso(null); }} onWheel={wheel} onKeyDown={keyDown} onKeyUp={(event) => { if (event.code === 'Space') spaceRef.current = false; }}>
    {shown.grid.visible && <div className={styles.grid} style={{ backgroundSize: `${shown.grid.size * viewport.zoom}px ${shown.grid.size * viewport.zoom}px`, backgroundPosition: `${viewport.x}px ${viewport.y}px` }} />}
    <svg className={styles.edges} role="group" aria-label="Canvas connectors" width="100%" height="100%"><defs><marker id={marker} markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="strokeWidth"><path d="M0 0 L9 4.5 L0 9 z" fill="var(--nn-accent)" /></marker></defs>{shown.edges.map((edge) => {
      const from = shown.nodes.find((node) => node.id === edge.fromNode), to = shown.nodes.find((node) => node.id === edge.toNode);
      if (!from || !to) return null;
      const p = canvasEdgePoints(edge, from, to), x1 = p.x1 * viewport.zoom + viewport.x, y1 = p.y1 * viewport.zoom + viewport.y, x2 = p.x2 * viewport.zoom + viewport.x, y2 = p.y2 * viewport.zoom + viewport.y;
      return <g key={edge.id} className={styles.edge} role="button" tabIndex={readonly ? -1 : 0} aria-label={`Connector ${edge.label || `${from.kind} to ${to.kind}`}`} aria-pressed={selectedEdge === edge.id} onPointerDown={(event) => { event.stopPropagation(); }} onClick={() => { onSelectEdge(edge.id); onSelect(new Set()); rootRef.current?.focus(); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); onSelectEdge(edge.id); onSelect(new Set()); } }}><line x1={x1} y1={y1} x2={x2} y2={y2} stroke={colorToken(edge.color)} strokeWidth={selectedEdge === edge.id ? 3 : 2} markerStart={edge.fromEnd === 'arrow' ? `url(#${marker})` : undefined} markerEnd={edge.toEnd === 'arrow' ? `url(#${marker})` : undefined} /><line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={16} />{edge.label && <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 8} textAnchor="middle">{edge.label}</text>}</g>;
    })}</svg>
    <div className={styles.world} style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }}>{visibleNodes.map((node) => <div key={node.id} className={`${styles.node} ${styles[node.kind]} ${selected.has(node.id) ? styles.selected : ''}`} style={{ left: node.x, top: node.y, width: node.width, height: node.height, zIndex: node.kind === 'frame' ? 0 : node.kind === 'group' ? 1 : 2, borderColor: node.color ? colorToken(node.color) : undefined } as CSSProperties} role="button" tabIndex={readonly ? -1 : 0} aria-label={`${node.kind} card: ${node.label || notes.find((note) => note.id === node.noteId)?.title || node.text.slice(0, 30) || 'Untitled'}`} aria-pressed={selected.has(node.id)} onPointerDown={(event) => beginNode(event, node)} onKeyDown={(event) => { if (event.key === 'Enter' && !readonly) { event.stopPropagation(); selectNode(node.id, event.shiftKey); } }} onDoubleClick={() => { if (node.kind === 'text' && !readonly) onEditText(node.id); }}><CanvasCardContent node={node} notes={notes} attachments={attachments} repository={repository} onOpenNote={onOpenNote} />{selected.has(node.id) && !readonly && <button type="button" className={styles.resizeHandle} aria-label={`Resize ${node.kind} card`} onPointerDown={(event) => beginResize(event, node)} />}</div>)}</div>
    {lasso && <div className={styles.lasso} style={{ left: Math.min(lasso.x, lasso.x + lasso.width), top: Math.min(lasso.y, lasso.y + lasso.height), width: Math.abs(lasso.width), height: Math.abs(lasso.height) }} />}
    {!readonly && <svg className={styles.minimap} width={mapWidth} height={mapHeight} role="button" tabIndex={0} aria-label="Canvas minimap. Use arrow keys to pan." onKeyDown={(event) => { const step = 80; const dx = event.key === "ArrowLeft" ? step : event.key === "ArrowRight" ? -step : 0; const dy = event.key === "ArrowUp" ? step : event.key === "ArrowDown" ? -step : 0; if (dx || dy) { event.preventDefault(); event.stopPropagation(); onViewport({ ...viewport, x: viewport.x + dx, y: viewport.y + dy }); } }} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); const worldX = bounds.left + (event.clientX - rect.left) / scale, worldY = bounds.top + (event.clientY - rect.top) / scale; onViewport({ ...viewport, x: size.width / 2 - worldX * viewport.zoom, y: size.height / 2 - worldY * viewport.zoom }); }}><rect width={mapWidth} height={mapHeight} fill="var(--nn-surface)" />{shown.nodes.map((node) => <rect key={node.id} x={mapX(node.x)} y={mapY(node.y)} width={Math.max(2, node.width * scale)} height={Math.max(2, node.height * scale)} fill={node.kind === 'frame' ? 'var(--nn-accent-soft)' : 'var(--nn-accent)'} opacity={node.kind === 'frame' ? 0.5 : 0.7} />)}<rect x={mapX(-viewport.x / viewport.zoom)} y={mapY(-viewport.y / viewport.zoom)} width={size.width / viewport.zoom * scale} height={size.height / viewport.zoom * scale} fill="none" stroke="var(--nn-gold)" strokeWidth="2" /></svg>}
  </div>;
}
