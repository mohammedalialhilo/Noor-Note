import * as Y from 'yjs';
import { z } from 'zod';
import { decodeUpdate, encodeUpdate } from './collaboration';

export const textCommentAnchorSchema = z.object({
  kind: z.literal('text'), exact: z.string().min(1).max(2000), prefix: z.string().max(80),
  suffix: z.string().max(80), start: z.number().int().nonnegative(), end: z.number().int().positive(),
  yStart: z.string().optional(), yEnd: z.string().optional(),
});
export const canvasCommentAnchorSchema = z.object({ kind: z.literal('canvas'), nodeId: z.uuid() });
export const pdfCommentAnchorSchema = z.object({
  kind: z.literal('pdf'), annotationId: z.uuid(), page: z.number().int().positive(), quote: z.string().max(2000),
});
export const commentAnchorSchema = z.discriminatedUnion('kind', [textCommentAnchorSchema, canvasCommentAnchorSchema, pdfCommentAnchorSchema]);
export type CommentAnchor = z.infer<typeof commentAnchorSchema>;
export type TextCommentAnchor = z.infer<typeof textCommentAnchorSchema>;

export function createTextCommentAnchor(markdown: string, from: number, to: number, collaborativeText?: Y.Text): TextCommentAnchor {
  if (from < 0 || to <= from || to > markdown.length || to - from > 2000) throw new Error('Select up to 2000 characters to comment.');
  const anchor: TextCommentAnchor = {
    kind: 'text', exact: markdown.slice(from, to), prefix: markdown.slice(Math.max(0, from - 80), from),
    suffix: markdown.slice(to, to + 80), start: from, end: to,
  };
  if (collaborativeText?.doc && collaborativeText.toString() === markdown) {
    anchor.yStart = encodeUpdate(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(collaborativeText, from)));
    anchor.yEnd = encodeUpdate(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(collaborativeText, to)));
  }
  return anchor;
}

export function resolveTextCommentAnchor(markdown: string, anchor: TextCommentAnchor, collaborativeText?: Y.Text): { from: number; to: number } | null {
  if (collaborativeText?.doc && collaborativeText.toString() === markdown && anchor.yStart && anchor.yEnd) {
    try {
      const start = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(decodeUpdate(anchor.yStart)), collaborativeText.doc);
      const end = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(decodeUpdate(anchor.yEnd)), collaborativeText.doc);
      if (start?.type === collaborativeText && end?.type === collaborativeText && end.index > start.index
        && markdown.slice(start.index, end.index) === anchor.exact) return { from: start.index, to: end.index };
    } catch { /* A stale or malformed CRDT position falls back to the quoted text. */ }
  }
  if (markdown.slice(anchor.start, anchor.end) === anchor.exact) return { from: anchor.start, to: anchor.end };
  const candidates: { from: number; score: number; context: number }[] = [];
  let from = markdown.indexOf(anchor.exact);
  while (from !== -1) {
    const before = markdown.slice(Math.max(0, from - anchor.prefix.length), from);
    const after = markdown.slice(from + anchor.exact.length, from + anchor.exact.length + anchor.suffix.length);
    let prefixMatch = 0, suffixMatch = 0;
    while (prefixMatch < Math.min(before.length, anchor.prefix.length)
      && before[before.length - prefixMatch - 1] === anchor.prefix[anchor.prefix.length - prefixMatch - 1]) prefixMatch++;
    while (suffixMatch < Math.min(after.length, anchor.suffix.length) && after[suffixMatch] === anchor.suffix[suffixMatch]) suffixMatch++;
    candidates.push({ from, context: prefixMatch + suffixMatch, score: (prefixMatch + suffixMatch) * 100 - Math.min(Math.abs(from - anchor.start), 10000) / 1000 });
    from = markdown.indexOf(anchor.exact, from + 1);
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  if (candidates.length > 1 && candidates[0].context < 3) return null;
  return { from: candidates[0].from, to: candidates[0].from + anchor.exact.length };
}
