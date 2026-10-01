import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { webClipSchema, type ClipMode, type WebClip } from '@noor-note/core';

interface CaptureRequest { kind: 'noor-note-capture'; mode: ClipMode; imageUrl?: string; highlights?: WebClip['highlights'] }
const noise = 'script,style,noscript,iframe,form,nav,footer,[role="navigation"],[role="banner"],[role="contentinfo"],.advertisement,.ads,.cookie-banner,.cookie-consent,.related-posts,.related-articles';
const meta = (doc: Document, key: string): string | null => doc.querySelector<HTMLMetaElement>(`meta[property="${key}"],meta[name="${key}"]`)?.content.trim() || null;
const optionalText = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;
const first = (value: unknown): unknown => Array.isArray(value) ? value[0] : value;
const asRecord = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
function safeUrl(value: string | null | undefined, base: string): string | null {
  if (!value) return null;
  try { const url = new URL(value, base); return /^https?:$/u.test(url.protocol) ? url.href : null; }
  catch { return null; }
}
function schemaMetadata(doc: Document): { type: string | null; author: string | null; date: string | null; image: string | null; description: string | null } {
  const result = { type: null as string | null, author: null as string | null, date: null as string | null, image: null as string | null, description: null as string | null };
  for (const script of [...doc.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]')].slice(0, 10)) {
    if ((script.textContent?.length ?? 0) > 100_000) continue;
    try {
      const parsed: unknown = JSON.parse(script.textContent ?? '');
      const records = Array.isArray(parsed) ? parsed : [parsed];
      const nested = records.flatMap((item) => {
        const record = asRecord(item);
        return record && Array.isArray(record['@graph']) ? record['@graph'] : [item];
      });
      for (const item of nested) {
        const record = asRecord(item);
        if (!record) continue;
        const type = optionalText(first(record['@type']));
        if (!type || !/(?:article|posting|news|blog|webpage)/iu.test(type)) continue;
        const author = asRecord(first(record.author));
        result.type = type;
        result.author = optionalText(author?.name) ?? optionalText(first(record.author));
        result.date = optionalText(record.datePublished);
        const image = asRecord(first(record.image));
        result.image = optionalText(image?.url) ?? optionalText(first(record.image));
        result.description = optionalText(record.description);
        return result;
      }
    } catch { /* Ignore malformed page metadata. */ }
  }
  return result;
}
function clean(doc: Document, base: string): Document {
  const copy = doc.cloneNode(true) as Document;
  copy.querySelectorAll(noise).forEach((node) => node.remove());
  copy.querySelectorAll<HTMLElement>('[hidden],[aria-hidden="true"]').forEach((node) => node.remove());
  copy.querySelectorAll<HTMLElement>('[href],[src]').forEach((node) => {
    for (const attr of ['href', 'src'] as const) {
      const raw = node.getAttribute(attr);
      if (!raw) continue;
      const url = safeUrl(raw, base);
      if (url) node.setAttribute(attr, url); else node.removeAttribute(attr);
    }
  });
  return copy;
}
function articleMarkdown(doc: Document, base: string): { markdown: string; image: string | null; byline: string | null; excerpt: string | null } {
  const cleaned = clean(doc, base);
  const parsed = new Readability(cleaned, { charThreshold: 100 }).parse();
  const fallback = cleaned.querySelector('article,main,[role="main"]') ?? cleaned.body;
  const html = parsed?.content || fallback?.innerHTML || '';
  const container = new DOMParser().parseFromString(html, 'text/html');
  container.querySelectorAll('script,style,iframe,form,svg').forEach((node) => node.remove());
  container.querySelectorAll<HTMLElement>('[href],[src]').forEach((node) => {
    for (const attr of ['href', 'src'] as const) {
      const raw = node.getAttribute(attr);
      if (!raw) continue;
      const url = safeUrl(raw, base);
      if (url) node.setAttribute(attr, url); else node.removeAttribute(attr);
    }
  });
  const turndown = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced' });
  turndown.use(gfm);
  return { markdown: turndown.turndown(container.body).trim().slice(0, 500_000), image: safeUrl(container.querySelector<HTMLImageElement>('img')?.src, base), byline: parsed?.byline ?? null, excerpt: parsed?.excerpt ?? null };
}

export function extractPage(doc: Document, pageUrl: string, request: Omit<CaptureRequest, 'kind'>): WebClip {
  const url = safeUrl(pageUrl, pageUrl);
  if (!url) throw new Error('Only HTTP(S) pages can be clipped.');
  const schema = schemaMetadata(doc);
  const article = request.mode === 'article' ? articleMarkdown(doc, url) : null;
  const selected = doc.getSelection?.()?.toString().trim() ?? '';
  const highlights = request.highlights ?? [];
  if ((request.mode === 'selection' || request.mode === 'highlight') && !selected) throw new Error('Select text on the page first.');
  if (request.mode === 'highlights' && !highlights.length) throw new Error('Add highlights from the page context menu first.');
  const title = (meta(doc, 'og:title') || doc.title || 'Untitled page').slice(0, 300);
  const mainImage = safeUrl(meta(doc, 'og:image') || meta(doc, 'twitter:image') || article?.image || schema.image, url);
  const icon = doc.querySelector<HTMLLinkElement>('link[rel~="icon"]')?.href;
  return webClipSchema.parse({
    version: 1, mode: request.mode, url, title,
    author: (meta(doc, 'author') || meta(doc, 'article:author') || schema.author || article?.byline || null)?.slice(0, 300) ?? null,
    publishedAt: (meta(doc, 'article:published_time') || schema.date || null)?.slice(0, 100) ?? null,
    site: (meta(doc, 'og:site_name') || new URL(url).hostname).slice(0, 200),
    description: (meta(doc, 'description') || meta(doc, 'og:description') || schema.description || article?.excerpt || null)?.slice(0, 2000) ?? null,
    language: (doc.documentElement.lang || meta(doc, 'og:locale') || null)?.slice(0, 50) ?? null,
    mainImage, favicon: safeUrl(icon || '/favicon.ico', url), schemaType: schema.type?.slice(0, 120) ?? null,
    markdown: request.mode === 'article' ? article?.markdown ?? '' : request.mode === 'selection' || request.mode === 'highlight' ? selected.slice(0, 500_000) : '',
    imageUrl: request.mode === 'image' ? safeUrl(request.imageUrl || mainImage, url) : null,
    highlights: request.mode === 'highlight' ? [{ id: crypto.randomUUID(), text: selected.slice(0, 10_000), capturedAt: new Date().toISOString() }] : highlights,
    screenshotDataUrl: null, capturedAt: new Date().toISOString(),
  });
}

const globalCapture = globalThis as typeof globalThis & { __noorNoteCaptureInstalled?: boolean };
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage && !globalCapture.__noorNoteCaptureInstalled) {
  globalCapture.__noorNoteCaptureInstalled = true;
  chrome.runtime.onMessage.addListener((message: unknown, _sender, respond) => {
    const request = asRecord(message);
    if (request?.kind !== 'noor-note-capture') return;
    try { respond({ ok: true, clip: extractPage(document, location.href, request as unknown as CaptureRequest) }); }
    catch (error) { respond({ ok: false, error: error instanceof Error ? error.message : 'Capture failed.' }); }
  });
}
