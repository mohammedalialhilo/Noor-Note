'use client';

import Image from 'next/image';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { FilePlus2, ScanText, X } from 'lucide-react';
import { isPdfAttachment, type Attachment, type OcrRecord } from '@noor-note/core';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import type { useVaultWorkspace } from '../hooks/useVaultWorkspace';
import { BrowserTesseractOcrProvider, type OcrProvider, type OcrSession } from '../lib/ocr-provider';
import { OcrStore, type OcrDraft } from '../lib/ocr-store';
import { isOcrImage } from '../lib/ocr-source';
import { previewImageMime, safeAttachmentPreview } from '../lib/safe-attachment-preview';
import { PdfPage } from './PdfPage';
import styles from './OcrPanel.module.css';

const localProvider = new BrowserTesseractOcrProvider();
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_DOCUMENT_PAGES = 100;

interface Props {
  workspace: ReturnType<typeof useVaultWorkspace>;
  initialAttachmentId?: string | null;
  initialPage?: number;
  provider?: OcrProvider;
  onClose: () => void;
  onSaved: () => void;
}

async function renderPdfPage(document: PDFDocumentProxy, page: number): Promise<Blob> {
  const pdfPage = await document.getPage(page);
  const base = pdfPage.getViewport({ scale: 1 });
  const scale = Math.min(2, 2200 / Math.max(base.width, base.height), Math.sqrt(12_000_000 / (base.width * base.height)));
  const viewport = pdfPage.getViewport({ scale: Math.max(.001, scale) });
  const canvas = globalThis.document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
  try {
    await pdfPage.render({ canvas, viewport }).promise;
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not prepare this PDF page for OCR.')), 'image/png'));
  } finally { canvas.width = 0; canvas.height = 0; }
}

function ocrDraftFromRecord(record: OcrRecord): OcrDraft {
  return { providerId: record.providerId, languages: record.languages, detectedText: record.detectedText, text: record.text, confidence: record.confidence };
}

export function OcrPanel({ workspace, initialAttachmentId = null, initialPage = 1, provider = localProvider, onClose, onSaved }: Props) {
  const [attachmentId, setAttachmentId] = useState<string | null>(initialAttachmentId);
  const [uploadedAttachment, setUploadedAttachment] = useState<Attachment | null>(null);
  const [page, setPage] = useState(initialPage);
  const [languages, setLanguages] = useState<string[]>(['eng']);
  const [sourceBlob, setSourceBlob] = useState<Blob | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [records, setRecords] = useState<OcrRecord[]>([]);
  const [drafts, setDrafts] = useState<Map<number, OcrDraft>>(new Map());
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const runRef = useRef(0);
  const sessionRef = useRef<OcrSession | null>(null);
  const vaultId = workspace.activeVault?.id;
  const repository = workspace.repository;
  const store = useMemo(() => repository && vaultId ? new OcrStore(repository, vaultId) : null, [repository, vaultId]);
  const attachment = workspace.attachments.find((item) => item.id === attachmentId) ?? (uploadedAttachment?.id === attachmentId ? uploadedAttachment : null);
  const isPdf = attachment ? isPdfAttachment(attachment) : false;
  const saved = records.find((item) => item.page === page) ?? null;
  const draft = drafts.get(page) ?? (saved ? ocrDraftFromRecord(saved) : null);
  const pageCount = pdfDocument?.numPages ?? 1;

  useEffect(() => {
    const previous = globalThis.document.activeElement instanceof HTMLElement ? globalThis.document.activeElement : null;
    closeRef.current?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => () => { runRef.current += 1; if (sessionRef.current) void sessionRef.current.close().catch(() => undefined); }, []);
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !busy) { event.stopPropagation(); onClose(); return; }
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)'));
    const first = focusable[0], last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && globalThis.document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && globalThis.document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  useEffect(() => {
    if (!attachmentId || !repository) return;
    let live = true;
    let url: string | null = null;
    let task: PDFDocumentLoadingTask | null = null;
    void repository.getAttachmentBlob(attachmentId).then(async (blob) => {
      if (!blob) throw new Error('The original file is missing from local storage.');
      if (!live) return;
      const preview = await safeAttachmentPreview(blob, isPdf ? 'application/pdf' : previewImageMime(attachment?.mime ?? '', attachment?.name ?? ''));
      if (!preview) throw new Error('The file bytes do not match a supported preview type.');
      url = URL.createObjectURL(preview);
      setSourceBlob(preview); setSourceUrl(url);
      if (isPdf) {
        const pdfjs = await import('pdfjs-dist');
        if (!live) return;
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
        task = pdfjs.getDocument({ url });
        const loaded = await task.promise;
        if (live) { setPdfDocument(loaded); setPage((current) => Math.max(1, Math.min(current, loaded.numPages))); }
        else await task.destroy();
      }
    }).catch((caught) => { if (live) setError(caught instanceof Error ? caught.message : 'Could not open the OCR source.'); });
    return () => { live = false; if (task) void task.destroy(); if (url) URL.revokeObjectURL(url); };
  }, [attachmentId, repository, isPdf, attachment?.mime, attachment?.name]);
  useEffect(() => {
    if (!store || !attachmentId) return;
    let live = true;
    void store.list(attachmentId).then((items) => { if (live) setRecords(items); }).catch((caught) => { if (live) setError(caught instanceof Error ? caught.message : 'Could not load OCR text.'); });
    return () => { live = false; };
  }, [store, attachmentId]);

  const upload = async (file: File) => {
    if (!isOcrImage({ name: file.name, mime: file.type })) { setError('Choose a PNG, JPEG, WebP, GIF, BMP, or TIFF image.'); return; }
    if (file.size > MAX_IMAGE_BYTES) { setError('Choose an image smaller than 25 MiB.'); return; }
    setBusy(true); setError(null);
    try {
      const added = await workspace.addAttachment(workspace.selectedFolderId, file);
      if (!added) throw new Error('Could not save the original image.');
      setSourceBlob(null); setSourceUrl(null); setPdfDocument(null); setRecords([]); setDrafts(new Map()); setPage(1);
      setUploadedAttachment(added);
      setAttachmentId(added.id); setMessage('Original image saved locally. Run OCR when ready.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not upload image.'); }
    finally { setBusy(false); }
  };
  const run = async (allPages: boolean) => {
    if (!sourceBlob || !attachment || !languages.length || busy || isPdf && !pdfDocument) return;
    if (!isPdf && sourceBlob.size > MAX_IMAGE_BYTES) { setError('This image is larger than the 25 MiB local OCR limit.'); return; }
    if (allPages && pageCount > MAX_DOCUMENT_PAGES) { setError(`Scan up to ${MAX_DOCUMENT_PAGES} pages at once. Scan other pages individually.`); return; }
    const token = ++runRef.current;
    const targets = allPages ? Array.from({ length: pageCount }, (_, index) => index + 1) : [page];
    setBusy(true); setRunning(true); setError(null); setMessage(null); setProgress('Loading local OCR model…');
    let session: OcrSession | null = null;
    try {
      session = await provider.start(languages, ({ status, progress: amount }) => { if (token === runRef.current) setProgress(`${status} ${Math.round(amount * 100)}%`); });
      if (token !== runRef.current) return;
      sessionRef.current = session;
      for (const target of targets) {
        setProgress(`Recognizing page ${target} of ${pageCount}…`);
        const image = isPdf ? await renderPdfPage(pdfDocument!, target) : sourceBlob;
        const result = await session.recognize(image);
        if (token !== runRef.current) return;
        setDrafts((previous) => new Map(previous).set(target, { providerId: provider.id, languages: [...languages], detectedText: result.text, text: result.text, confidence: result.confidence }));
      }
      setPage(targets[0]!); setMessage(`OCR preview ready for ${targets.length} ${targets.length === 1 ? 'page' : 'pages'}. Review and save the text.`);
    } catch (caught) { if (token === runRef.current) setError(caught instanceof Error ? caught.message : 'OCR failed. The original file is unchanged.'); }
    finally {
      if (session) await session.close().catch(() => undefined);
      if (sessionRef.current === session) sessionRef.current = null;
      if (token === runRef.current) { setBusy(false); setRunning(false); setProgress(null); }
    }
  };
  const cancelRun = () => {
    runRef.current += 1;
    if (sessionRef.current) void sessionRef.current.close().catch(() => undefined);
    sessionRef.current = null;
    setBusy(false); setRunning(false); setProgress(null); setMessage('OCR canceled. Any previewed pages remain available to review.');
  };
  const saveDrafts = async () => {
    if (!store || !attachmentId || !drafts.size || busy) return;
    setBusy(true); setError(null); setMessage(null);
    let savedCount = 0;
    try {
      for (const [target, value] of [...drafts].sort(([a], [b]) => a - b)) {
        const current = records.find((item) => item.page === target);
        const next = await store.save(attachmentId, target, value, current?.updatedAt ?? null);
        setRecords((items) => [...items.filter((item) => item.page !== target), next].sort((a, b) => a.page - b.page));
        setDrafts((items) => { const copy = new Map(items); copy.delete(target); return copy; });
        savedCount += 1;
      }
      onSaved(); setMessage(`${savedCount} ${savedCount === 1 ? 'page' : 'pages'} saved and ready for search.`);
    } catch (caught) {
      if (savedCount) onSaved();
      setError(`${savedCount} pages saved. ${caught instanceof Error ? caught.message : 'Could not save remaining OCR text.'}`);
    } finally { setBusy(false); }
  };

  return <div ref={dialogRef} className={styles.backdrop} role="dialog" aria-modal="true" aria-label="Image and document OCR" onKeyDown={handleKeyDown}>
    <div className={styles.panel}>
      <header className={styles.header}><div><span className={styles.eyebrow}>NOOR NOTE OCR</span><h2>Extract text</h2><p>Review text before saving it beside the original file.</p></div><button ref={closeRef} type="button" aria-label="Close OCR" disabled={busy} onClick={onClose}><X size={20} /></button></header>
      <div className={styles.body}>
        <section className={styles.source} aria-label="Original file">
          <h3>Original</h3>
          <label className={styles.upload}><FilePlus2 size={18} /> Upload image<input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/tiff" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ''; }} /></label>
          {attachment ? <><strong className={styles.filename}>{attachment.name}</strong>{isPdf && pdfDocument ? <div className={styles.pageControls}><label>Page <input type="number" min={1} max={pageCount} value={page} disabled={busy} onChange={(event) => { const next = Number(event.target.value); if (Number.isInteger(next)) setPage(Math.max(1, Math.min(pageCount, next))); }} /></label><span>of {pageCount}</span></div> : null}
            {isPdf && pdfDocument ? <div className={styles.preview}><PdfPage document={pdfDocument} page={page} scale={.7} annotations={[]} activeAnnotationId={null} onSelection={() => undefined} /></div> : sourceUrl ? <div className={styles.preview}><Image src={sourceUrl} alt={`Original image: ${attachment.name}`} width={800} height={600} unoptimized className={styles.image} /></div> : <p>Loading original…</p>}
          </> : <p>Upload an image, or open a saved image or PDF from the file explorer.</p>}
        </section>
        <section className={styles.results} aria-label="OCR text review">
          <h3>Recognize</h3><p className={styles.help}>Runs on this device with local language models. Source files are not uploaded to an OCR service.</p>
          <fieldset className={styles.languages}><legend>Languages in the image</legend>{provider.languages.map((language) => <label key={language.code}><input type="checkbox" checked={languages.includes(language.code)} disabled={busy} onChange={(event) => setLanguages((current) => event.target.checked ? [...current, language.code] : current.filter((code) => code !== language.code))} /> {language.label}</label>)}</fieldset>
          <div className={styles.actions}><button type="button" disabled={busy || !attachment || !sourceBlob || !languages.length || isPdf && !pdfDocument} onClick={() => { void run(false); }}><ScanText size={17} /> Run OCR {isPdf ? 'on page' : ''}</button>{isPdf && <button type="button" disabled={busy || !pdfDocument || !languages.length || pageCount > MAX_DOCUMENT_PAGES} onClick={() => { void run(true); }}>Run on all pages</button>}{running && <button type="button" onClick={cancelRun}>Cancel OCR</button>}</div>
          {progress && <p role="status">{progress}</p>}{error && <p className={styles.error} role="alert">{error}</p>}{message && <p className={styles.message} role="status">{message}</p>}
          <label className={styles.textLabel}>Text for page {page}<textarea dir="auto" value={draft?.text ?? ''} disabled={!draft || busy} onChange={(event) => { const existing = draft; if (existing) setDrafts((current) => new Map(current).set(page, { ...existing, text: event.target.value })); }} placeholder="Run OCR to preview detected text, then correct it here." /></label>
          {draft && <details className={styles.detected}><summary>Original detected text</summary><pre dir="auto">{draft.detectedText || '(No text detected)'}</pre></details>}
          {draft && <p className={styles.help}>Detected with {draft.languages.join(' + ')}{draft.confidence !== null ? ` · confidence ${Math.round(draft.confidence)}%` : ''}. Corrections are saved separately from the detected text.</p>}
          {records.length > 0 && <div className={styles.savedPages}><strong>Saved pages</strong><div>{records.map((item) => <button key={item.id} type="button" aria-current={page === item.page ? 'page' : undefined} onClick={() => setPage(item.page)}>Page {item.page}</button>)}</div></div>}
          <button className={styles.save} type="button" disabled={!drafts.size || busy} onClick={() => { void saveDrafts(); }}>Save {drafts.size} {drafts.size === 1 ? 'page' : 'pages'} of OCR text</button>
        </section>
      </div>
    </div>
  </div>;
}
