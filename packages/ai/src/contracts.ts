import { z } from 'zod';

const id = z.uuid();
const label = z.string().trim().min(1).max(120);
export const aiCapabilitySchema = z.enum(['chat', 'embeddings', 'transcription', 'ocr', 'imageUnderstanding']);
export type AiCapability = z.infer<typeof aiCapabilitySchema>;

/** A public description only. Credentials must remain in a trusted provider adapter. */
export const aiProviderDescriptorSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9.-]{1,79}$/u),
  name: label,
  model: label,
  execution: z.enum(['onDevice', 'external']),
  recipient: z.url().nullable(),
  capabilities: z.array(aiCapabilitySchema).min(1).max(5),
}).strict().superRefine((provider, context) => {
  if (new Set(provider.capabilities).size !== provider.capabilities.length) context.addIssue({ code: 'custom', path: ['capabilities'], message: 'Duplicate capability' });
  if (provider.execution === 'external') {
    if (!provider.recipient) context.addIssue({ code: 'custom', path: ['recipient'], message: 'External recipient origin is required' });
    else {
      const url = new URL(provider.recipient);
      if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) context.addIssue({ code: 'custom', path: ['recipient'], message: 'External recipient must be an HTTPS origin without credentials, path, or query' });
    }
  } else if (provider.recipient !== null) context.addIssue({ code: 'custom', path: ['recipient'], message: 'On-device providers have no external recipient' });
});
export type AiProviderDescriptor = z.infer<typeof aiProviderDescriptorSchema>;

export const aiScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('promptOnly') }).strict(),
  z.object({ kind: z.literal('currentNote'), vaultId: id, noteId: id }).strict(),
  z.object({ kind: z.literal('selectedNotes'), vaultId: id, noteIds: z.array(id).min(1).max(20) }).strict(),
  z.object({ kind: z.literal('folderResults'), vaultId: id, folderId: id, noteIds: z.array(id).min(1).max(20) }).strict(),
  z.object({ kind: z.literal('baseResults'), vaultId: id, baseId: id, noteIds: z.array(id).min(1).max(50) }).strict(),
  z.object({ kind: z.literal('vaultRetrieval'), vaultId: id, query: z.string().trim().min(1).max(500), noteIds: z.array(id).min(1).max(20) }).strict(),
]);
export type AiScope = z.infer<typeof aiScopeSchema>;
export type AiScopeKind = AiScope['kind'];

export const aiContentItemSchema = z.object({
  vaultId: id, noteId: id, path: z.string().startsWith('/').max(1000), title: z.string().max(200),
  markdown: z.string().max(100_000),
}).strict();
export type AiContentItem = z.infer<typeof aiContentItemSchema>;

export const aiRequestPlanSchema = z.object({
  id, provider: aiProviderDescriptorSchema, capability: aiCapabilitySchema,
  scope: aiScopeSchema, prompt: z.string().trim().min(1).max(10_000),
  content: z.array(aiContentItemSchema).max(50), createdAt: z.iso.datetime({ offset: true }),
}).strict().superRefine((plan, context) => {
  if (!plan.provider.capabilities.includes(plan.capability)) context.addIssue({ code: 'custom', path: ['capability'], message: 'Provider does not support this capability' });
  const ids = plan.scope.kind === 'promptOnly' ? [] : plan.scope.kind === 'currentNote' ? [plan.scope.noteId] : plan.scope.noteIds;
  if (plan.content.length !== ids.length || new Set(ids).size !== ids.length || new Set(plan.content.map((item) => item.noteId)).size !== plan.content.length) context.addIssue({ code: 'custom', path: ['content'], message: 'Content must exactly match the declared scope' });
  if (plan.scope.kind !== 'promptOnly') {
    const vaultId = plan.scope.vaultId;
    if (plan.content.some((item) => item.vaultId !== vaultId || !ids.includes(item.noteId))) context.addIssue({ code: 'custom', path: ['content'], message: 'Content is outside the declared scope or vault' });
  }
  if (plan.content.reduce((total, item) => total + item.markdown.length, 0) > 200_000) context.addIssue({ code: 'custom', path: ['content'], message: 'AI context is too large' });
});
export type AiRequestPlan = z.infer<typeof aiRequestPlanSchema>;

export interface ChatCompletion { text: string; model: string; usage?: { inputTokens?: number; outputTokens?: number } }
export interface ChatCompletionProvider {
  readonly descriptor: AiProviderDescriptor;
  complete(plan: AiRequestPlan, signal: AbortSignal): Promise<ChatCompletion>;
}
export interface EmbeddingProvider {
  readonly descriptor: AiProviderDescriptor;
  embed(texts: readonly string[], signal: AbortSignal): Promise<readonly (readonly number[])[]>;
}
export interface AudioTranscriptionProvider<Result> {
  readonly descriptor: AiProviderDescriptor;
  transcribe(source: Blob, onProgress: (message: string) => void, signal: AbortSignal): Promise<Result>;
}
export interface OcrProvider<Session, Progress> {
  readonly descriptor: AiProviderDescriptor;
  start(languages: readonly string[], onProgress: (progress: Progress) => void): Promise<Session>;
}
export interface ImageUnderstandingProvider {
  readonly descriptor: AiProviderDescriptor;
  describe(image: Blob, prompt: string, signal: AbortSignal): Promise<ChatCompletion>;
}
