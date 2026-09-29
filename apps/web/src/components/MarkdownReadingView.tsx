'use client';

import { expandNoteEmbeds, headingSlug, parseInternalLinks, parseOutline, parsePdfReference, parseWikiReference, pathKey, prepareReadingMarkdown, resolveLinkTarget, resolvePdfAttachment, resolveVaultReference, type Attachment, type VaultNote } from '@noor-note/core';
import type { NoteEntry, VaultRepository } from '@noor-note/storage';
import Image from 'next/image';
import { isValidElement, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import styles from './MarkdownReadingView.module.css';

function MermaidDiagram({ source }: { source: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (source.length > 50_000) { const timer = window.setTimeout(() => setError(true), 0); return () => window.clearTimeout(timer); }
    let live = true;
    let objectUrl: string | null = null;
    void import('mermaid').then(async ({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', maxTextSize: 50_000 });
      const result = await mermaid.render(`noor-mermaid-${crypto.randomUUID().replaceAll('-', '')}`, source);
      objectUrl = URL.createObjectURL(new Blob([result.svg], { type: 'image/svg+xml' }));
      if (live) setUrl(objectUrl);
      else URL.revokeObjectURL(objectUrl);
    }).catch(() => { if (live) setError(true); });
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [source]);
  if (error) return <pre className={styles.diagramError}>Could not render this Mermaid diagram. Its source remains in the note.</pre>;
  return url ? <Image src={url} alt="Mermaid diagram" width={900} height={500} unoptimized className={styles.diagram} /> : <p>Rendering diagram…</p>;
}

function headingText(children: ReactNode): string {
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(headingText).join('');
  if (isValidElement(children)) return headingText((children as ReactElement<{ children?: ReactNode }>).props.children);
  return '';
}

interface Props {
  note: VaultNote;
  notes: NoteEntry[];
  attachments: Attachment[];
  repository: VaultRepository | null;
  onOpenNote: (id: string, fragment?: string) => void;
  onOpenPdf?: (attachmentId: string, page: number, annotationId: string | null) => void;
  onCreateMissing?: (target: string) => void;
  onActiveHeading?: (id: string) => void;
}

export function MarkdownReadingView({ note, notes, attachments, repository, onOpenNote, onOpenPdf, onCreateMissing, onActiveHeading }: Props) {
  const [attachmentUrls, setAttachmentUrls] = useState<Map<string, string>>(new Map());
  const [embeds, setEmbeds] = useState<Map<string, string>>(new Map());
  const outline = useMemo(() => parseOutline(note.markdown), [note.markdown]);
  const display = useMemo(() => prepareReadingMarkdown(expandNoteEmbeds(note.markdown, embeds)), [embeds, note.markdown]);

  useEffect(() => {
    if (!repository) return;
    let live = true;
    const references = parseInternalLinks(note.markdown).filter((item) => item.kind === 'embed' && !/\.(?:png|jpe?g|gif|webp|svg|avif)$/iu.test(item.target));
    void Promise.all(references.map(async (reference) => {
      const entry = resolveLinkTarget(reference, { id: note.id, path: note.path }, notes);
      const body = entry ? await repository.getNote(entry.id) : null;
      const raw = reference.raw.match(/^!\[\[([^\]]+)\]\]/u)?.[1];
      return body && raw ? [raw, body.markdown] as const : null;
    })).then((pairs) => { if (live) setEmbeds(new Map(pairs.filter((pair): pair is readonly [string, string] => pair !== null))); }).catch(() => undefined);
    return () => { live = false; };
  }, [note.id, note.markdown, note.path, notes, repository]);

  useEffect(() => {
    if (!repository) return;
    let live = true;
    const urls: string[] = [];
    const referenced = new Set(Array.from(display.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/gu), (match) => {
      const resolved = resolveVaultReference(note.path, match[1] ?? '');
      return resolved ? pathKey(resolved) : '';
    }));
    void Promise.all(attachments.filter((item) => item.mime.startsWith('image/') && referenced.has(pathKey(item.path))).map(async (item) => {
      const blob = await repository.getAttachmentBlob(item.id);
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      urls.push(url);
      return [pathKey(item.path), url] as const;
    })).then((pairs) => { if (live) setAttachmentUrls(new Map(pairs.filter((pair): pair is readonly [string, string] => pair !== null))); }).catch(() => undefined);
    return () => { live = false; urls.forEach((url) => URL.revokeObjectURL(url)); };
  }, [attachments, display, note.path, repository]);

  useEffect(() => {
    if (!onActiveHeading) return;
    const root = document.getElementById(`reading-${note.id}`);
    if (!root) return;
    const headings = Array.from(root.querySelectorAll<HTMLElement>('h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]'));
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible) onActiveHeading(visible.target.id);
    }, { root: root.closest('.document-scroll'), rootMargin: '0px 0px -65% 0px' });
    headings.forEach((heading) => observer.observe(heading));
    return () => observer.disconnect();
  }, [display, note.id, onActiveHeading]);

  const headingIds = new Map<string, number>();
  const heading = (level: number, children: React.ReactNode) => {
    const text = headingText(children);
    const base = headingSlug(text) || 'heading';
    const count = headingIds.get(base) ?? 0;
    headingIds.set(base, count + 1);
    const id = count ? `${base}-${count}` : base;
    const Heading = `h${level}` as 'h1';
    return <Heading id={id}>{children}</Heading>;
  };
  const resolveUrl = (source: string) => {
    const path = resolveVaultReference(note.path, source);
    return path ? attachmentUrls.get(pathKey(path)) : undefined;
  };
  return <div id={`reading-${note.id}`} className={`markdown-preview ${styles.reading}`} aria-label="Rendered Markdown preview">
    {display.trim() ? <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex, rehypeHighlight]} skipHtml components={{
      h1: ({ children }) => heading(1, children), h2: ({ children }) => heading(2, children), h3: ({ children }) => heading(3, children),
      h4: ({ children }) => heading(4, children), h5: ({ children }) => heading(5, children), h6: ({ children }) => heading(6, children),
      code: ({ className, children }) => className?.includes('language-mermaid') ? <MermaidDiagram source={String(children).replace(/\n$/u, '')} /> : <code className={className}>{children}</code>,
      img: ({ src, alt }) => {
        const source = typeof src === 'string' ? src : '';
        if (source.startsWith('#noor-embed-')) return <span className={styles.embedFallback}>Embedded note: {alt}</span>;
        const url = resolveUrl(source);
        return url ? <Image src={url} alt={alt ?? ''} width={640} height={360} unoptimized style={{ maxWidth: '100%', width: 'auto', height: 'auto' }} /> : <span role="img" aria-label={alt || 'Image unavailable'}>[Image unavailable: {alt || source}]</span>;
      },
      a: ({ href, children }) => {
        const destination = typeof href === 'string' ? href : '';
        if (destination === '#noor-highlight') return <mark>{children}</mark>;
        const pdfReference = parsePdfReference(destination);
        if (pdfReference) {
          const pdf = resolvePdfAttachment(pdfReference, note.path, attachments);
          if (pdf && onOpenPdf) return <button type="button" className={styles.wiki} onClick={() => onOpenPdf(pdf.id, pdfReference.page, pdfReference.annotationId)}>{children}</button>;
        }
        if (destination.startsWith('#noor-wiki-')) {
          const encoded = destination.slice('#noor-wiki-'.length);
          const [raw, stableId] = encoded.split('&noor-id=', 2);
          const reference = parseWikiReference(decodeURIComponent(raw ?? ''));
          const entry = reference ? resolveLinkTarget({ target: reference.target, targetId: stableId ?? null }, note, notes) : null;
          return entry ? <button type="button" className={styles.wiki} onClick={() => onOpenNote(entry.id, reference?.heading ?? reference?.blockId ?? undefined)}>{children}</button> : onCreateMissing && reference ? <button type="button" className={styles.unresolvedButton} title={`Create ${reference.target}`} onClick={() => onCreateMissing(reference.target)}>{children} <span>(create note)</span></button> : <span className={styles.unresolved} title="Note not found">{children}</span>;
        }
        if (destination.startsWith('#') || /\.md(?:#|$)/iu.test(destination)) {
          const [target, fragment] = destination.split('#', 2);
          const entry = resolveLinkTarget({ target: target ? resolveVaultReference(note.path, target) ?? target : '', targetId: null }, note, notes);
          if (entry) return <button type="button" className={styles.wiki} onClick={() => onOpenNote(entry.id, fragment || undefined)}>{children}</button>;
          if (onCreateMissing && target) return <button type="button" className={styles.unresolvedButton} onClick={() => onCreateMissing(target.replace(/\.md$/iu, ''))}>{children} <span>(create note)</span></button>;
        }
        const url = resolveUrl(destination);
        return <a href={url ?? destination} target="_blank" rel="noopener noreferrer">{children}</a>;
      },
    }}>{display}</ReactMarkdown> : <p className="preview-empty">Nothing to preview yet. Switch to Source to add content.</p>}
    {outline.length > 0 && <span className="sr-only">{outline.length} headings in this document</span>}
  </div>;
}
