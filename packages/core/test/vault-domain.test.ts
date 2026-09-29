import { describe, expect, it } from 'vitest';
import { checksumMarkdown, joinVaultPath, makeVaultNote, normalizeVaultPath, parsePortableMarkdown, pathKey, resolveVaultReference, stripFrontmatter, vaultNoteSchema, withFrontmatter } from '../src';

const vaultId = 'cb3541a0-dc43-4cf1-a6c8-fbcd59f90545';

describe('portable vault notes', () => {
  it('parses YAML frontmatter and keeps raw Markdown canonical', () => {
    const markdown = '---\ntitle: Field notes\naliases: [Observations]\npriority: 2\nreviewed: true\n---\n\nText ![](assets/photo.png)';
    expect(parsePortableMarkdown(markdown)).toEqual({ markdown, title: 'Field notes', aliases: ['Observations'], properties: { priority: 2, reviewed: true } });
    expect(stripFrontmatter(markdown)).toBe('Text ![](assets/photo.png)');
    expect(resolveVaultReference('/Research/Note.md', 'assets/photo.png')).toBe('/Research/assets/photo.png');
    expect(resolveVaultReference('/Research/Note.md', '../Secrets/file.pdf')).toBe('/Secrets/file.pdf');
    expect(resolveVaultReference('/Research/Note.md', '../../outside.pdf')).toBeNull();
    expect(parsePortableMarkdown(withFrontmatter({ markdown: 'Body', title: 'Field notes', aliases: ['Observations'], properties: { priority: 2 } })).properties.priority).toBe(2);
  });

  it('rejects unsafe paths and malformed YAML before storage', () => {
    expect(() => normalizeVaultPath('/notes/../private')).toThrow();
    expect(() => joinVaultPath('/notes', 'a/b')).toThrow();
    expect(pathKey('/Ideas/Plan.md')).toBe('/ideas/plan.md');
    expect(() => parsePortableMarkdown('---\na: [broken\n---\nbody')).toThrow();
  });

  it('creates a validated note with stable identity and a SHA-256 checksum', async () => {
    const note = await makeVaultNote({ vaultId, folderPath: '/Ideas', title: 'Plan', markdown: '# Plan\nBody' });
    expect(vaultNoteSchema.parse(note).path).toBe('/Ideas/Plan.md');
    expect(note.checksum).toBe(await checksumMarkdown(note.markdown));
    expect(note.checksum).toMatch(/^[a-f0-9]{64}$/);
  });
});
