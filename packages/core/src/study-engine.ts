import { studyCardSchema, studyRatingSchema, type StudyCard, type StudyRating } from './vault-domain';

export interface StudyCandidate { sourceKind: StudyCard['sourceKind']; sourceLine: number | null; sourceKey: string; kind: StudyCard['kind']; front: string; back: string }

/** Explicit Markdown patterns are always recognized; heading cards require an import opt-in. */
export function studyCandidatesFromMarkdown(markdown: string, options: { headings?: boolean } = {}): StudyCandidate[] {
  const lines = markdown.split(/\r?\n/u), hidden = new Set<number>(), candidates: StudyCandidate[] = [];
  let fence: string | null = null, frontmatter = lines[0]?.trim() === '---';
  if (frontmatter) hidden.add(0);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.trim();
    if (index === 0 && frontmatter) continue;
    if (frontmatter) { hidden.add(index); if (line === '---') frontmatter = false; continue; }
    const marker = line.match(/^(?<fence>`{3,}|~{3,})/u)?.groups?.fence;
    if (marker) { hidden.add(index); if (!fence) fence = marker; else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null; continue; }
    if (fence) hidden.add(index);
  }
  const add = (candidate: Omit<StudyCandidate, 'sourceKey'>) => {
    const front = candidate.front.trim(), back = candidate.back.trim();
    if (!front || !back || front.length > 5_000 || back.length > 5_000) return;
    const sourceKey = `${candidate.kind}:${front}\n${back}`;
    if (!candidates.some((item) => item.sourceKey === sourceKey)) candidates.push({ ...candidate, front, back, sourceKey });
  };
  for (let index = 0; index < lines.length; index++) {
    if (hidden.has(index)) continue;
    const line = lines[index]!;
    const pair = line.match(/^\s*(Front|Q(?:uestion)?)::?\s*(.+)$/iu);
    if (pair) {
      let next = index + 1;
      while (next < lines.length && !lines[next]!.trim()) next++;
      if (!hidden.has(next)) {
        const back = lines[next]?.match(/^\s*(Back|A(?:nswer)?)::?\s*(.+)$/iu);
        if (back) { add({ sourceKind: 'markdown', sourceLine: index + 1, kind: /^Front$/iu.test(pair[1]!) ? 'frontBack' : 'questionAnswer', front: pair[2]!, back: back[2]! }); index = next; continue; }
      }
    }
    const callout = line.match(/^>\s*\[!flashcard\]\s*(.+)$/iu);
    if (callout) {
      const answer: string[] = [];
      let next = index + 1;
      while (next < lines.length && /^\s*>/u.test(lines[next]!)) { answer.push(lines[next]!.replace(/^\s*>\s?/u, '')); next++; }
      add({ sourceKind: 'callout', sourceLine: index + 1, kind: 'questionAnswer', front: callout[1]!, back: answer.join('\n') });
      index = next - 1; continue;
    }
    const clozes = [...line.matchAll(/\{\{c(\d{1,3})::([^{}]+?)\}\}/gu)];
    for (const number of new Set(clozes.map((item) => item[1]!))) {
      const answers = clozes.filter((item) => item[1] === number).map((item) => item[2]!.split('::')[0]!.trim());
      const prompt = line.replace(/\{\{c(\d{1,3})::([^{}]+?)\}\}/gu, (_match, indexText: string, contents: string) => {
        const [answer, hint] = contents.split('::');
        return indexText === number ? `[${hint?.trim() || '…'}]` : answer!.trim();
      });
      add({ sourceKind: 'markdown', sourceLine: index + 1, kind: 'cloze', front: prompt, back: answers.join('; ') });
    }
  }
  if (options.headings) for (let index = 0; index < lines.length; index++) {
    if (hidden.has(index)) continue;
    const heading = lines[index]!.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/u);
    if (!heading) continue;
    const answer: string[] = [];
    for (let next = index + 1; next < lines.length; next++) {
      const sibling = lines[next]!.match(/^(#{1,6})\s+/u);
      if (sibling && sibling[1]!.length <= heading[1]!.length) break;
      if (!hidden.has(next)) answer.push(lines[next]!);
    }
    add({ sourceKind: 'heading', sourceLine: index + 1, kind: 'questionAnswer', front: heading[2]!, back: answer.join('\n') });
  }
  return candidates;
}

export function newStudyCard(vaultId: string, sourceNoteId: string, candidate: StudyCandidate, now = new Date()): StudyCard {
  const at = now.toISOString();
  return studyCardSchema.parse({ id: crypto.randomUUID(), vaultId, sourceNoteId, ...candidate, dueAt: at, intervalDays: 0, ease: 2.5, repetitions: 0, lastReviewedAt: null, history: [], createdAt: at, updatedAt: at, deletedAt: null });
}

/** A bounded SM-2-inspired schedule. All intervals are UTC elapsed days; early reviews use fractional days. */
export function reviewStudyCard(input: StudyCard, ratingInput: StudyRating, now = new Date()): StudyCard {
  const card = studyCardSchema.parse(input), rating = studyRatingSchema.parse(ratingInput);
  if (card.deletedAt) throw new Error('A deleted study card cannot be reviewed.');
  const current = now.getTime();
  if (!Number.isFinite(current) || card.lastReviewedAt && current <= new Date(card.lastReviewedAt).getTime()) throw new Error('Review time must follow the previous review.');
  const ease = Math.min(3, Math.max(1.3, card.ease + ({ again: -0.2, hard: -0.15, good: 0, easy: 0.15 })[rating]));
  const rawInterval = rating === 'again' ? 10 / 1440 : rating === 'hard' ? card.intervalDays === 0 ? 0.5 : Math.max(0.5, card.intervalDays * 1.2) : rating === 'good' ? card.repetitions === 0 ? 1 : card.repetitions === 1 ? 3 : card.intervalDays * ease : card.repetitions === 0 ? 4 : Math.max(4, card.intervalDays * ease * 1.3);
  const intervalDays = Math.min(36_500, Math.round(rawInterval * 1_000_000_000) / 1_000_000_000);
  const at = now.toISOString();
  return studyCardSchema.parse({ ...card, dueAt: new Date(current + Math.round(intervalDays * 86_400_000)).toISOString(), intervalDays, ease, repetitions: rating === 'again' ? 0 : card.repetitions + 1, lastReviewedAt: at, history: [...card.history, { at, rating, previousIntervalDays: card.intervalDays, nextIntervalDays: intervalDays, previousEase: card.ease, nextEase: ease }], updatedAt: at });
}

export function studyStatistics(cards: readonly StudyCard[], now = new Date()) {
  const active = cards.filter((card) => !card.deletedAt), current = now.getTime(), since = current - 30 * 86_400_000;
  const reviews = active.flatMap((card) => card.history).filter((item) => new Date(item.at).getTime() >= since && new Date(item.at).getTime() <= current);
  return { total: active.length, due: active.filter((card) => new Date(card.dueAt).getTime() <= current).length, new: active.filter((card) => !card.lastReviewedAt).length, reviewedLast30Days: reviews.length, againLast30Days: reviews.filter((item) => item.rating === 'again').length };
}
