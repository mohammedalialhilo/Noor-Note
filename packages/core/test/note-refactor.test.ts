import { describe, expect, it } from 'vitest';
import { makeVaultNote, planNoteRefactor } from '../src/index';

const vaultId = crypto.randomUUID();
async function note(title: string, markdown: string, folderPath = '/') { return makeVaultNote({ vaultId, title, markdown, folderPath }); }

describe('note refactor previews', () => {
  it('merges content while leaving a redirect and retargeting incoming block links', async () => {
    const source = await note('Source', '# Source\n\nDetail ^block-one\n');
    const target = await note('Target', '# Target\n');
    const inbound = await note('Index', `[[Source^block-one]]<!-- noor-note-id:${source.id} -->`);
    const plan = planNoteRefactor([source, target, inbound], { kind: 'merge', sourceId: source.id, targetId: target.id });
    expect(plan.edits.find((edit) => edit.noteId === target.id)?.after).toContain('Detail ^block-one');
    expect(plan.edits.find((edit) => edit.noteId === source.id)?.after).toContain(target.id);
    expect(plan.edits.find((edit) => edit.noteId === inbound.id)?.after).toContain(`noor-note-id:${target.id}`);
    expect(source.markdown).toContain('Detail ^block-one');
  });

  it('splits heading sections without shifting offsets and retains source heading anchors', async () => {
    const source = await note('Journal', '# Journal\nIntro\n\n## First\nA ^a\n\n## Second\nB ^b\n');
    const plan = planNoteRefactor([source], { kind: 'split', sourceId: source.id, level: 2 });
    expect(plan.creates.map((item) => item.title)).toEqual(['First', 'Second']);
    expect(plan.creates.find((item) => item.title === 'First')?.markdown).toContain('A ^a');
    expect(plan.creates.find((item) => item.title === 'Second')?.markdown).toContain('B ^b');
    const changed = plan.edits[0]?.after ?? '';
    expect(changed).toContain('## First'); expect(changed).toContain('## Second');
    expect(changed).not.toContain('A ^a'); expect(changed).not.toContain('B ^b');
  });

  it('extracts selected body text, rejects frontmatter, and avoids path collisions', async () => {
    const source = await note('Plan', '---\nstatus: Open\n---\n# Plan\n\nSelected text ^take\n');
    const from = source.markdown.indexOf('Selected text'), to = from + 'Selected text ^take'.length;
    expect(() => planNoteRefactor([source], { kind: 'extract-selection', sourceId: source.id, from: 0, to: 5, title: 'Extract' })).toThrow('frontmatter');
    const plan = planNoteRefactor([source], { kind: 'extract-selection', sourceId: source.id, from, to, title: 'Extract' }, ['/Extract.md']);
    expect(plan.creates[0]?.path).toBe('/Extract (2).md');
    expect(plan.creates[0]?.markdown).toContain('Selected text ^take');
    expect(plan.edits[0]?.after).toContain(plan.creates[0]!.id);
  });

  it('moves and duplicates headings safely, and creates an ID-linked MOC', async () => {
    const source = await note('Source', '# Source\n\n## Topic\nBody ^one\n');
    const target = await note('Target', '# Target');
    const moved = planNoteRefactor([source, target], { kind: 'move-heading', sourceId: source.id, headingId: 'topic', targetId: target.id });
    expect(moved.edits.find((item) => item.noteId === target.id)?.after).toContain('Body ^one');
    const duplicated = planNoteRefactor([source, target], { kind: 'duplicate-heading', sourceId: source.id, headingId: 'topic' });
    expect(duplicated.edits[0]?.after).toContain('Topic copy');
    expect(duplicated.edits[0]?.after.match(/\^one/gu)).toHaveLength(1);
    const moc = planNoteRefactor([source, target], { kind: 'moc', sourceId: source.id, title: 'Index', noteIds: [source.id, target.id] });
    expect(moc.creates[0]?.markdown).toContain(`noor-note-id:${source.id}`);
    expect(moc.creates[0]?.markdown).toContain(`noor-note-id:${target.id}`);
  });

  it('previews Canvas cards from selected Markdown without editing the note', async () => {
    const source = await note('Ideas', 'Alpha\n\nBeta');
    const plan = planNoteRefactor([source], { kind: 'canvas-selection', sourceId: source.id, from: 0, to: source.markdown.length, title: 'Ideas board' });
    expect(plan.canvas?.cards).toEqual(['Alpha', 'Beta']);
    expect(plan.edits).toEqual([]);
    expect(plan.warnings).toContain('Canvas cards copy the selected Markdown; the source selection remains in the note.');
  });

  it('rebases links in content moved to a different folder', async () => {
    const source = await note('Source', '# Source\n\n[Related](Related.md)\n', '/Research');
    const target = await note('Target', '# Target\n', '/Archive');
    const related = await note('Related', '# Related\n', '/Research');
    const plan = planNoteRefactor([source, target, related], { kind: 'merge', sourceId: source.id, targetId: target.id });
    expect(plan.edits.find((edit) => edit.noteId === target.id)?.after).toContain('../Research/Related.md');
  });
});
