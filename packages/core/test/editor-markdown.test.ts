import { describe, expect, it } from 'vitest';
import { documentStats, expandNoteEmbeds, extractWikiReferences, parseOutline, parseWikiReference, prepareReadingMarkdown } from '../src';

describe('editor Markdown analysis', () => {
  it('finds ATX and Setext headings outside frontmatter and fenced code', () => {
    const source = '---\ntitle: Field notes\n---\n# Plan\nText\n## Next\n```md\n# Not a heading\n```\nWrap up\n-------\n## Next';
    expect(parseOutline(source).map((heading) => [heading.text, heading.level, heading.line, heading.id])).toEqual([
      ['Plan', 1, 4, 'plan'], ['Next', 2, 6, 'next'], ['Wrap up', 2, 10, 'wrap-up'], ['Next', 2, 12, 'next-1'],
    ]);
  });

  it('recognizes aliases, heading and block anchors, and embeds without scanning code', () => {
    const source = '[[Plan|Roadmap]] ![[Plan#Milestone]] [[Plan^block-1]] ![[image.png]] `[[ignore]]`\n```\n[[also ignore]]\n```';
    expect(extractWikiReferences(source).map(({ target, alias, heading, blockId, embed }) => ({ target, alias, heading, blockId, embed }))).toEqual([
      { target: 'Plan', alias: 'Roadmap', heading: null, blockId: null, embed: false },
      { target: 'Plan', alias: null, heading: 'Milestone', blockId: null, embed: true },
      { target: 'Plan', alias: null, heading: null, blockId: 'block-1', embed: false },
      { target: 'image.png', alias: null, heading: null, blockId: null, embed: true },
    ]);
    expect(parseWikiReference('')).toBeNull();
  });

  it('creates a display copy for extended syntax without changing the source', () => {
    const source = '---\ntitle: Plan\n---\n> [!NOTE] Reminder\nSee [[Plan|Roadmap]], ![[image.png]], and ==highlight==.\n`[[literal]]`\n```md\n[[literal]]\n```';
    const display = prepareReadingMarkdown(source);
    expect(display).toContain('> **NOTE · Reminder**');
    expect(display).toContain('[Roadmap](#noor-wiki-Plan%7CRoadmap)');
    expect(display).toContain('![image.png](image.png)');
    expect(display).toContain('[highlight](#noor-highlight)');
    expect(display).toContain('`[[literal]]`');
    expect(source).toContain('[[Plan|Roadmap]]');
  });

  it('reports source document counts for the status bar', () => {
    expect(documentStats('---\ntitle: Test\n---\nHello world.')).toEqual({ words: 2, characters: 12, readingMinutes: 1, lines: 4 });
  });

  it('expands whole-line note embeds only outside code fences', () => {
    const source = '![[Plan]]\n```md\n![[Plan]]\n```\nInline ![[Plan]]';
    const expanded = expandNoteEmbeds(source, new Map([['Plan', '# Inner']]));
    expect(expanded).toBe('> **Embedded: Plan**\n>\n> # Inner\n```md\n![[Plan]]\n```\nInline ![[Plan]]');
    expect(source).toContain('![[Plan]]');
  });

  it('carries a stable note ID through the display link without exposing its annotation', () => {
    const markdown = '[[Plan]]<!-- noor-note-id:11111111-1111-4111-8111-111111111111 -->';
    expect(prepareReadingMarkdown(markdown)).toBe('[Plan](#noor-wiki-Plan&noor-id=11111111-1111-4111-8111-111111111111)');
    expect(markdown).toContain('<!-- noor-note-id:');
  });
});
