import { transcriptSchema, type Attachment, type Transcript, type TranscriptSegment } from '@noor-note/core';
import type { VaultRepository } from '@noor-note/storage';

export function isTranscribable(attachment: Pick<Attachment, 'mime' | 'name'>): boolean {
  return /^(audio|video)\//iu.test(attachment.mime) || /\.(?:mp3|m4a|mp4|webm|wav|ogg|opus|aac|flac|mov)$/iu.test(attachment.name);
}

export interface TranscriptDraft {
  providerId: string;
  language: string | null;
  segments: TranscriptSegment[];
}

export class TranscriptStore {
  constructor(private readonly repository: VaultRepository, private readonly vaultId: string) {}

  async get(attachmentId: string): Promise<Transcript | null> {
    const records = (await this.repository.listObjects('transcript', this.vaultId)).map((item) => transcriptSchema.parse(item));
    return records.find((item) => item.attachmentId === attachmentId) ?? null;
  }

  async save(attachmentId: string, draft: TranscriptDraft, expectedUpdatedAt: string | null): Promise<Transcript> {
    const attachment = (await this.repository.listTree(this.vaultId)).attachments.find((item) => item.id === attachmentId);
    if (!attachment || !isTranscribable(attachment)) throw new Error('Audio or video source is unavailable in this vault.');
    const current = await this.get(attachmentId);
    if ((current?.updatedAt ?? null) !== expectedUpdatedAt) throw new Error('Transcript changed. Reload before saving.');
    const time = new Date(Math.max(Date.now(), current ? Date.parse(current.updatedAt) + 1 : 0)).toISOString();
    const record = transcriptSchema.parse({
      id: current?.id ?? crypto.randomUUID(), vaultId: this.vaultId, attachmentId,
      providerId: draft.providerId, language: draft.language,
      text: draft.segments.map((segment) => segment.text.trim()).filter(Boolean).join(' '), segments: draft.segments,
      createdAt: current?.createdAt ?? time, updatedAt: time,
    });
    await this.repository.putObject('transcript', record);
    return record;
  }
}
