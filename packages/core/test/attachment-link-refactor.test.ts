import { describe, expect, it } from 'vitest';
import { makeVaultNote, planAttachmentLinkRename } from '../src/index';

describe('attachment link rename', () => {
  it('rebases live Markdown links while preserving labels and code', async () => {
    const vaultId = crypto.randomUUID();
    const markdown = '---\nsource: "[x](../Audio/Voice.webm)"\n---\n[Play](../Audio/Voice.webm)\n\n```md\n[Example](../Audio/Voice.webm)\n```\n';
    const note = await makeVaultNote({ vaultId, title: 'Plan', folderPath: '/Plans', markdown });
    const changes = planAttachmentLinkRename([note], '/Audio/Voice.webm', '/Audio/Interview.webm');
    expect(changes).toHaveLength(1);
    expect(changes[0]?.count).toBe(1);
    expect(changes[0]?.after).toContain('[Play](../Audio/Interview.webm)');
    expect(changes[0]?.after).toContain('[Example](../Audio/Voice.webm)');
    expect(changes[0]?.after).toContain('source: "[x](../Audio/Voice.webm)"');
    expect(note.markdown).toBe(markdown);
  });
  it('handles escaped brackets in recording names', async () => {
    const note = await makeVaultNote({ vaultId: crypto.randomUUID(), title: 'Audio', markdown: '[Voice \\[one\\].webm](Voice%20%5Bone%5D.webm)' });
    const changes = planAttachmentLinkRename([note], '/Voice [one].webm', '/Interview.webm');
    expect(changes[0]?.after).toBe('[Voice \\[one\\].webm](Interview.webm)');
  });
});
