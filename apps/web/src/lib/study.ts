import { newStudyCard, reviewStudyCard, studyCardSchema, type StudyCandidate, type StudyCard, type StudyRating } from '@noor-note/core';
import type { VaultRepository } from '@noor-note/storage';

export class StudyStore {
  constructor(private readonly repository: VaultRepository, private readonly vaultId: string) {}

  async list(): Promise<StudyCard[]> {
    return (await this.repository.listObjects('studyCard', this.vaultId)).map((item) => studyCardSchema.parse(item)).filter((card) => !card.deletedAt).sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.createdAt.localeCompare(b.createdAt));
  }

  async add(sourceNoteId: string, candidates: readonly StudyCandidate[]): Promise<StudyCard[]> {
    const source = await this.repository.getNote(sourceNoteId);
    if (!source || source.vaultId !== this.vaultId || source.deletedAt) throw new Error('The source note is unavailable.');
    const existing = new Set((await this.list()).filter((card) => card.sourceNoteId === sourceNoteId).map((card) => card.sourceKey));
    const created: StudyCard[] = [];
    for (const candidate of candidates) {
      if (existing.has(candidate.sourceKey)) continue;
      const card = newStudyCard(this.vaultId, sourceNoteId, candidate);
      await this.repository.putObject('studyCard', card);
      existing.add(card.sourceKey); created.push(card);
    }
    return created;
  }

  async review(id: string, rating: StudyRating, expectedUpdatedAt: string): Promise<StudyCard> {
    const current = (await this.list()).find((card) => card.id === id);
    if (!current || current.updatedAt !== expectedUpdatedAt) throw new Error('The card changed. Reload study cards before reviewing.');
    const reviewed = reviewStudyCard(current, rating);
    await this.repository.putObject('studyCard', reviewed);
    return reviewed;
  }

  async remove(id: string): Promise<void> {
    const current = (await this.list()).find((card) => card.id === id);
    if (!current) throw new Error('Study card not found.');
    await this.repository.putObject('studyCard', { ...current, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }
}
