import { createClient } from '@supabase/supabase-js';
import { headingSlug, parseOutline, prepareReadingMarkdown } from '@noor-note/core';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { z } from 'zod';
import type { ReactNode } from 'react';

const tokenPattern = /^[0-9a-f]{64}$/u;
const shareResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('unavailable') }),
  z.object({ status: z.literal('password_required') }),
  z.object({ status: z.literal('locked') }),
  z.object({ status: z.literal('ok'), id: z.uuid(), title: z.string(), markdown: z.string(), download_allowed: z.boolean(), expires_at: z.string().nullable(), session: z.string().nullable() }),
]);
type ShareResult = z.infer<typeof shareResultSchema>;

function escape(value: string): string { return value.replace(/[&<>"']/gu, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!); }
function plainText(value: ReactNode): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(plainText).join('');
  if (value && typeof value === 'object' && 'props' in value) return plainText((value as { props: { children?: ReactNode } }).props.children);
  return '';
}
function headers(type = 'text/html; charset=utf-8'): Record<string, string> {
  return {
    'Content-Type': type, 'Cache-Control': 'private, no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Strict-Transport-Security': 'max-age=31536000',
    'Content-Security-Policy': "default-src 'none'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  };
}
function document(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>${escape(title)} · Noor Note private share</title><link rel="stylesheet" href="/publish-katex.css"><link rel="stylesheet" href="/publish.css"><link rel="stylesheet" href="/private-share.css"></head><body><a class="skip" href="#content">Skip to content</a><header><div class="header-inner"><span class="site-title">Noor Note</span><span class="private-label">Private share</span></div></header><main id="content">${body}</main><footer>Shared privately with Noor Note</footer></body></html>`;
}
function unavailable(): Response {
  return new Response(document('Link unavailable', '<section class="share-state"><h1>Link unavailable</h1><p>This link has expired, been revoked, or does not exist.</p></section>'), { status: 404, headers: headers() });
}
function passwordPrompt(locked: boolean, incorrect: boolean): Response {
  const message = locked ? 'Too many attempts. Try again in 15 minutes.' : incorrect ? 'That password did not unlock this share.' : 'Enter the password supplied by the person who shared this note.';
  return new Response(document('Password required', `<section class="share-state"><h1>Password required</h1><p role="status">${message}</p><form method="post"><label for="share-password">Share password</label><input id="share-password" name="password" type="password" autocomplete="current-password" required maxlength="72" autofocus><button type="submit">Open note</button></form></section>`), { status: locked ? 429 : 200, headers: headers() });
}

function ShareMarkdown({ markdown }: { markdown: string }) {
  const counts = new Map<string, number>();
  const heading = (level: number, children: ReactNode) => {
    const base = headingSlug(plainText(children)) || 'heading';
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    const Element = `h${level}` as 'h1';
    return <Element id={count ? `${base}-${count}` : base}>{children}</Element>;
  };
  return <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex, rehypeHighlight]} skipHtml components={{
    h1: ({ children }) => heading(1, children), h2: ({ children }) => heading(2, children), h3: ({ children }) => heading(3, children),
    h4: ({ children }) => heading(4, children), h5: ({ children }) => heading(5, children), h6: ({ children }) => heading(6, children),
    img: ({ alt }) => <span className="unavailable">[Image not included in this share: {alt || 'image'}]</span>,
    a: ({ href, children }) => {
      const destination = typeof href === 'string' ? href : '';
      if (destination === '#noor-highlight') return <mark>{children}</mark>;
      if (destination.startsWith('#noor-wiki-') || destination.startsWith('#noor-embed-') || /\.md(?:#|$)/iu.test(destination) || destination.startsWith('noor-note://')) return <span className="unavailable" title="Linked notes are not shared">{children}</span>;
      if (/^#[a-z0-9_-]+$/iu.test(destination)) return <a href={destination}>{children}</a>;
      if (/^(https:\/\/|http:\/\/|mailto:)/iu.test(destination)) return <a href={destination} rel="noopener noreferrer">{children}</a>;
      return <span>{children}</span>;
    },
  }}>{prepareReadingMarkdown(markdown)}</ReactMarkdown>;
}

export function renderPrivateShare(title: string, markdown: string, downloadAllowed: boolean, token: string, expiresAt: string | null): string {
  const outline = parseOutline(markdown);
  const toc = outline.length ? `<nav class="toc" aria-label="Table of contents"><strong>On this page</strong><ol>${outline.map((heading) => `<li><a href="#${encodeURIComponent(heading.id)}">${escape(heading.text)}</a></li>`).join('')}</ol></nav>` : '';
  const expiry = expiresAt ? `<p class="expiry">Available until ${escape(new Date(expiresAt).toLocaleString('en-US', { timeZone: 'UTC', timeZoneName: 'short' }))}</p>` : '';
  return document(title, `<article><div class="share-meta"><span>View only</span>${downloadAllowed ? `<a href="/s/${token}/download">Download Markdown</a>` : '<span>Downloads disabled</span>'}</div><h1 class="page-title">${escape(title)}</h1>${expiry}${toc}<div class="markdown">${renderToStaticMarkup(<ShareMarkdown markdown={markdown} />)}</div></article>`);
}

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const segments = url.pathname.split('/').filter(Boolean);
  const token = segments[1];
  const downloading = segments[2] === 'download' && segments.length === 3;
  if (segments[0] !== 's' || !token || !tokenPattern.test(token) || (segments.length !== 2 && !downloading)) return unavailable();
  if ((request.method !== 'GET' && request.method !== 'POST') || (downloading && request.method !== 'GET')) return new Response('Method not allowed', { status: 405, headers: headers('text/plain; charset=utf-8') });
  if (request.method === 'POST') {
    if (request.headers.get('origin') !== url.origin) return new Response('Forbidden', { status: 403, headers: headers('text/plain; charset=utf-8') });
    if (Number(request.headers.get('content-length') ?? 0) > 8192) return new Response('Request too large', { status: 413, headers: headers('text/plain; charset=utf-8') });
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !key) return new Response('Private shares are not configured.', { status: 503, headers: headers('text/plain; charset=utf-8') });
  try {
    let password: string | null = null;
    if (request.method === 'POST') {
      if (!(request.headers.get('content-type') ?? '').startsWith('application/x-www-form-urlencoded')) return new Response('Unsupported form', { status: 415, headers: headers('text/plain; charset=utf-8') });
      const body = await request.text();
      if (body.length > 8192) return new Response('Request too large', { status: 413, headers: headers('text/plain; charset=utf-8') });
      password = (new URLSearchParams(body).get('password') ?? '').slice(0, 1024);
    }
    const cookie = request.headers.get('cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith('noor_share_session='))?.slice('noor_share_session='.length) ?? null;
    const client = createClient(supabaseUrl, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const result = await client.rpc('noor_open_private_share', { p_token: token, p_password: password, p_session: cookie });
    if (result.error) throw result.error;
    const share: ShareResult = shareResultSchema.parse(result.data);
    if (share.status === 'unavailable') return unavailable();
    if (share.status === 'password_required' || share.status === 'locked') return passwordPrompt(share.status === 'locked', request.method === 'POST');
    if (downloading) {
      if (!share.download_allowed) return unavailable();
      const filename = `${share.title.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '').slice(0, 80) || 'note'}.md`;
      return new Response(share.markdown, { headers: { ...headers('text/markdown; charset=utf-8'), 'Content-Disposition': `attachment; filename="${filename}"` } });
    }
    const responseHeaders = new Headers(headers());
    if (share.session) responseHeaders.set('Set-Cookie', `noor_share_session=${share.session}; Path=/s/${token}; Max-Age=43200; HttpOnly; SameSite=Lax${url.protocol === 'https:' ? '; Secure' : ''}`);
    if (request.method === 'POST') {
      responseHeaders.set('Location', url.pathname);
      return new Response(null, { status: 303, headers: responseHeaders });
    }
    return new Response(renderPrivateShare(share.title, share.markdown, share.download_allowed, token, share.expires_at), { headers: responseHeaders });
  } catch (error) {
    console.error('Noor Note private share request failed', error instanceof Error ? error.name : 'unknown error');
    return new Response(document('Temporarily unavailable', '<section class="share-state"><h1>Temporarily unavailable</h1><p>Please try again later.</p></section>'), { status: 503, headers: headers() });
  }
}

export const config = { path: '/s/*' };
