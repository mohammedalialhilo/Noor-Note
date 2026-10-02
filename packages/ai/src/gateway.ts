import { z } from 'zod';
import {
  aiContentItemSchema, aiProviderDescriptorSchema, aiRequestPlanSchema, aiScopeSchema,
  type AiContentItem, type AiProviderDescriptor, type AiRequestPlan, type AiScope,
  type ChatCompletion, type ChatCompletionProvider, type EmbeddingProvider,
} from './contracts';
import { aiPolicySchema, aiScopeAllowed, type AiPolicy } from './policy';
import { aiMessagesForPlan, isAuthorizedChatTask } from './trust-boundary';

const chatCompletionSchema = z.object({
  text: z.string().max(1_000_000), model: z.string().trim().min(1).max(120),
  usage: z.object({ inputTokens: z.number().int().nonnegative().optional(), outputTokens: z.number().int().nonnegative().optional() }).strict().optional(),
}).strict();
const embeddingResultSchema = z.array(z.array(z.number().finite()).min(1).max(4096)).max(50);

export interface AiInvocation {
  providerId: string;
  prompt: string;
  /** User-authored request; never promoted into the application/system instruction. */
  userInstruction?: string | null;
  scope: AiScope;
  content: readonly AiContentItem[];
  getPolicy: () => AiPolicy;
  /** Must present provider, destination, scope, prompt, and exact content before returning true. */
  review: (plan: AiRequestPlan) => Promise<boolean>;
  signal: AbortSignal;
}

/** There are intentionally no production providers registered by default. */
export class AiGateway {
  private readonly chatProviders = new Map<string, ChatCompletionProvider>();
  private readonly embeddingProviders = new Map<string, EmbeddingProvider>();

  registerChat(provider: ChatCompletionProvider): () => void {
    const descriptor = aiProviderDescriptorSchema.parse(provider.descriptor);
    if (!descriptor.capabilities.includes('chat') || this.chatProviders.has(descriptor.id)) throw new Error('Invalid or duplicate chat provider.');
    this.chatProviders.set(descriptor.id, provider);
    return () => { if (this.chatProviders.get(descriptor.id) === provider) this.chatProviders.delete(descriptor.id); };
  }

  registerEmbeddings(provider: EmbeddingProvider): () => void {
    const descriptor = aiProviderDescriptorSchema.parse(provider.descriptor);
    if (!descriptor.capabilities.includes('embeddings') || this.embeddingProviders.has(descriptor.id)) throw new Error('Invalid or duplicate embedding provider.');
    this.embeddingProviders.set(descriptor.id, provider);
    return () => { if (this.embeddingProviders.get(descriptor.id) === provider) this.embeddingProviders.delete(descriptor.id); };
  }

  listProviders(): AiProviderDescriptor[] {
    const byId = new Map<string, AiProviderDescriptor>();
    for (const provider of [...this.chatProviders.values(), ...this.embeddingProviders.values()]) byId.set(provider.descriptor.id, aiProviderDescriptorSchema.parse(provider.descriptor));
    return [...byId.values()];
  }

  private plan(descriptor: AiProviderDescriptor, capability: 'chat' | 'embeddings', invocation: AiInvocation): AiRequestPlan {
    const policy = aiPolicySchema.parse(invocation.getPolicy());
    const scope = aiScopeSchema.parse(invocation.scope);
    if (!aiScopeAllowed(policy, scope.kind)) throw new Error('AI is disabled or this content scope is not allowed.');
    return aiRequestPlanSchema.parse({
      id: crypto.randomUUID(), provider: aiProviderDescriptorSchema.parse(descriptor), capability,
      scope, prompt: invocation.prompt, userInstruction: invocation.userInstruction ?? null,
      content: invocation.content.map((item) => aiContentItemSchema.parse(item)),
      createdAt: new Date().toISOString(),
    });
  }

  private async approve(plan: AiRequestPlan, invocation: AiInvocation, stillRegistered: () => boolean): Promise<void> {
    if (invocation.signal.aborted) throw new DOMException('AI request canceled', 'AbortError');
    // The reviewer receives a copy; provider input cannot be altered after it is shown.
    const approved = await invocation.review(structuredClone(plan));
    if (!approved) throw new Error('AI request was not approved.');
    if (invocation.signal.aborted) throw new DOMException('AI request canceled', 'AbortError');
    if (!stillRegistered() || !aiScopeAllowed(aiPolicySchema.parse(invocation.getPolicy()), plan.scope.kind)) throw new Error('AI configuration changed before the request was sent.');
  }

  async runChat(invocation: AiInvocation): Promise<ChatCompletion> {
    const provider = this.chatProviders.get(invocation.providerId);
    if (!provider) throw new Error('No chat provider is configured.');
    const plan = this.plan(provider.descriptor, 'chat', invocation);
    if (!isAuthorizedChatTask(plan.prompt)) throw new Error('AI application task is not authorized.');
    await this.approve(plan, invocation, () => this.chatProviders.get(invocation.providerId) === provider && JSON.stringify(provider.descriptor) === JSON.stringify(plan.provider));
    const request = { messages: aiMessagesForPlan(plan), sourceCount: plan.content.length, sourceCharacters: plan.content.reduce((size, item) => size + item.markdown.length, 0) };
    return chatCompletionSchema.parse(await provider.complete(request, invocation.signal));
  }

  async runEmbeddings(invocation: AiInvocation): Promise<readonly (readonly number[])[]> {
    const provider = this.embeddingProviders.get(invocation.providerId);
    if (!provider) throw new Error('No embedding provider is configured.');
    const plan = this.plan(provider.descriptor, 'embeddings', invocation);
    await this.approve(plan, invocation, () => this.embeddingProviders.get(invocation.providerId) === provider && JSON.stringify(provider.descriptor) === JSON.stringify(plan.provider));
    const texts = plan.scope.kind === 'promptOnly' ? [plan.prompt] : plan.content.map((item) => item.markdown);
    const result = embeddingResultSchema.parse(await provider.embed(texts, invocation.signal));
    if (result.length !== texts.length) throw new Error('Embedding provider returned the wrong number of vectors.');
    return result;
  }
}
