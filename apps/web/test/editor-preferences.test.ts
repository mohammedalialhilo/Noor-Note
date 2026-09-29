import { describe, expect, it } from 'vitest';
import { defaultEditorPreferences } from '../src/components/MarkdownEditor';
import { parseEditorPreferences } from '../src/hooks/useEditorPreferences';

describe('editor preferences', () => {
  it('validates stored values and clamps display sizes', () => {
    expect(parseEditorPreferences(null)).toEqual(defaultEditorPreferences);
    expect(parseEditorPreferences({ fontFamily: 'serif', fontSize: 100, lineHeight: 0, spellcheck: false, wordWrap: 'false' })).toMatchObject({
      fontFamily: 'serif', fontSize: 28, lineHeight: 1.2, spellcheck: false, wordWrap: true,
    });
  });
});
