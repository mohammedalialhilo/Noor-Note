'use client';

import { useEffect, useState } from 'react';
import { canvasDocumentSchema, type Attachment, type CanvasDocument } from '@noor-note/core';
import type { NoteEntry, VaultRepository } from '@noor-note/storage';
import { CanvasBoard } from './CanvasBoard';
import styles from './CanvasView.module.css';

interface Props { document: CanvasDocument; notes: NoteEntry[]; attachments: Attachment[]; repository: VaultRepository | null; onClose: () => void; onOpenNote: (id: string) => void }
export function CanvasPresentation({ document, notes, attachments, repository, onClose, onOpenNote }: Props) {
  const [index, setIndex] = useState(0);
  const [size, setSize] = useState({ width: 1200, height: 700 });
  useEffect(() => { const resize = () => setSize({ width: window.innerWidth, height: window.innerHeight - 80 }); resize(); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); setIndex((current) => Math.min(document.frameOrder.length - 1, current + 1)); }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); setIndex((current) => Math.max(0, current - 1)); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [document.frameOrder.length, onClose]);
  const frame = document.nodes.find((node) => node.id === document.frameOrder[index]);
  if (!frame) return null;
  const nodes = document.nodes.filter((node) => node.id === frame.id || node.kind !== 'frame' && node.x >= frame.x && node.y >= frame.y && node.x + node.width <= frame.x + frame.width && node.y + node.height <= frame.y + frame.height);
  const ids = new Set(nodes.map((node) => node.id));
  const slide = canvasDocumentSchema.parse({ ...document, nodes, edges: document.edges.filter((edge) => ids.has(edge.fromNode) && ids.has(edge.toNode)), frameOrder: [frame.id] });
  const zoom = Math.min(4, Math.max(0.1, Math.min((size.width - 60) / frame.width, (size.height - 40) / frame.height) * 0.9));
  const viewport = { x: size.width / 2 - (frame.x + frame.width / 2) * zoom, y: size.height / 2 - (frame.y + frame.height / 2) * zoom, zoom };
  return <div className={styles.presentation} role="dialog" aria-modal="true" aria-label="Canvas presentation"><div className={styles.presentationBar}><strong>{frame.label || `Frame ${index + 1}`}</strong><span>{index + 1} / {document.frameOrder.length}</span><button type="button" disabled={index === 0} onClick={() => setIndex((current) => current - 1)}>Previous</button><button type="button" disabled={index === document.frameOrder.length - 1} onClick={() => setIndex((current) => current + 1)}>Next</button><button type="button" autoFocus onClick={onClose}>Close</button></div><div className={styles.presentationStage}><CanvasBoard document={slide} viewport={viewport} selected={new Set()} selectedEdge={null} tool="pan" notes={notes} attachments={attachments} repository={repository} readonly onViewport={() => undefined} onCommit={() => undefined} onSelect={() => undefined} onSelectEdge={() => undefined} onOpenNote={onOpenNote} onEditText={() => undefined} /></div></div>;
}
