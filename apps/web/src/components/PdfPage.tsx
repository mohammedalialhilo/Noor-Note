'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { PDFDocumentProxy, RenderTask, TextLayer } from 'pdfjs-dist';
import type { PdfAnnotation, PdfRect } from '@noor-note/core';
import styles from './PdfReader.module.css';

export interface PdfSelection { page: number; quote: string; rects: PdfRect[] }
interface Props {
  document: PDFDocumentProxy; page: number; scale: number; annotations: PdfAnnotation[]; activeAnnotationId: string | null;
  onSelection: (selection: PdfSelection | null) => void;
}

export function PdfPage({ document, page, scale, annotations, activeAnnotationId, onSelection }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 612 * scale, height: 792 * scale });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let renderTask: RenderTask | null = null;
    let textLayer: TextLayer | null = null;
    const render = async () => {
      const canvas = canvasRef.current, textContainer = textRef.current;
      if (!canvas || !textContainer) return;
      try {
        const pdfPage = await document.getPage(page);
        if (!live) return;
        const viewport = pdfPage.getViewport({ scale });
        setSize({ width: viewport.width, height: viewport.height });
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.ceil(viewport.width * ratio); canvas.height = Math.ceil(viewport.height * ratio);
        canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
        renderTask = pdfPage.render({ canvas, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
        await renderTask.promise;
        if (!live) return;
        textContainer.replaceChildren();
        textContainer.style.setProperty('--total-scale-factor', String(scale));
        textLayer = new (await import('pdfjs-dist')).TextLayer({ textContentSource: await pdfPage.getTextContent(), container: textContainer, viewport });
        await textLayer.render();
        if (live) setError(null);
      } catch (caught) {
        if (live && !(caught instanceof Error && caught.name === 'RenderingCancelledException')) setError(caught instanceof Error ? caught.message : 'Could not render this PDF page.');
      }
    };
    void render();
    return () => { live = false; renderTask?.cancel(); textLayer?.cancel(); };
  }, [document, page, scale]);
  const capture = () => {
    const selected = window.getSelection(), textContainer = textRef.current, element = pageRef.current;
    if (!selected || !selected.rangeCount || !textContainer || !element) return;
    const range = selected.getRangeAt(0);
    if (!textContainer.contains(range.commonAncestorContainer)) return;
    const quote = selected.toString().trim().slice(0, 10_000);
    const bounds = element.getBoundingClientRect();
    const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 1 && rect.height > 1).slice(0, 100).map((rect) => ({
      x: Math.max(0, Math.min(1, (rect.left - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (rect.top - bounds.top) / bounds.height)),
      width: Math.max(0.001, Math.min(1, rect.width / bounds.width)),
      height: Math.max(0.001, Math.min(1, rect.height / bounds.height)),
    })).filter((rect) => rect.x + rect.width <= 1.001 && rect.y + rect.height <= 1.001);
    if (quote && rects.length) onSelection({ page, quote, rects });
  };
  return <div ref={pageRef} className={styles.page} style={{ width: size.width, height: size.height } as CSSProperties} aria-label={`PDF page ${page}`}>
    <canvas ref={canvasRef} aria-hidden="true" />
    <div ref={textRef} className={styles.textLayer} onMouseUp={capture} onKeyUp={capture} aria-label={`Selectable text on page ${page}`} tabIndex={0} />
    <div className={styles.highlights} aria-hidden="true">{annotations.flatMap((annotation) => annotation.rects.map((rect, index) => <span key={`${annotation.id}:${index}`} className={`${styles.highlight} ${annotation.id === activeAnnotationId ? styles.activeHighlight : ''}`} data-color={annotation.color} style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }} />))}</div>
    {error && <p className={styles.pageError} role="alert">{error}</p>}
  </div>;
}
