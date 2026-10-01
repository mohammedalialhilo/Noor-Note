import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { createTextCommentAnchor, resolveTextCommentAnchor } from '../src/lib/comment-anchor';

describe('inline comment anchors', () => {
  it('keeps a quote attached after edits before it', () => {
    const source = 'Intro\nThe important sentence.\nOutro';
    const from = source.indexOf('important');
    const anchor = createTextCommentAnchor(source, from, from + 'important'.length);
    expect(resolveTextCommentAnchor(`New paragraph\n${source}`, anchor)).toEqual({ from: from + 14, to: from + 23 });
  });

  it('uses surrounding context to disambiguate repeated text', () => {
    const source = 'Alpha target omega\nBeta target gamma';
    const from = source.lastIndexOf('target');
    const anchor = createTextCommentAnchor(source, from, from + 6);
    const changed = `New heading\n${source}`;
    expect(resolveTextCommentAnchor(changed, anchor)?.from).toBe(changed.lastIndexOf('target'));
  });

  it('marks a changed quote as detached instead of jumping to unrelated text', () => {
    const anchor = createTextCommentAnchor('A unique quote B', 2, 14);
    expect(resolveTextCommentAnchor('A rewritten line B', anchor)).toBeNull();
    expect(() => createTextCommentAnchor('hi', 0, 0)).toThrow();
  });

  it('does not guess between repeated quotes after their context is removed', () => {
    const anchor = createTextCommentAnchor('before target after', 7, 13);
    expect(resolveTextCommentAnchor('target / target', anchor)).toBeNull();
  });

  it('tracks a collaborative selection across concurrent edits', () => {
    const first = new Y.Doc(); const second = new Y.Doc();
    const text = first.getText('note');
    text.insert(0, 'before selected after');
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
    const anchor = createTextCommentAnchor(text.toString(), 7, 15, text);
    second.getText('note').insert(0, 'remote ');
    Y.applyUpdate(first, Y.encodeStateAsUpdate(second));
    expect(resolveTextCommentAnchor(text.toString(), anchor, text)).toEqual({ from: 14, to: 22 });
    first.destroy(); second.destroy();
  });
});
