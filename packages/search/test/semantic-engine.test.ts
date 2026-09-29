import { describe, expect, it } from 'vitest';
import { chunkFingerprint, chunkNote, cosineSimilarity, hybridResults, semanticResults, SEMANTIC_EMBEDDING_VERSION, type EmbeddedChunk, type SemanticNote } from '../src';
import type { SearchResult } from '../src';

const timestamp = '2026-09-29T12:00:00.000Z';
const note: SemanticNote = { id: crypto.randomUUID(), vaultId: crypto.randomUUID(), revision: 1, title: 'Research', path: '/Research.md', markdown: '', updatedAt: timestamp };

function embedded(overrides: Partial<EmbeddedChunk> = {}): EmbeddedChunk {
  return { noteId: note.id, vaultId: note.vaultId, title: note.title, path: note.path, updatedAt: timestamp, heading: 'Findings', blockId: null, from: 0, to: 10, line: 2, text: 'A useful passage', id: crypto.randomUUID(), fingerprint: 'hash', embeddingVersion: SEMANTIC_EMBEDDING_VERSION, vector: [1, 0], ...overrides };
}

describe('semantic passage engine', () => {
  it('keeps canonical source ranges, heading and block references while excluding frontmatter and code fences', () => {
    const markdown = `---\ntitle: Research\n---\n# Findings\nAlpha finding ^b-${crypto.randomUUID()}\n\n\`\`\`js\nsecret();\n\`\`\`\n## Next\nBeta finding`;
    const chunks = chunkNote({ ...note, markdown });
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({ heading: 'Findings', line: 5, blockId: expect.stringMatching(/^b-/u) });
    expect(chunks[1]).toMatchObject({ heading: 'Next', line: 11, text: 'Beta finding' });
    for (const chunk of chunks) expect(markdown.slice(chunk.from, chunk.to).trim()).toBe(chunk.text);
    expect(chunks.map((chunk) => chunk.text).join(' ')).not.toMatch(/title:|secret\(\)/u);
  });

  it('fingerprints passage content independently of note location and revision', async () => {
    const first = chunkNote({ ...note, markdown: '# Findings\nSame passage' })[0]!;
    const moved = { ...first, from: 100, line: 20, path: '/Moved.md' };
    expect(await chunkFingerprint(moved)).toBe(await chunkFingerprint(first));
    expect(await chunkFingerprint({ ...first, text: 'Changed passage' })).not.toBe(await chunkFingerprint(first));
  });

  it('ranks the best passage per note with cosine similarity and retains source location', () => {
    const otherId = crypto.randomUUID();
    const results = semanticResults([embedded({ vector: [0, 1] }), embedded({ vector: [1, 0], line: 8, text: 'Best match' }), embedded({ noteId: otherId, vector: [0.5, 0.5] }), embedded({ noteId: crypto.randomUUID(), embeddingVersion: 'old' })], [1, 0]);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ id: note.id, excerpt: 'Best match', line: 8, similarity: 1 });
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0);
    expect(() => cosineSimilarity([1], [1, 2])).toThrow();
  });

  it('fuses lexical and semantic rank without duplicating a note', () => {
    const firstId = crypto.randomUUID(), secondId = crypto.randomUUID();
    const base = semanticResults([embedded({ noteId: firstId }), embedded({ noteId: secondId, vector: [0, 1] })], [1, 0]);
    const lexical: SearchResult[] = [{ ...base[1]!, score: 100 }, { ...base[0]!, score: 10 }];
    const fused = hybridResults(lexical, base);
    expect(fused).toHaveLength(2);
    expect(fused[0]?.id).toBe(secondId);
    expect(fused[0]?.similarity).toBeDefined();
  });
});
