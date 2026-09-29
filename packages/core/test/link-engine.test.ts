import { describe, expect, it } from 'vitest';
import { ensureBlockId, findUnlinkedMentions, fuzzyNotes, parseBlocks, parseInternalLinks, planLinkRename, replaceMention, resolveInternalLink, scanLinks, type VaultNote } from '../src';

const vaultId = '55555555-5555-4555-8555-555555555555';
function note(id: string, title: string, path: string, markdown = '', aliases: string[] = []): VaultNote {
  return { id, vaultId, folderId: null, path, title, markdown, aliases, properties: {}, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null, trashGroupId: null, revision: 1, checksum: 'a'.repeat(64) };
}
const plan = note('11111111-1111-4111-8111-111111111111', 'Plan', '/Research/Plan.md', '# Scope\n\nA paragraph ^b-one', ['Roadmap']);
const source = note('22222222-2222-4222-8222-222222222222', 'Source', '/Research/Source.md', '[[Plan]] [[Research/Plan|Map]] [[Plan#Scope]] [[Plan^b-one]]\n[Plan](Plan.md)\n![[Plan]]\n`[[Ignored]]`\n```md\n[[Hidden]]\n```');

describe('internal link engine', () => {
  it('parses wiki, folder, alias, heading, block, embed, and local Markdown links with offsets', () => {
    const links = parseInternalLinks(source.markdown);
    expect(links.map((link) => [link.kind, link.target, link.alias, link.heading, link.blockId])).toEqual([
      ['wiki', 'Plan', null, null, null], ['wiki', 'Research/Plan', 'Map', null, null],
      ['wiki', 'Plan', null, 'Scope', null], ['wiki', 'Plan', null, null, 'b-one'],
      ['markdown', 'Plan.md', 'Plan', null, null], ['embed', 'Plan', null, null, null],
    ]);
    expect(links.every((link) => source.markdown.slice(link.start, link.end) === link.raw)).toBe(true);
    expect(scanLinks([source, plan]).every((item) => item.link.noteId === plan.id && item.link.status === 'resolved')).toBe(true);
    expect(resolveInternalLink(parseInternalLinks('![[image.png]]')[0]!, source, [source, plan]).status).toBe('attachment');
  });

  it('uses stable IDs through rename and distinguishes missing targets', () => {
    const renamed = { ...plan, title: 'New title', path: '/Research/New title.md' };
    const pinned = parseInternalLinks(`[[Plan]]<!-- noor-note-id:${plan.id} -->`)[0]!;
    expect(resolveInternalLink(pinned, source, [source, renamed]).noteId).toBe(plan.id);
    expect(resolveInternalLink(parseInternalLinks('[[Missing]]')[0]!, source, [source, plan]).status).toBe('missing');
    expect(resolveInternalLink(parseInternalLinks('[[Roadmap]]')[0]!, source, [source, plan]).noteId).toBe(plan.id);
    expect(resolveInternalLink(parseInternalLinks('[[Plan#Absent]]')[0]!, source, [source, plan]).status).toBe('heading-missing');
    expect(resolveInternalLink(parseInternalLinks('[[Plan^absent]]')[0]!, source, [source, plan]).status).toBe('block-missing');
    const nested = { ...source, path: '/Research/Drafts/Source.md' };
    expect(resolveInternalLink(parseInternalLinks('[Plan](../Plan.md)')[0]!, nested, [nested, plan]).noteId).toBe(plan.id);
    const titleCollision = note('33333333-3333-4333-8333-333333333333', 'Plan', '/Plan.md');
    expect(resolveInternalLink(pinned, source, [source, renamed, titleCollision]).noteId).toBe(renamed.id);
    expect(resolveInternalLink(parseInternalLinks('[[Plan]]')[0]!, { id: source.id, path: '/Other/Source.md' }, [plan, titleCollision]).status).toBe('ambiguous');
  });

  it('assigns and reuses block IDs', () => {
    const added = ensureBlockId('First\nSecond', 2, 'b-fixed');
    expect(added.markdown).toBe('First\nSecond ^b-fixed');
    expect(ensureBlockId(added.markdown, 2).id).toBe('b-fixed');
    expect(parseBlocks(added.markdown)).toEqual([{ id: 'b-fixed', line: 2, text: 'Second' }]);
    expect(() => ensureBlockId('```\ninside\n```', 2)).toThrow(/outside code/);
  });

  it('finds unlinked mentions outside links and converts an exact occurrence', () => {
    const mentioning = { ...source, markdown: '---\ntitle: Plan\n---\nRoadmap says Plan. [[Plan]]\n```\nPlan\n```' };
    const mentions = findUnlinkedMentions([mentioning, plan], plan);
    expect(mentions.map((item) => item.text)).toEqual(['Roadmap', 'Plan']);
    const converted = replaceMention(mentioning.markdown, mentions[0]!, plan);
    expect(converted).toContain(`[[Plan|Roadmap]]<!-- noor-note-id:${plan.id} -->`);
    expect(() => replaceMention('changed', mentions[0]!, plan)).toThrow();
  });

  it('previews only resolved rename edits and ranks fuzzy suggestions', () => {
    const changes = planLinkRename([source, plan], plan, 'Strategy');
    expect(changes).toHaveLength(1);
    expect(changes[0]?.count).toBe(6);
    expect(changes[0]?.after).toContain('[[Strategy#Scope]]');
    expect(changes[0]?.after).toContain('[[Research/Strategy|Map]]');
    expect(changes[0]?.after).toContain('[Strategy](Strategy.md)');
    expect(fuzzyNotes('rmap', [source, plan])[0]?.id).toBe(plan.id);
  });
});
