import { createClient } from '@supabase/supabase-js';
import { headingSlug, parseOutline, prepareReadingMarkdown, resolveVaultReference } from '@noor-note/core';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { pageSchema, publicHref, publicMarkdownTarget, publicWikiTarget, outgoingPublicLinks, siteSchema, slugSchema, type PublicPage, type PublicSite } from '../../src/lib/publishing';
import { safeAttachmentPreview } from '../../src/lib/safe-attachment-preview';
import type { ReactNode } from 'react';

const bucket = 'noor-note-published';
const safeImageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const functionHeaders = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Strict-Transport-Security': 'max-age=31536000',
};

function response(body: string, status = 200, type = 'text/html; charset=utf-8'): Response {
  return new Response(body, { status, headers: {
    ...functionHeaders,
    'Content-Type': type, 'Cache-Control': 'no-store, max-age=0',
    'Content-Security-Policy': "default-src 'none'; img-src 'self' https: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  } });
}
function notFound(): Response { return response('<!doctype html><title>Page unavailable · Noor Note</title><main><h1>Page unavailable</h1><p>This page is not published.</p></main>', 404); }
function text(children: ReactNode): string {
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(text).join('');
  if (children && typeof children === 'object' && 'props' in children) return text((children as { props: { children?: ReactNode } }).props.children);
  return '';
}
function escape(value: string): string { return value.replace(/[&<>"']/gu, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!); }
function assetUrl(site: PublicSite, page: PublicPage, assetId: string): string { return `/p/${site.slug}/${page.slug}/asset/${assetId}`; }

function Markdown({ site, page, pages }: { site: PublicSite; page: PublicPage; pages: PublicPage[] }) {
  const headings = new Map<string, number>();
  const wikiTargets: Array<{ page: PublicPage; fragment: string | null } | null> = [];
  const display = prepareReadingMarkdown(page.markdown).replace(/\]\(#noor-wiki-([^)]*)\)/gu, (_match, encoded: string) => {
    const index = wikiTargets.push(publicWikiTarget(`#noor-wiki-${encoded}`, page, pages)) - 1;
    return `](#noor-public-wiki-${index})`;
  });
  const heading = (level: number, children: ReactNode) => {
    const base = headingSlug(text(children)) || 'heading';
    const count = headings.get(base) ?? 0;
    headings.set(base, count + 1);
    const id = count ? `${base}-${count}` : base;
    const Element = `h${level}` as 'h1';
    return <Element id={id}>{children}</Element>;
  };
  const paragraph = (children: ReactNode) => {
    const found = text(children).match(/(?:^|\s)\^([A-Za-z0-9][A-Za-z0-9_-]{0,100})\s*$/u);
    if (!found) return <p>{children}</p>;
    if (typeof children === 'string') return <p id={found[1]}>{children.replace(/\s*\^[A-Za-z0-9][A-Za-z0-9_-]{0,100}\s*$/u, '')}</p>;
    if (Array.isArray(children)) {
      const parts = [...children];
      const last = parts.at(-1);
      if (typeof last === 'string') parts[parts.length - 1] = last.replace(/\s*\^[A-Za-z0-9][A-Za-z0-9_-]{0,100}\s*$/u, '');
      return <p id={found[1]}>{parts}</p>;
    }
    return <p id={found[1]}>{children}</p>;
  };
  return <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex, rehypeHighlight]} skipHtml components={{
    p: ({ children }) => paragraph(children),
    h1: ({ children }) => heading(1, children), h2: ({ children }) => heading(2, children), h3: ({ children }) => heading(3, children),
    h4: ({ children }) => heading(4, children), h5: ({ children }) => heading(5, children), h6: ({ children }) => heading(6, children),
    code: ({ className, children }) => className?.includes('language-mermaid') ? <pre className="mermaid" data-diagram="true">{String(children).replace(/\n$/u, '')}</pre> : <code className={className}>{children}</code>,
    img: ({ src, alt }) => {
      const source = typeof src === 'string' ? src : '';
      const resolved = resolveVaultReference(page.source_path, source);
      const assetId = resolved ? page.assets[resolved] : undefined;
      if (assetId) return <img src={assetUrl(site, page, assetId)} alt={alt ?? ''} loading="lazy" />;
      if (/^https:\/\//iu.test(source)) return <img src={source} alt={alt ?? ''} loading="lazy" />;
      return <span className="unavailable">[Image unavailable: {alt || source}]</span>;
    },
    a: ({ href, children }) => {
      const destination = typeof href === 'string' ? href : '';
      if (destination === '#noor-highlight') return <mark>{children}</mark>;
      if (destination.startsWith('#noor-public-wiki-')) {
        const index = Number(destination.slice('#noor-public-wiki-'.length));
        const target = wikiTargets[index];
        return target ? <a href={publicHref(site.slug, target.page.slug, target.fragment)}>{children}</a> : <span className="unavailable" title="This note is not published">{children}</span>;
      }
      const target = publicMarkdownTarget(destination, page, pages);
      if (target) return <a href={publicHref(site.slug, target.page.slug, target.fragment)}>{children}</a>;
      if (destination.startsWith('#noor-wiki-') || /\.md(?:#|$)/iu.test(destination) || destination.startsWith('noor-note://')) return <span className="unavailable" title="This note is not published">{children}</span>;
      if (destination.startsWith('#') && /^#[a-z0-9_-]+$/iu.test(destination)) return <a href={destination}>{children}</a>;
      if (/^(https:\/\/|http:\/\/|mailto:)/iu.test(destination)) return <a href={destination} rel="noopener noreferrer">{children}</a>;
      return <span>{children}</span>;
    },
  }}>{display}</ReactMarkdown>;
}

function graph(site: PublicSite, pages: PublicPage[]): string {
  if (!site.graph_enabled) return '';
  const shown = pages.slice(0, 120);
  const points = new Map(shown.map((page, index) => [page.note_id, {
    x: 400 + 330 * Math.cos((index * 2 * Math.PI) / shown.length),
    y: 400 + 330 * Math.sin((index * 2 * Math.PI) / shown.length),
  }]));
  const edges = shown.flatMap((page) => outgoingPublicLinks(page, shown).map((target) => [page.note_id, target.note_id] as const));
  return `<section class="graph"><h1>Public graph</h1><p>Only published pages and links between them appear here.</p><svg viewBox="0 0 800 800" role="img" aria-label="Graph of ${shown.length} published pages">${edges.map(([from, to]) => { const a = points.get(from)!, b = points.get(to)!; return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" />`; }).join('')}${shown.map((page) => { const point = points.get(page.note_id)!; return `<a href="${publicHref(site.slug, page.slug)}"><circle cx="${point.x}" cy="${point.y}" r="9"/><title>${escape(page.title)}</title></a>`; }).join('')}</svg><ul>${shown.map((page) => `<li><a href="${publicHref(site.slug, page.slug)}">${escape(page.title)}</a></li>`).join('')}</ul></section>`;
}

export function renderPublicHtml(request: Request, site: PublicSite, page: PublicPage | null, pages: PublicPage[], showGraph: boolean): string {
  const origin = new URL(request.url).origin;
  const home = `/p/${site.slug}`;
  const currentUrl = `${origin}${page ? publicHref(site.slug, page.slug) : showGraph ? `${home}/graph` : home}`;
  const title = page ? `${page.title} · ${site.title}` : site.title;
  const description = page?.description || site.description || `Published with Noor Note`;
  const visibleNav = site.navigation.map((slug) => pages.find((item) => item.slug === slug)).filter((item): item is PublicPage => Boolean(item));
  const outline = page ? parseOutline(page.markdown) : [];
  const backlinks = page ? pages.filter((source) => source.note_id !== page.note_id && outgoingPublicLinks(source, pages).some((target) => target.note_id === page.note_id)) : [];
  const body = showGraph ? graph(site, pages) : page ? `<article><h1 class="page-title">${escape(page.title)}</h1>${outline.length ? `<nav class="toc" aria-label="Table of contents"><strong>On this page</strong><ol>${outline.map((heading) => `<li><a href="#${encodeURIComponent(heading.id)}">${escape(heading.text)}</a></li>`).join('')}</ol></nav>` : ''}<div class="markdown">${renderToStaticMarkup(<Markdown site={site} page={page} pages={pages} />)}</div>${backlinks.length ? `<aside class="backlinks"><h2>Linked from</h2><ul>${backlinks.map((source) => `<li><a href="${publicHref(site.slug, source.slug)}">${escape(source.title)}</a></li>`).join('')}</ul></aside>` : ''}</article>` : `<section class="home"><h1>${escape(site.title)}</h1><p>${escape(site.description)}</p><ul>${pages.map((item) => `<li><a href="${publicHref(site.slug, item.slug)}">${escape(item.title)}</a>${item.description ? `<p>${escape(item.description)}</p>` : ''}</li>`).join('')}</ul></section>`;
  const theme = site.theme === 'system' ? '' : ` data-theme="${site.theme}"`;
  return `<!doctype html><html lang="en"${theme}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><meta name="description" content="${escape(description)}"><meta name="robots" content="${site.robots === 'index' ? 'index,follow' : 'noindex,nofollow'}"><link rel="canonical" href="${escape(currentUrl)}"><meta property="og:type" content="article"><meta property="og:site_name" content="${escape(site.title)}"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta property="og:url" content="${escape(currentUrl)}">${site.logo_path ? `<meta property="og:image" content="${origin}${home}/brand/logo">` : ''}${site.favicon_path ? `<link rel="icon" href="${home}/brand/favicon">` : ''}<link rel="stylesheet" href="/publish-katex.css"><link rel="stylesheet" href="/publish.css"></head><body><a class="skip" href="#content">Skip to content</a><header><div class="header-inner"><a class="site-title" href="${home}">${site.logo_path ? `<img src="${home}/brand/logo" alt=""/>` : ''}${escape(site.title)}</a><nav aria-label="Site navigation">${visibleNav.map((item) => `<a href="${publicHref(site.slug, item.slug)}">${escape(item.title)}</a>`).join('')}${site.graph_enabled ? `<a href="${home}/graph">Graph</a>` : ''}</nav><button id="theme-toggle" type="button" aria-label="Toggle color theme">◐</button></div></header><main id="content">${body}</main><footer>Published with <a href="/">Noor Note</a></footer><script src="/publish-mermaid.js" defer></script></body></html>`;
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return response('Method not allowed', 405, 'text/plain');
  const segments = new URL(request.url).pathname.split('/').filter(Boolean);
  if (segments[0] !== 'p' || !slugSchema.max(80).safeParse(segments[1]).success || segments.length > 5) return notFound();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return response('Public publishing is not configured.', 503, 'text/plain');
  try {
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const siteResult = await client.from('noor_public_sites').select('*').eq('slug', segments[1]!).maybeSingle();
    if (siteResult.error) throw siteResult.error;
    if (!siteResult.data) return notFound();
    const site = siteSchema.parse(siteResult.data);
    if (segments[2] === 'brand' && segments.length === 4) {
      const path = segments[3] === 'logo' ? site.logo_path : segments[3] === 'favicon' ? site.favicon_path : null;
      if (!path) return notFound();
      const result = await client.storage.from(bucket).download(path);
      if (result.error || !result.data) return notFound();
      if (!safeImageTypes.has(result.data.type)) return notFound();
      const image = await safeAttachmentPreview(result.data, result.data.type);
      if (!image) return notFound();
      return new Response(image, { headers: { ...functionHeaders, 'Content-Type': image.type, 'Cache-Control': 'no-store' } });
    }
    if (segments.length >= 3 && segments[2] !== 'graph' && !slugSchema.safeParse(segments[2]).success) return notFound();
    const pages: PublicPage[] = [];
    for (let offset = 0; ; offset += 500) {
      const result = await client.from('noor_public_pages').select('*').eq('vault_id', site.vault_id).order('slug').range(offset, offset + 499);
      if (result.error) throw result.error;
      const chunk = pageSchema.array().parse(result.data);
      pages.push(...chunk);
      if (chunk.length < 500) break;
    }
    if (segments[3] === 'asset' && segments.length === 5 && uuid.test(segments[4] ?? '')) {
      const page = pages.find((item) => item.slug === segments[2]);
      if (!page || !Object.values(page.assets).includes(segments[4]!)) return notFound();
      const result = await client.storage.from(bucket).download(`${site.vault_id}/${page.note_id}/${segments[4]}`);
      if (result.error || !result.data) return notFound();
      if (!safeImageTypes.has(result.data.type)) return notFound();
      const image = await safeAttachmentPreview(result.data, result.data.type);
      if (!image) return notFound();
      return new Response(image, { headers: { ...functionHeaders, 'Content-Type': image.type, 'Cache-Control': 'no-store' } });
    }
    if (segments.length > 3) return notFound();
    const showGraph = segments[2] === 'graph';
    if (showGraph && !site.graph_enabled) return notFound();
    const page = segments[2] && !showGraph ? pages.find((item) => item.slug === segments[2]) ?? null : pages.find((item) => item.slug === site.homepage_slug) ?? null;
    if (segments[2] && !showGraph && !page) return notFound();
    return response(renderPublicHtml(request, site, page, pages, showGraph));
  } catch (error) {
    console.error('Noor Note public publishing request failed', error);
    return response('<!doctype html><title>Temporarily unavailable · Noor Note</title><h1>Page temporarily unavailable</h1>', 503);
  }
}

export const config = { path: '/p/*' };
