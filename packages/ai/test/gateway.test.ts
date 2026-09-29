import { describe, expect, it, vi } from 'vitest';
import { aiProviderDescriptorSchema, aiRequestPlanSchema, type AiContentItem, type AiRequestPlan, type ChatCompletionProvider } from '../src/contracts';
import { AiGateway } from '../src/gateway';
import { aiScopeAllowed, defaultAiPolicy, readAiPolicy, setAiMode, setAiScopePermission } from '../src/policy';

const vaultId = crypto.randomUUID();
const noteId = crypto.randomUUID();
const content: AiContentItem = { vaultId, noteId, path: '/Private.md', title: 'Private', markdown: 'Sensitive draft text' };
const descriptor = aiProviderDescriptorSchema.parse({ id: 'test.external', name: 'Test provider', model: 'test-model', execution: 'external', recipient: 'https://ai.example.test', capabilities: ['chat'] });

function provider() {
  const complete = vi.fn(async () => ({ text: 'Reply', model: 'test-model' }));
  return { descriptor, complete } satisfies ChatCompletionProvider;
}

describe('AI policy and review gateway', () => {
  it('defaults closed and rejects malformed stored policies and unsafe provider descriptors', () => {
    expect(readAiPolicy(null)).toEqual(defaultAiPolicy);
    expect(readAiPolicy({ mode: 'explicit', allow: { currentNote: true } })).toEqual(defaultAiPolicy);
    expect(readAiPolicy({ ...defaultAiPolicy, allow: { ...defaultAiPolicy.allow, vaultRetrieval: true } })).toEqual(defaultAiPolicy);
    expect(aiScopeAllowed(defaultAiPolicy, 'promptOnly')).toBe(false);
    expect(() => aiProviderDescriptorSchema.parse({ ...descriptor, recipient: 'http://ai.example.test' })).toThrow();
    expect(() => aiProviderDescriptorSchema.parse({ ...descriptor, recipient: 'https://token@ai.example.test' })).toThrow();
    expect(() => aiProviderDescriptorSchema.parse({ ...descriptor, recipient: 'https://ai.example.test/?key=secret' })).toThrow();
    expect(() => aiProviderDescriptorSchema.parse({ ...descriptor, recipient: null })).toThrow();
    const enabled = setAiMode(defaultAiPolicy, 'explicit');
    const scoped = setAiScopePermission(enabled, 'currentNote', true);
    expect(aiScopeAllowed(scoped, 'currentNote')).toBe(true);
    expect(setAiMode(scoped, 'disabled')).toEqual(defaultAiPolicy);
    expect(() => setAiScopePermission(defaultAiPolicy, 'vaultRetrieval', true)).toThrow();
  });

  it('never calls an external provider when disabled, scope denied, or review declined', async () => {
    const gateway = new AiGateway(), external = provider();
    gateway.registerChat(external);
    const review = vi.fn(async () => true);
    const invocation = { providerId: descriptor.id, prompt: 'Summarize', scope: { kind: 'currentNote' as const, vaultId, noteId }, content: [content], getPolicy: () => defaultAiPolicy, review, signal: new AbortController().signal };
    await expect(gateway.runChat(invocation)).rejects.toThrow('disabled');
    expect(review).not.toHaveBeenCalled(); expect(external.complete).not.toHaveBeenCalled();
    const enabled = setAiMode(defaultAiPolicy, 'explicit');
    await expect(gateway.runChat({ ...invocation, getPolicy: () => enabled })).rejects.toThrow('scope');
    expect(external.complete).not.toHaveBeenCalled();
    await expect(gateway.runChat({ ...invocation, getPolicy: () => setAiScopePermission(enabled, 'currentNote', true), review: async () => false })).rejects.toThrow('not approved');
    expect(external.complete).not.toHaveBeenCalled();
  });

  it('reviews provider, destination, scope, prompt, and exact content before dispatch', async () => {
    const gateway = new AiGateway(), external = provider();
    gateway.registerChat(external);
    const policy = setAiScopePermission(setAiMode(defaultAiPolicy, 'explicit'), 'currentNote', true);
    const review = vi.fn(async (plan: unknown) => {
      const parsed = aiRequestPlanSchema.parse(plan);
      expect(parsed).toMatchObject({ provider: { id: descriptor.id, recipient: descriptor.recipient }, scope: { kind: 'currentNote', noteId }, prompt: 'Summarize', content: [{ markdown: content.markdown }] });
      (plan as AiRequestPlan).content[0]!.markdown = 'Changed in review copy';
      return true;
    });
    expect(await gateway.runChat({ providerId: descriptor.id, prompt: 'Summarize', scope: { kind: 'currentNote', vaultId, noteId }, content: [content], getPolicy: () => policy, review, signal: new AbortController().signal })).toMatchObject({ text: 'Reply' });
    expect(review).toHaveBeenCalledTimes(1);
    expect(external.complete.mock.calls[0]?.[0].content[0]?.markdown).toBe(content.markdown);
  });

  it('rejects extra notes and configuration changes made while the review is open', async () => {
    const gateway = new AiGateway(), external = provider();
    const unregister = gateway.registerChat(external);
    const policy = setAiScopePermission(setAiMode(defaultAiPolicy, 'explicit'), 'currentNote', true);
    const invocation = { providerId: descriptor.id, prompt: 'Summarize', scope: { kind: 'currentNote' as const, vaultId, noteId }, content: [content], getPolicy: () => policy, review: async () => true, signal: new AbortController().signal };
    await expect(gateway.runChat({ ...invocation, content: [content, { ...content, noteId: crypto.randomUUID() }] })).rejects.toThrow();
    let livePolicy = policy;
    await expect(gateway.runChat({ ...invocation, getPolicy: () => livePolicy, review: async () => { livePolicy = defaultAiPolicy; return true; } })).rejects.toThrow('changed');
    await expect(gateway.runChat({ ...invocation, review: async () => { unregister(); return true; } })).rejects.toThrow('changed');
    expect(external.complete).not.toHaveBeenCalled();
  });

  it('gates embeddings with the same review and validates vector count', async () => {
    const gateway = new AiGateway();
    const embed = vi.fn(async () => [[1, 0], [0, 1]]);
    gateway.registerEmbeddings({ descriptor: { ...descriptor, id: 'test.embeddings', capabilities: ['embeddings'] }, embed });
    const enabled = setAiMode(defaultAiPolicy, 'explicit');
    await expect(gateway.runEmbeddings({ providerId: 'test.embeddings', prompt: 'Index my query', scope: { kind: 'promptOnly' }, content: [], getPolicy: () => enabled, review: async () => true, signal: new AbortController().signal })).rejects.toThrow('wrong number');
    expect(embed).toHaveBeenCalledWith(['Index my query'], expect.any(AbortSignal));
  });
});
