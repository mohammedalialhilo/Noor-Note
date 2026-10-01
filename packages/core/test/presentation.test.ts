import { describe, expect, it } from 'vitest';
import { parsePresentation } from '../src';

describe('Markdown presentation derivation', () => {
  it('splits only explicit slide markers and removes speaker notes from audience content', () => {
    const source = '---\ntitle: Plan\n---\n# Opening\n\n<!-- speaker-notes\nSay hello.\n-->\n\n<!-- slide -->\n## Detail\nText\n<!-- speaker-notes\nMention the timeline.\n-->\n';
    expect(parsePresentation(source)).toEqual([
      { markdown: '# Opening', speakerNotes: 'Say hello.' },
      { markdown: '## Detail\nText', speakerNotes: 'Mention the timeline.' },
    ]);
    expect(source).toContain('<!-- slide -->');
  });

  it('keeps separators and note syntax inside fenced or indented code as slide content', () => {
    const source = '````md\n<!-- slide -->\n<!-- speaker-notes\n-->\n````\n    <!-- slide -->\n<!-- slide -->\nLast slide';
    const slides = parsePresentation(source);
    expect(slides).toHaveLength(2);
    expect(slides[0]?.markdown).toContain('<!-- slide -->\n<!-- speaker-notes');
    expect(slides[0]?.markdown).toContain('    <!-- slide -->');
    expect(slides[1]?.markdown).toBe('Last slide');
  });

  it('keeps ordinary thematic breaks, supports CRLF, and omits empty leading slides', () => {
    expect(parsePresentation('<!-- slide -->\r\n# Start\r\n\r\n---\r\n\r\nEnd')).toEqual([
      { markdown: '# Start\n\n---\n\nEnd', speakerNotes: '' },
    ]);
    expect(parsePresentation('')).toEqual([{ markdown: '', speakerNotes: '' }]);
  });

  it('does not consume the rest of a note after an unfinished speaker comment', () => {
    expect(parsePresentation('# Start\n<!-- speaker-notes\nUnfinished')).toEqual([
      { markdown: '# Start\n<!-- speaker-notes\nUnfinished', speakerNotes: '' },
    ]);
  });
});
