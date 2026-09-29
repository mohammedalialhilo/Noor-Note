import { ocrRecordSchema, type OcrRecord } from '@noor-note/core';
import type { VaultRepository } from '@noor-note/storage';
import { isOcrImage } from './ocr-source';
import { isPdfAttachment } from '@noor-note/core';

export interface OcrDraft { providerId: string; languages: string[]; detectedText: string; text: string; confidence: number | null }

export class OcrStore {
  constructor(private readonly repository: VaultRepository, private readonly vaultId: string) {}

  async list(attachmentId: string): Promise<OcrRecord[]> {
    return (await this.repository.listObjects('ocrRecord', this.vaultId)).map((item) => ocrRecordSchema.parse(item))
      .filter((item) => item.attachmentId === attachmentId).sort((a, b) => a.page - b.page);
  }

  async save(attachmentId: string, page: number, draft: OcrDraft, expectedUpdatedAt: string | null): Promise<OcrRecord> {
    const attachment = (await this.repository.listTree(this.vaultId)).attachments.find((item) => item.id === attachmentId);
    if (!attachment || !(isOcrImage(attachment) || isPdfAttachment(attachment))) throw new Error('OCR source is unavailable in this vault.');
    const current = (await this.list(attachmentId)).find((item) => item.page === page);
    if ((current?.updatedAt ?? null) !== expectedUpdatedAt) throw new Error('OCR text changed. Reload before saving.');
    const time = new Date(Math.max(Date.now(), current ? Date.parse(current.updatedAt) + 1 : 0)).toISOString();
    const record = ocrRecordSchema.parse({ ...draft, id: current?.id ?? crypto.randomUUID(), vaultId: this.vaultId, attachmentId, page, createdAt: current?.createdAt ?? time, updatedAt: time });
    await this.repository.putObject('ocrRecord', record);
    return record;
  }

  async correct(record: OcrRecord, text: string): Promise<OcrRecord> {
    if (record.vaultId !== this.vaultId) throw new Error('OCR text belongs to another vault.');
    return this.save(record.attachmentId, record.page, { providerId: record.providerId, languages: record.languages, detectedText: record.detectedText, text, confidence: record.confidence }, record.updatedAt);
  }
}
