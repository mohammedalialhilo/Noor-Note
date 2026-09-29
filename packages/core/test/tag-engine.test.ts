import { describe, expect, it } from 'vitest';
import { buildTagTree, extractTags, inspectMetadata, normalizeTagName, planTagRewrite, rewriteTag, scanInlineTags, type VaultNote } from '../src';

function note(markdown: string): VaultNote {
  return { id: '11111111-1111-4111-8111-111111111111', vaultId: '22222222-2222-4222-8222-222222222222', folderId: null, path: '/Note.md', title: 'Note', markdown, aliases: [], properties: {}, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null, trashGroupId: null, revision: 1, checksum: 'a'.repeat(64) };
}

describe('tags', () => {
  it('extracts nested tags from body and YAML without code or YAML comments', () => {
    const markdown = '---\ntags: [work, research/ai]\n# comment #ignored\n---\n#work #research/ai `#code`\n```md\n#fenced\n```';
    expect(extractTags(markdown)).toEqual(['work', 'research/ai']);
    expect(scanInlineTags(markdown).map(({ tag }) => tag)).toEqual(['work', 'research/ai']);
    expect(normalizeTagName('#research/ai')).toBe('research/ai');
  });

  it('builds a nested sidebar with one usage count per note', () => {
    const tree = buildTagTree([{ tags: ['Work', 'Work/Meetings'] }, { tags: ['work/Notes'] }]);
    expect(tree).toMatchObject([{ name: 'Work', count: 2, children: [{ name: 'Meetings', count: 1 }, { name: 'Notes', count: 1 }] }]);
  });

  it('renames, merges, and deletes exact or nested references without changing code', () => {
    const markdown = '---\n# keep me\ntags: [work, work/meetings, personal]\ncustom: value\n---\n#work #work/meetings `#work`\n```\n#work\n```';
    const renamed = rewriteTag(markdown, 'work', 'projects', true);
    expect(renamed.count).toBe(4);
    expect(extractTags(renamed.markdown)).toEqual(['projects', 'projects/meetings', 'personal']);
    expect(renamed.markdown).toContain('`#work`');
    expect(renamed.markdown).toContain('# keep me');
    expect(inspectMetadata(renamed.markdown).values.custom).toBe('value');
    const merged = rewriteTag(renamed.markdown, 'projects/meetings', 'projects');
    expect(extractTags(merged.markdown)).toEqual(['projects', 'personal']);
    const deleted = rewriteTag(merged.markdown, 'projects', null);
    expect(extractTags(deleted.markdown)).toEqual(['personal']);
    expect(planTagRewrite([note(markdown)], 'work', 'projects', true)[0]?.path).toBe('/Note.md');
  });

  it('includes typed YAML tag properties in counts and reference changes', () => {
    const markdown = '---\ntopic: "#work/meetings"\nnoor_property_types:\n  topic: tag\ncustom: keep\n---\nBody';
    expect(extractTags(markdown)).toEqual(['work/meetings']);
    const changed = rewriteTag(markdown, 'work', 'projects', true);
    expect(changed.count).toBe(1);
    expect(inspectMetadata(changed.markdown).values).toMatchObject({ topic: '#projects/meetings', custom: 'keep' });
    const removed = rewriteTag(changed.markdown, 'projects', null, true);
    expect(inspectMetadata(removed.markdown).values.topic).toBeUndefined();
  });
});
