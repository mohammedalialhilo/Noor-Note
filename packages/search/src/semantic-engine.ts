import type { SearchResult } from './search-engine';

export const SEMANTIC_EMBEDDING_VERSION = 'multilingual-e5-small-761b726:chunks-v1';
export type SearchMode = 'lexical' | 'semantic' | 'hybrid';

export interface SemanticNote {
  id: string; vaultId: string; revision: number; title: string; path: string; markdown: string; updatedAt: string;
}
export interface SemanticChunk {
  noteId: string; vaultId: string; title: string; path: string; updatedAt: string;
  heading: string | null; blockId: string | null; from: number; to: number; line: number; text: string;
}
export interface EmbeddedChunk extends SemanticChunk {
  id: string; fingerprint: string; embeddingVersion: string; vector: number[];
}

/** Chunk by Markdown section and source lines; offsets always point into canonical Markdown. */
export function chunkNote(note: SemanticNote, maxCharacters = 400): SemanticChunk[] {
  if (maxCharacters < 100) throw new Error('Chunk size is too small.');
  const result: SemanticChunk[] = [];
  const lines = note.markdown.split('\n');
  let offset = 0, heading: string | null = null, fence: string | null = null, frontmatter = lines[0]?.trim() === '---';
  let start = -1, end = -1, startLine = 1;
  const flush = () => {
    if (start < 0) return;
    const text = note.markdown.slice(start, end).trim();
    if (text) result.push({ noteId: note.id, vaultId: note.vaultId, title: note.title, path: note.path, updatedAt: note.updatedAt, heading, blockId: text.match(/\^(b-[0-9a-f-]{36})\b/iu)?.[1] ?? null, from: start, to: end, line: startLine, text });
    start = -1; end = -1;
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const lineStart = offset;
    offset += line.length + (index < lines.length - 1 ? 1 : 0);
    if (frontmatter) { if (index > 0 && line.trim() === '---') frontmatter = false; continue; }
    const fenceMatch = line.match(/^\s*(```+|~~~+)/u);
    if (fenceMatch) { flush(); fence = fence ? null : fenceMatch[1]![0]!; continue; }
    if (fence) continue;
    const headingMatch = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/u);
    if (headingMatch) { flush(); heading = headingMatch[1]!.trim(); continue; }
    if (!line.trim()) continue;
    let cursor = 0;
    while (cursor < line.length) {
      if (start >= 0 && lineStart + cursor - start >= maxCharacters) flush();
      if (start < 0) { start = lineStart + cursor; startLine = index + 1; }
      const available = Math.max(1, maxCharacters - (lineStart + cursor - start));
      const remaining = line.length - cursor;
      let take = Math.min(remaining, available);
      if (take < remaining) {
        const boundary = line.lastIndexOf(' ', cursor + take);
        if (boundary > cursor + Math.floor(take / 2)) take = boundary - cursor + 1;
      }
      end = lineStart + cursor + take;
      cursor += take;
      if (cursor < line.length) flush();
    }
  }
  flush();
  return result;
}

export async function chunkFingerprint(chunk: SemanticChunk): Promise<string> {
  const bytes = new TextEncoder().encode(`${chunk.heading ?? ''}\n${chunk.text}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (!left.length || left.length !== right.length) throw new Error('Embedding dimensions do not match.');
  let dot = 0, leftNorm = 0, rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]!, b = right[index]!;
    if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error('Embedding contains an invalid value.');
    dot += a * b; leftNorm += a * a; rightNorm += b * b;
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}

export function semanticResults(chunks: readonly EmbeddedChunk[], vector: readonly number[], limit = 100): SearchResult[] {
  const best = new Map<string, SearchResult>();
  for (const chunk of chunks) {
    if (chunk.embeddingVersion !== SEMANTIC_EMBEDDING_VERSION) continue;
    const similarity = cosineSimilarity(chunk.vector, vector);
    const previous = best.get(chunk.noteId);
    if (previous && (previous.similarity ?? -1) >= similarity) continue;
    best.set(chunk.noteId, {
      id: chunk.noteId, title: chunk.title, path: chunk.path, excerpt: chunk.text.slice(0, 320), highlights: [],
      kind: 'note', properties: [], score: similarity, similarity, heading: chunk.heading ?? undefined,
      blockId: chunk.blockId ?? undefined, from: chunk.from, to: chunk.to, line: chunk.line, updatedAt: chunk.updatedAt,
    });
  }
  return [...best.values()].sort((a, b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
}

/** Reciprocal-rank fusion keeps lexical hits and semantic passages on comparable scales. */
export function hybridResults(lexical: readonly SearchResult[], semantic: readonly SearchResult[], limit = 100): SearchResult[] {
  const combined = new Map<string, SearchResult>();
  for (const [index, result] of lexical.entries()) combined.set(`${result.kind}:${result.id}`, { ...result, score: 1 / (60 + index + 1) });
  for (const [index, result] of semantic.entries()) {
    const key = `${result.kind}:${result.id}`;
    const previous = combined.get(key);
    combined.set(key, { ...(previous ? { ...previous, ...result } : result), score: (previous?.score ?? 0) + 1 / (60 + index + 1) });
  }
  return [...combined.values()].sort((a, b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
}
