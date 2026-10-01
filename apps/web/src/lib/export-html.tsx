import { parseWikiReference, prepareReadingMarkdown, resolveVaultReference, type Attachment, type VaultNote } from '@noor-note/core';
import type { VaultRepository } from '@noor-note/storage';
import ReactMarkdown from 'react-markdown';
import { renderToStaticMarkup } from 'react-dom/server';
import remarkGfm from 'remark-gfm';

const rasterMime = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);
const MAX_INLINE_IMAGE = 5 * 1024 * 1024;

function escapeHtml(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'); }
function key(path: string): string { return path.normalize('NFKC').toLocaleLowerCase(); }
function base64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let index = 0; index < bytes.length; index += 24_576) chunks.push(btoa(String.fromCharCode(...bytes.subarray(index, index + 24_576))));
  return chunks.join('');
}

/** Creates a self-contained, inert HTML rendering; the original Markdown is embedded as escaped text. */
export async function renderExportHtml(note: VaultNote, attachments: readonly Attachment[], repository: VaultRepository, printView = false): Promise<{ html: string; warnings: string[] }> {
  const warnings: string[] = [];
  const images = new Map<string, string>();
  const byPath = new Map(attachments.map((item) => [key(item.path), item]));
  const referenced = new Set<string>();
  for (const match of note.markdown.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)|!\[\[([^\]\n]+)\]\]/gu)) {
    const target = match[2] ? parseWikiReference(match[2], true)?.target : match[1];
    const path = resolveVaultReference(note.path, target ?? '');
    if (path) referenced.add(key(path));
  }
  for (const path of referenced) {
    const item = byPath.get(path);
    if (!item) { warnings.push(`Referenced image is missing: ${path}`); continue; }
    if (!rasterMime.has(item.mime)) { warnings.push(`Image was not embedded because its type is unsupported in standalone HTML: ${item.path}`); continue; }
    if (item.size > MAX_INLINE_IMAGE) { warnings.push(`Image exceeds the 5 MiB HTML embedding limit: ${item.path}`); continue; }
    const blob = await repository.getAttachmentBlob(item.id);
    if (!blob) { warnings.push(`Image bytes are missing: ${item.path}`); continue; }
    images.set(path, `data:${item.mime};base64,${base64(new Uint8Array(await blob.arrayBuffer()))}`);
  }
  const body = renderToStaticMarkup(<ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
    img: ({ src, alt }) => {
      const source = typeof src === 'string' ? src : '';
      const path = resolveVaultReference(note.path, source);
      const data = path ? images.get(key(path)) : undefined;
      if (!data) return <span className="missing-image">[Image: {alt || source}]</span>;
      // This standalone document embeds its own image bytes.
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={data} alt={alt ?? ''} />;
    },
    a: ({ href, children }) => typeof href === 'string' && href.startsWith('#noor-')
      ? <span>{children}</span>
      : <a href={typeof href === 'string' ? href : undefined} rel="noopener noreferrer">{children}</a>,
  }}>{prepareReadingMarkdown(note.markdown)}</ReactMarkdown>);
  const title = escapeHtml(note.title || note.path.split('/').at(-1) || 'Note');
  const source = escapeHtml(note.markdown);
  const instruction = printView ? '<p class="print-instruction">Use your browser Print command and choose Save as PDF.</p>' : '';
  const html = `<!doctype html><html lang="und"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>${title} â€” Noor Note</title><style>html{font:16px/1.65 system-ui,sans-serif;color:#253b35;background:#fff}body{max-width:52rem;margin:2rem auto;padding:0 1.25rem}h1,h2,h3{line-height:1.25}img{max-width:100%;height:auto}pre{overflow:auto;padding:1rem;background:#f1f4f1}code{overflow-wrap:anywhere}blockquote{border-left:3px solid #8bb19d;padding-left:1rem;color:#445a50}table{border-collapse:collapse;display:block;overflow:auto}th,td{border:1px solid #ccd8d0;padding:.35rem .6rem}a{color:#256a58}details{margin-top:3rem;border-top:1px solid #ccd8d0;padding-top:1rem}details pre{white-space:pre-wrap;overflow-wrap:anywhere}.missing-image{border:1px dashed #aaa;padding:.2rem}.print-instruction{padding:.75rem;background:#edf4ee}@media print{body{margin:0;max-width:none}.print-instruction,details{display:none}pre,blockquote,img{break-inside:avoid}}</style></head><body><header><h1>${title}</h1><p>${escapeHtml(note.path)}</p></header>${instruction}<main>${body}</main><details><summary>Original Markdown source</summary><pre>${source}</pre></details></body></html>`;
  return { html, warnings };
}
