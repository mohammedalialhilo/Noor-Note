'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight, Copy, FilePlus2, Highlighter, MessageSquare, ScanText, Search, X } from 'lucide-react';
import { collectPdfBacklinks, isPdfAttachment, pdfReferenceLink, type PdfAnnotation, type VaultNote } from '@noor-note/core';
import { safeAttachmentPreview } from '../lib/safe-attachment-preview';
import type { PDFDocumentProxy, PDFDocumentLoadingTask } from 'pdfjs-dist';
import type { useVaultWorkspace } from '../hooks/useVaultWorkspace';
import { PdfAnnotationsStore } from '../lib/pdf-annotations';
import { PdfPage, type PdfSelection } from './PdfPage';
import { SharedComments } from './SharedComments';
import type { VaultRole } from '../lib/sharing';
import styles from './PdfReader.module.css';

interface Props { workspace: ReturnType<typeof useVaultWorkspace>; attachmentId: string; initialPage: number; initialAnnotationId: string | null; onClose: () => void; onOpenNote: (id: string, line?: number) => void; onOpenOcr: (id: string, page: number) => void; sharedRole?: VaultRole | null }
interface SearchHit { page: number; excerpt: string }

function PdfThumbnail({ document, page, active, onOpen }: { document: PDFDocumentProxy; page: number; active: boolean; onOpen: () => void }) {
  const hostRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (typeof IntersectionObserver === 'undefined') { const timer = window.setTimeout(() => setVisible(true), 0); return () => window.clearTimeout(timer); }
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: '200px' });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || !canvasRef.current) return;
    let live = true;
    let task: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | null = null;
    void document.getPage(page).then(async (pdfPage) => {
      if (!live || !canvasRef.current) return;
      const base = pdfPage.getViewport({ scale: 1 });
      const viewport = pdfPage.getViewport({ scale: 96 / base.width });
      const canvas = canvasRef.current;
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      task = pdfPage.render({ canvas, viewport });
      await task.promise;
    }).catch(() => undefined);
    return () => { live = false; task?.cancel(); };
  }, [document, page, visible]);
  return <button ref={hostRef} type="button" className={`${styles.thumbnail} ${active ? styles.thumbnailActive : ''}`} onClick={onOpen} aria-label={`Go to page ${page}`} aria-current={active ? 'page' : undefined}><canvas ref={canvasRef} aria-hidden="true" /><span>{page}</span></button>;
}

export function PdfReader({ workspace, attachmentId, initialPage, initialAnnotationId, onClose, onOpenNote, onOpenOcr, sharedRole }: Props) {
  const attachment = workspace.attachments.find((item) => item.id === attachmentId && isPdfAttachment(item));
  const vaultId = workspace.activeVault?.id;
  const repository = workspace.repository;
  const store = useMemo(() => repository && vaultId ? new PdfAnnotationsStore(repository, vaultId) : null, [repository, vaultId]);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(initialPage);
  const [scale, setScale] = useState(1);
  const [zoomMode, setZoomMode] = useState<'custom' | 'fit-width' | 'fit-page'>('fit-width');
  const [thumbnailsOpen, setThumbnailsOpen] = useState(true);
  const [annotations, setAnnotations] = useState<PdfAnnotation[]>([]);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(initialAnnotationId);
  const [selection, setSelection] = useState<PdfSelection | null>(null);
  const [comment, setComment] = useState('');
  const [color, setColor] = useState<PdfAnnotation['color']>('yellow');
  const [query, setQuery] = useState('');
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searchProgress, setSearchProgress] = useState<string | null>(null);
  const [fullNotes, setFullNotes] = useState<VaultNote[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const pageHostRef = useRef<HTMLDivElement>(null);
  const searchTokenRef = useRef(0);
  const revisionKey = workspace.notes.map((item) => `${item.id}:${item.revision}`).join('|');
  const activeAnnotation = annotations.find((item) => item.id === activeAnnotationId) ?? null;
  const backlinks = useMemo(() => attachment ? collectPdfBacklinks(fullNotes, attachment, activeAnnotation ?? undefined) : [], [fullNotes, attachment, activeAnnotation]);

  useEffect(() => {
    const previous = globalThis.document.activeElement instanceof HTMLElement ? globalThis.document.activeElement : null;
    closeRef.current?.focus();
    return () => previous?.focus();
  }, []);
  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); return; }
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]'));
    if (!focusable.length) return;
    const first = focusable[0]!, last = focusable.at(-1)!;
    if (event.shiftKey && globalThis.document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && globalThis.document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  useEffect(() => {
    if (!attachment || !repository) return;
    let live = true;
    let url: string | null = null;
    let task: PDFDocumentLoadingTask | null = null;
    void repository.getAttachmentBlob(attachment.id).then(async (blob) => {
      if (!blob) throw new Error('The PDF file is missing from local storage.');
      if (!live) return;
      const preview = await safeAttachmentPreview(blob, 'application/pdf');
      if (!preview) throw new Error('The file bytes do not match a PDF.');
      url = URL.createObjectURL(preview);
      const pdfjs = await import('pdfjs-dist');
      if (!live) return;
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
      task = pdfjs.getDocument({ url });
      const loaded = await task.promise;
      if (live) { setDocument(loaded); setPage((current) => Math.min(Math.max(current, 1), loaded.numPages)); }
      else await task.destroy();
    }).catch((caught) => { if (live) setError(caught instanceof Error ? caught.message : 'Could not open this PDF.'); });
    return () => { live = false; searchTokenRef.current += 1; if (task) void task.destroy(); if (url) URL.revokeObjectURL(url); };
  }, [attachment, repository]);
  useEffect(() => {
    if (!store || !attachment) return;
    let live = true;
    void store.list(attachment.id).then((items) => {
      if (!live) return;
      setAnnotations(items);
      const selected = items.find((item) => item.id === initialAnnotationId);
      if (selected) { setComment(selected.comment); setColor(selected.color); setPage(selected.page); }
    }).catch((caught) => { if (live) setError(caught instanceof Error ? caught.message : 'Could not load annotations.'); });
    return () => { live = false; };
  }, [store, attachment, initialAnnotationId]);
  useEffect(() => {
    if (!repository || !attachment) return;
    let live = true;
    void Promise.all(workspace.notes.map((item) => repository.getNote(item.id))).then((items) => { if (live) setFullNotes(items.filter((item): item is VaultNote => Boolean(item))); }).catch(() => { if (live) setFullNotes([]); });
    return () => { live = false; };
  // revisionKey tracks changes without refetching on unrelated UI state.
  }, [repository, attachment, workspace.notes, revisionKey]);
  useEffect(() => {
    if (!document || zoomMode === 'custom') return;
    let live = true;
    const fit = async () => {
      const pdfPage = await document.getPage(Math.min(Math.max(page, 1), document.numPages));
      if (!live || !pageHostRef.current) return;
      const viewport = pdfPage.getViewport({ scale: 1 });
      const width = Math.max(200, pageHostRef.current.clientWidth - 48);
      const height = Math.max(200, pageHostRef.current.clientHeight - 48);
      const next = zoomMode === 'fit-page' ? Math.min(width / viewport.width, height / viewport.height) : width / viewport.width;
      setScale(Math.max(0.25, Math.min(4, next)));
    };
    void fit();
    const observer = new ResizeObserver(() => { void fit(); });
    if (pageHostRef.current) observer.observe(pageHostRef.current);
    return () => { live = false; observer.disconnect(); };
  }, [document, page, zoomMode]);
  const goto = (next: number) => { if (document && Number.isFinite(next)) { setPage(Math.max(1, Math.min(document.numPages, Math.trunc(next)))); setSelection(null); } };
  const copy = async (value: string, success: string) => { try { await navigator.clipboard.writeText(value); setMessage(success); setError(null); } catch { setError('Clipboard access failed. Try again after allowing clipboard permission.'); } };
  const search = async () => {
    const token = ++searchTokenRef.current;
    if (!document || !query.trim()) { setSearchHits([]); setSearchProgress(null); return; }
    const term = query.trim().toLocaleLowerCase();
    const hits: SearchHit[] = [];
    setSearchProgress('Searching PDF…'); setError(null);
    try {
      for (let index = 1; index <= document.numPages; index += 1) {
        const pdfPage = await document.getPage(index);
        const content = await pdfPage.getTextContent();
        if (token !== searchTokenRef.current) return;
        const text = content.items.flatMap((item) => 'str' in item ? [item.str] : []).join(' ');
        const at = text.toLocaleLowerCase().indexOf(term);
        if (at >= 0) hits.push({ page: index, excerpt: text.slice(Math.max(0, at - 50), Math.min(text.length, at + term.length + 90)) });
        if (index % 10 === 0) setSearchProgress(`Searching page ${index} of ${document.numPages}…`);
      }
      setSearchHits(hits); setSearchProgress(`${hits.length} ${hits.length === 1 ? 'page' : 'pages'} found`);
    } catch (caught) { if (token === searchTokenRef.current) setError(caught instanceof Error ? caught.message : 'Could not search the PDF.'); }
  };
  const saveAnnotation = async (kind: PdfAnnotation['kind']) => {
    if (!selection || !store || !attachment) return;
    setBusy(true); setError(null);
    try {
      if (kind === 'comment' && !comment.trim()) throw new Error('Write a comment before saving the annotation.');
      const saved = await store.create(attachment.id, { page: selection.page, kind, quote: selection.quote, rects: selection.rects, comment: comment.trim(), color });
      setAnnotations(await store.list(attachment.id)); setActiveAnnotationId(saved.id); setSelection(null); setComment('');
      window.getSelection()?.removeAllRanges(); setMessage('Annotation saved beside the PDF.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save annotation.'); }
    finally { setBusy(false); }
  };
  const updateAnnotation = async () => {
    if (!activeAnnotation || !store) return;
    setBusy(true); setError(null);
    try { const updated = await store.update(activeAnnotation, comment, color); setAnnotations((items) => items.map((item) => item.id === updated.id ? updated : item)); setMessage('Annotation updated.'); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not update annotation.'); }
    finally { setBusy(false); }
  };
  const createNote = async () => {
    if (!attachment || !repository || !vaultId || !selection) return;
    setBusy(true); setError(null);
    try {
      await workspace.flushPending();
      const annotation = await store!.create(attachment.id, { page: selection.page, kind: 'highlight', quote: selection.quote, rects: selection.rects, comment: '', color });
      setAnnotations(await store!.list(attachment.id));
      const quote = selection.quote;
      const created = await repository.createNote(vaultId, attachment.folderId, `Quote from ${attachment.name.replace(/\.pdf$/iu, '')}`, (path) => `> ${quote.split('\n').join('\n> ')}\n\nSource: ${pdfReferenceLink(path, attachment, selection.page, annotation.id)}\n`);
      await workspace.refreshActive(); setSelection(null); setMessage('Quote note created.'); onOpenNote(created.id);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not create the quote note.'); }
    finally { setBusy(false); }
  };
  const selectAnnotation = (item: PdfAnnotation) => { setActiveAnnotationId(item.id); setPage(item.page); setComment(item.comment); setColor(item.color); setSelection(null); };
  const copyReference = (annotation?: PdfAnnotation) => {
    if (!attachment) return;
    const targetPage = annotation?.page ?? page;
    const href = `${attachment.path.split('/').map((part) => encodeURIComponent(part)).join('/')}#page=${targetPage}&noor-pdf=${attachment.id}${annotation ? `&annotation=${annotation.id}` : ''}`;
    void copy(`[${attachment.name}, page ${targetPage}](${href})`, 'PDF link copied.');
  };
  if (!attachment) return <div className={styles.backdrop}><div className={styles.missing} role="alert">PDF attachment is unavailable. <button type="button" onClick={onClose}>Close</button></div></div>;
  return <div ref={dialogRef} className={styles.backdrop} role="dialog" aria-modal="true" aria-label={`PDF reader: ${attachment.name}`} onKeyDown={handleDialogKeyDown}>
    <div className={styles.reader}>
      <header className={styles.header}><strong>{attachment.name}</strong><div className={styles.toolbar}>
        <button type="button" onClick={() => setThumbnailsOpen((open) => !open)} aria-pressed={thumbnailsOpen}>Thumbnails</button>
        <button type="button" aria-label="Previous page" disabled={!document || page <= 1} onClick={() => goto(page - 1)}><ChevronLeft size={18} /></button>
        <label className={styles.pageField}>Page <input type="number" min={1} max={document?.numPages ?? 1} value={page} onChange={(event) => goto(Number(event.target.value))} /> / {document?.numPages ?? '…'}</label>
        <button type="button" aria-label="Next page" disabled={!document || page >= document.numPages} onClick={() => goto(page + 1)}><ChevronRight size={18} /></button>
        <button type="button" aria-label="Zoom out" disabled={!document} onClick={() => { setZoomMode('custom'); setScale((value) => Math.max(.25, Math.round((value - .25) * 100) / 100)); }}>−</button>
        <span aria-label="Zoom level">{Math.round(scale * 100)}%</span>
        <button type="button" aria-label="Zoom in" disabled={!document} onClick={() => { setZoomMode('custom'); setScale((value) => Math.min(4, Math.round((value + .25) * 100) / 100)); }}>+</button>
        <button type="button" aria-pressed={zoomMode === 'fit-width'} onClick={() => setZoomMode('fit-width')}>Fit width</button>
        <button type="button" aria-pressed={zoomMode === 'fit-page'} onClick={() => setZoomMode('fit-page')}>Fit page</button>
        <button type="button" onClick={() => copyReference()}>Copy page link</button>
        <button type="button" onClick={() => onOpenOcr(attachmentId, page)}><ScanText size={16} /> OCR page</button>
        <button ref={closeRef} type="button" aria-label="Close PDF reader" onClick={onClose}><X size={19} /></button>
      </div></header>
      <div className={styles.body}>
        {thumbnailsOpen && <aside className={styles.thumbnails} aria-label="Page thumbnails">{document ? Array.from({ length: document.numPages }, (_, index) => <PdfThumbnail key={index + 1} document={document} page={index + 1} active={page === index + 1} onOpen={() => goto(index + 1)} />) : <p>Loading thumbnails…</p>}</aside>}
        <main ref={pageHostRef} className={styles.pageHost}>
          {document ? <PdfPage document={document} page={Math.max(1, Math.min(document.numPages, page))} scale={scale} annotations={annotations.filter((item) => item.page === page)} activeAnnotationId={activeAnnotationId} onSelection={setSelection} /> : <p className={styles.loading}>{error ?? 'Loading PDF locally…'}</p>}
        </main>
        <aside className={styles.inspector} aria-label="PDF search and annotations">
          <form className={styles.search} onSubmit={(event) => { event.preventDefault(); void search(); }}><label>Search PDF<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find text" /></label><button type="submit" disabled={!document}><Search size={16} /> Search</button></form>
          {searchProgress && <p role="status" className={styles.subtle}>{searchProgress}</p>}
          {searchHits.length > 0 && <div className={styles.searchHits}>{searchHits.map((hit) => <button key={hit.page} type="button" onClick={() => goto(hit.page)}><strong>Page {hit.page}</strong><span>{hit.excerpt}</span></button>)}</div>}
          <section className={styles.section}><h2>Selection</h2>{selection ? <><blockquote>{selection.quote}</blockquote><div className={styles.actions}><button type="button" disabled={busy} onClick={() => { void saveAnnotation('highlight'); }}><Highlighter size={16} /> Highlight</button><button type="button" onClick={() => { void copy(selection.quote, 'Quote copied.'); }}><Copy size={16} /> Copy quote</button><button type="button" disabled={busy} onClick={() => { void createNote(); }}><FilePlus2 size={16} /> Create note</button></div><label>Private annotation note<textarea value={comment} maxLength={20_000} onChange={(event) => setComment(event.target.value)} placeholder="Add context to this selection" /></label><button type="button" disabled={busy || !comment.trim()} onClick={() => { void saveAnnotation('comment'); }}><MessageSquare size={16} /> Save private annotation</button></> : <p className={styles.subtle}>Select text on the page to highlight, add a private annotation, copy, or make a note.</p>}</section>
          <section className={styles.section}><h2>Annotations ({annotations.length})</h2>{annotations.map((item) => <button type="button" key={item.id} className={`${styles.annotationItem} ${item.id === activeAnnotationId ? styles.annotationActive : ''}`} onClick={() => selectAnnotation(item)}><strong>Page {item.page} · {item.kind}</strong><span>{item.quote}</span>{item.comment && <small>{item.comment}</small>}</button>)}{!annotations.length && <p className={styles.subtle}>No annotations yet.</p>}
            {activeAnnotation && <div className={styles.annotationEdit}><h3>Selected annotation</h3><blockquote>{activeAnnotation.quote}</blockquote><label>Private annotation note<textarea value={comment} maxLength={20_000} onChange={(event) => setComment(event.target.value)} /></label><label>Color<select value={color} onChange={(event) => setColor(event.target.value as PdfAnnotation['color'])}><option value="yellow">Yellow</option><option value="green">Green</option><option value="blue">Blue</option><option value="pink">Pink</option></select></label><div className={styles.actions}><button type="button" disabled={busy} onClick={() => { void updateAnnotation(); }}>Save private note</button><button type="button" onClick={() => copyReference(activeAnnotation)}>Copy annotation link</button><button type="button" onClick={() => { void copy(activeAnnotation.quote, 'Quote copied.'); }}>Copy quote</button></div></div>}
          </section>
          <section className={styles.section}><h2>{activeAnnotation ? 'Notes referencing annotation' : 'Notes referencing PDF'}</h2>{backlinks.map((item) => <button type="button" key={`${item.noteId}:${item.line}`} className={styles.backlink} onClick={() => onOpenNote(item.noteId, item.line)}><strong>{item.title || item.path}</strong><span>{item.preview}</span></button>)}{!backlinks.length && <p className={styles.subtle}>No linked notes yet.</p>}</section>
          {sharedRole && vaultId && activeAnnotation && <SharedComments vaultId={vaultId} targetKind="pdf" targetId={attachmentId} role={sharedRole} draftAnchor={{ kind: 'pdf', annotationId: activeAnnotation.id, page: activeAnnotation.page, quote: activeAnnotation.quote.slice(0, 2000) }} focusAnchorId={activeAnnotation.id} onNavigatePdf={(targetPage, annotationId) => { setPage(targetPage); setActiveAnnotationId(annotationId); }} />}
          {error && <p className={styles.error} role="alert">{error}</p>}{message && <p className={styles.message} role="status">{message}</p>}
        </aside>
      </div>
    </div>
  </div>;
}
