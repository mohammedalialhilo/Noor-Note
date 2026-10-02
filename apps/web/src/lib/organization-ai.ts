import { z } from 'zod';
import { organizationPrompt } from '@noor-note/ai';
import { normalizeTagName, type VaultNote } from '@noor-note/core';
import type { OrganizationSuggestion } from './organization';

const responseSchema = z.object({ suggestions: z.array(z.object({
  kind: z.enum(['tag', 'property', 'task', 'contradiction']),
  quote: z.string().min(5).max(240), value: z.string().trim().min(1).max(100),
  explanation: z.string().trim().min(1).max(240),
}).strict()).max(8) }).strict();

export { organizationPrompt };

export function parseOrganizationAi(raw: string, note: VaultNote): OrganizationSuggestion[] {
  const json = raw.match(/\{[\s\S]*\}/u)?.[0];
  if (!json) throw new Error('The model did not return a valid suggestion list.');
  let input: unknown;
  try { input = JSON.parse(json); } catch { throw new Error('The model returned invalid JSON.'); }
  const parsed = responseSchema.parse(input);
  return parsed.suggestions.flatMap((item, index): OrganizationSuggestion[] => {
    if (!note.markdown.includes(item.quote)) return [];
    const base = { id: `ai:${note.id}:${index}:${item.quote}`, noteId: note.id, reason: item.explanation, evidence: item.quote, source: 'ai' as const };
    if (item.kind === 'tag') {
      try { const tag = normalizeTagName(item.value); return [{ ...base, kind: 'tag', title: `Add #${tag}`, action: { kind: 'tag', value: tag }, safeForBatch: true }]; } catch { return []; }
    }
    if (item.kind === 'property') {
      const match = item.value.match(/^([\p{L}_][\p{L}\p{N}_ -]{0,49})=(.{1,100})$/u);
      if (!match) return [];
      return [{ ...base, kind: 'property', title: `Add ${match[1]!.trim()} property`, action: { kind: 'property', key: match[1]!.trim(), value: match[2]!.trim() }, safeForBatch: true }];
    }
    if (item.kind === 'task') {
      const line = note.markdown.split('\n').find((candidate) => candidate === item.quote && /^(?:TODO|Action):\s+\S/iu.test(candidate));
      return line ? [{ ...base, kind: 'task', title: 'Convert action line to task', action: { kind: 'task', line }, safeForBatch: true }] : [];
    }
    // A single quoted statement cannot establish a contradiction.
    return [];
  });
}
