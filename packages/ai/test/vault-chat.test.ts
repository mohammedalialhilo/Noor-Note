import { describe, expect, it } from 'vitest';
import { aiScopeAllowed, defaultAiPolicy, insufficientVaultEvidence, setAiMode, setAiScopePermission, verifyGroundedAnswer, vaultChatPrompt, vaultChatUserQuestion, type ChatSource } from '../src';

const source: ChatSource = { id: 'S1', vaultId: crypto.randomUUID(), noteId: crypto.randomUUID(), revision: 2, title: 'Plan', path: '/Plan.md', heading: 'Timeline', blockId: null, line: 5, from: 30, to: 80, excerpt: 'The release is due in October.' };

describe('grounded vault chat', () => {
  it('accepts only retrieved citation labels and abstains on missing or invented labels', () => {
    expect(verifyGroundedAnswer('The release is due in October. [S1]', [source])).toMatchObject({ cited: [source] });
    for (const answer of ['The release is due in October.', 'The release is due in October. [S2]', 'The release is due in October. [S1]\nThe budget is fixed.', 'The release is due in October. [S1] The budget is fixed.']) {
      expect(verifyGroundedAnswer(answer, [source])).toEqual({ text: insufficientVaultEvidence, cited: [] });
    }
    expect(verifyGroundedAnswer('There is insufficient evidence in the passages.', [source]).cited).toEqual([]);
  });

  it('keeps the prompt bounded and requires source markers', () => {
    expect(vaultChatPrompt).toContain('Every factual answer line must end');
    const request = vaultChatUserQuestion('When is the release?', [{ question: 'What is the plan?', answer: 'October [S1]' }]);
    expect(JSON.parse(request)).toEqual({ question: 'When is the release?', previousUserQuestions: ['What is the plan?'] });
    expect(request).not.toContain('October [S1]');
    expect(() => vaultChatUserQuestion('x'.repeat(501))).toThrow();
  });

  it('requires explicit vault retrieval permission for a folder request', () => {
    const enabled = setAiMode(defaultAiPolicy, 'explicit');
    expect(aiScopeAllowed(enabled, 'folderResults')).toBe(false);
    expect(aiScopeAllowed(setAiScopePermission(enabled, 'vaultRetrieval', true), 'folderResults')).toBe(true);
  });
});
