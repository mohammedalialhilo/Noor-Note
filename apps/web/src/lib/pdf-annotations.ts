import { isPdfAttachment, pdfAnnotationSchema, type PdfAnnotation } from '@noor-note/core';
import type { VaultRepository } from '@noor-note/storage';

export type PdfAnnotationDraft = Pick<PdfAnnotation, 'page' | 'kind' | 'quote' | 'comment' | 'color' | 'rects'>;

/** Sidecar records keyed by stable attachment IDs; never writes PDF bytes. */
export class PdfAnnotationsStore {
  constructor(private readonly repository: VaultRepository, private readonly vaultId: string) {}

  async list(attachmentId: string): Promise<PdfAnnotation[]> {
    return (await this.repository.listObjects('pdfAnnotation', this.vaultId)).map((item) => pdfAnnotationSchema.parse(item))
      .filter((item) => item.attachmentId === attachmentId).sort((a, b) => a.page - b.page || a.createdAt.localeCompare(b.createdAt));
  }

  async create(attachmentId: string, draft: PdfAnnotationDraft): Promise<PdfAnnotation> {
    const attachment = (await this.repository.listTree(this.vaultId)).attachments.find((item) => item.id === attachmentId && isPdfAttachment(item));
    if (!attachment) throw new Error('PDF is unavailable in this vault.');
    const time = new Date().toISOString();
    const annotation = pdfAnnotationSchema.parse({ ...draft, id: crypto.randomUUID(), vaultId: this.vaultId, attachmentId, createdAt: time, updatedAt: time });
    await this.repository.putObject('pdfAnnotation', annotation);
    return annotation;
  }

  async update(annotation: PdfAnnotation, comment: string, color: PdfAnnotation['color']): Promise<PdfAnnotation> {
    if (annotation.vaultId !== this.vaultId) throw new Error('Annotation belongs to another vault.');
    const latest = (await this.list(annotation.attachmentId)).find((item) => item.id === annotation.id);
    if (!latest || latest.updatedAt !== annotation.updatedAt) throw new Error('Annotation changed. Reload before editing.');
    const changed = pdfAnnotationSchema.parse({ ...latest, comment, color, updatedAt: new Date(Math.max(Date.now(), Date.parse(latest.updatedAt) + 1)).toISOString() });
    await this.repository.putObject('pdfAnnotation', changed);
    return changed;
  }

  async remove(annotation: PdfAnnotation): Promise<void> {
    if (annotation.vaultId !== this.vaultId) throw new Error('Annotation belongs to another vault.');
    await this.repository.deleteObject(annotation.id);
  }
}
