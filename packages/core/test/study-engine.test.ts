import { describe, expect, it } from 'vitest';
import { newStudyCard, reviewStudyCard, studyCandidatesFromMarkdown, studyStatistics } from '../src';

describe('study cards', () => {
  it('parses explicit pairs, callouts, and cloze deletions while ignoring code and frontmatter', () => {
    const markdown = `---\nQ: Metadata\nA: Ignore\n---\nFront:: Light\nBack:: Photons\n\nQ: What is water?\nA: H2O\n\n> [!flashcard] Planet?\n> Earth\n\nThe {{c1::mitochondrion::organelle}} makes {{c2::ATP}}.\n\n\`\`\`text\nQ: Hidden\nA: Hidden\n\`\`\``;
    const cards = studyCandidatesFromMarkdown(markdown);
    expect(cards.map((card) => card.kind)).toEqual(['frontBack', 'questionAnswer', 'questionAnswer', 'cloze', 'cloze']);
    expect(cards[0]).toMatchObject({ front: 'Light', back: 'Photons', sourceLine: 5 });
    expect(cards[2]).toMatchObject({ front: 'Planet?', back: 'Earth', sourceKind: 'callout' });
    expect(cards[3]).toMatchObject({ front: 'The [organelle] makes ATP.', back: 'mitochondrion' });
    expect(cards[4]).toMatchObject({ front: 'The mitochondrion makes […].', back: 'ATP' });
    expect(cards.every((card) => !card.front.includes('Hidden') && !card.front.includes('Metadata'))).toBe(true);
  });

  it('only imports headings when requested and previews their section content', () => {
    const markdown = '# What is Noor?\nA note workspace.\n## Local storage\nIndexedDB.\n# Next\nOther content.';
    expect(studyCandidatesFromMarkdown(markdown)).toHaveLength(0);
    const cards = studyCandidatesFromMarkdown(markdown, { headings: true });
    expect(cards).toHaveLength(3);
    expect(cards[0]?.back).toContain('IndexedDB.');
    expect(cards[1]).toMatchObject({ front: 'Local storage', back: 'IndexedDB.', sourceKind: 'heading' });
  });

  it('schedules Again, Hard, Good, and Easy deterministically and retains history', () => {
    const start = new Date('2026-09-30T12:00:00.000Z');
    const candidate = studyCandidatesFromMarkdown('Q:: Water?\nA:: H2O')[0]!;
    const card = newStudyCard(crypto.randomUUID(), crypto.randomUUID(), candidate, start);
    const again = reviewStudyCard(card, 'again', start);
    expect(again.dueAt).toBe('2026-09-30T12:10:00.000Z');
    expect(again.ease).toBe(2.3);
    expect(again.repetitions).toBe(0);
    const hard = reviewStudyCard(card, 'hard', start);
    expect(hard.intervalDays).toBe(0.5);
    expect(hard.dueAt).toBe('2026-10-01T00:00:00.000Z');
    const good = reviewStudyCard(card, 'good', start);
    expect(good.intervalDays).toBe(1);
    const easy = reviewStudyCard(card, 'easy', start);
    expect(easy.intervalDays).toBe(4);
    const second = reviewStudyCard(good, 'good', new Date('2026-10-01T12:00:00.000Z'));
    expect(second.intervalDays).toBe(3);
    expect(second.history).toHaveLength(2);
    expect(second.history[1]).toMatchObject({ rating: 'good', previousIntervalDays: 1, nextIntervalDays: 3 });
    expect(() => reviewStudyCard(good, 'good', start)).toThrow('Review time');
    expect(studyStatistics([card, second], new Date('2026-10-02T12:00:00.000Z'))).toMatchObject({ total: 2, due: 1, new: 1, reviewedLast30Days: 2 });
  });
});
