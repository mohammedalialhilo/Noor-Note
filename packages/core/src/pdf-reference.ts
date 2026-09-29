import { pathKey, type Attachment, type PdfAnnotation, type VaultNote } from './vault-domain';
import { resolveVaultReference } from './vault-note';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
export interface PdfReference { path: string; page: number; attachmentId: string | null; annotationId: string | null }
export interface PdfBacklink { noteId: string; title: string; path: string; line: number; preview: string; page: number; annotationId: string | null }

/** File APIs may report an otherwise valid .pdf as a generic binary attachment. */
export function isPdfAttachment(attachment: Pick<Attachment, 'mime' | 'name'>): boolean {
  return attachment.mime === 'application/pdf' || attachment.mime === 'application/x-pdf' || attachment.mime === 'application/octet-stream' && /\.pdf$/iu.test(attachment.name);
}

/** Standard relative PDF URL plus Noor IDs in the fragment. */
export function pdfReferenceHref(notePath: string, attachment: Pick<Attachment, 'path' | 'id'>, page: number, annotationId?: string): string {
  if (!Number.isInteger(page) || page < 1 || page > 100_000 || annotationId && !uuid.test(annotationId)) throw new Error('Invalid PDF reference');
  const from = notePath.split('/').filter(Boolean).slice(0, -1), to = attachment.path.split('/').filter(Boolean);
  while (from.length && to.length && from[0]!.toLocaleLowerCase() === to[0]!.toLocaleLowerCase()) { from.shift(); to.shift(); }
  const relative = [...from.map(() => '..'), ...to].map((part) => encodeURIComponent(part).replace(/\(/gu, '%28').replace(/\)/gu, '%29')).join('/');
  return `${relative}#page=${page}&noor-pdf=${attachment.id}${annotationId ? `&annotation=${annotationId}` : ''}`;
}

export function pdfReferenceLink(notePath: string, attachment: Pick<Attachment, 'id' | 'path' | 'name'>, page: number, annotationId?: string, label?: string): string {
  const text = (label ?? `${attachment.name}, page ${page}`).replaceAll('\\', '\\\\').replaceAll('[', '\\[').replaceAll(']', '\\]');
  return `[${text}](${pdfReferenceHref(notePath, attachment, page, annotationId)})`;
}

export function parsePdfReference(href: string): PdfReference | null {
  const hash = href.indexOf('#');
  const path = hash < 0 ? href : href.slice(0, hash);
  if (!/\.pdf$/iu.test(path) || /^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(path)) return null;
  const params = new URLSearchParams(hash < 0 ? '' : href.slice(hash + 1));
  const pageRaw = params.get('page');
  const page = pageRaw && /^[1-9]\d{0,5}$/u.test(pageRaw) ? Number(pageRaw) : 1;
  if (page > 100_000) return null;
  const attachmentId = params.get('noor-pdf');
  const annotationId = params.get('annotation');
  if (attachmentId && !uuid.test(attachmentId) || annotationId && !uuid.test(annotationId)) return null;
  return { path, page, attachmentId, annotationId };
}

export function resolvePdfAttachment(reference: PdfReference, notePath: string, attachments: readonly Attachment[]): Attachment | null {
  const byId = reference.attachmentId ? attachments.find((item) => item.id === reference.attachmentId && isPdfAttachment(item)) : null;
  if (byId) return byId;
  const resolved = resolveVaultReference(notePath, reference.path);
  return resolved ? attachments.find((item) => isPdfAttachment(item) && pathKey(item.path) === pathKey(resolved)) ?? null : null;
}

/** Backlinks come from note Markdown; annotations remain separate from the PDF bytes. */
export function collectPdfBacklinks(notes: readonly VaultNote[], attachment: Pick<Attachment, 'id' | 'path'>, annotation?: Pick<PdfAnnotation, 'id'>): PdfBacklink[] {
  const links: PdfBacklink[] = [];
  for (const note of notes) note.markdown.split('\n').forEach((line, index) => {
    for (const match of line.matchAll(/\[(?:\\.|[^\]\\\n])*\]\(([^\s)]+)\)/gu)) {
      const reference = parsePdfReference(match[1] ?? '');
      if (!reference) continue;
      if (annotation && reference.annotationId !== annotation.id) continue;
      const resolved = resolveVaultReference(note.path, reference.path);
      const target = reference.attachmentId === attachment.id || resolved !== null && pathKey(resolved) === pathKey(attachment.path);
      if (target) links.push({ noteId: note.id, title: note.title, path: note.path, line: index + 1, preview: line.slice(0, 240), page: reference.page, annotationId: reference.annotationId });
    }
  });
  return links;
}
