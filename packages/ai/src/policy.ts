import { z } from 'zod';
import type { AiScopeKind } from './contracts';

export const aiPolicySchema = z.object({
  version: z.literal(1),
  mode: z.enum(['disabled', 'explicit']),
  allow: z.object({
    currentNote: z.boolean(), selectedNotes: z.boolean(), baseResults: z.boolean(), vaultRetrieval: z.boolean(),
  }).strict(),
}).strict().superRefine((policy, context) => {
  if (policy.mode === 'disabled' && Object.values(policy.allow).some(Boolean)) context.addIssue({ code: 'custom', path: ['allow'], message: 'Disabled AI cannot retain content permissions' });
});
export type AiPolicy = z.infer<typeof aiPolicySchema>;

export const defaultAiPolicy: AiPolicy = Object.freeze({
  version: 1, mode: 'disabled',
  allow: Object.freeze({ currentNote: false, selectedNotes: false, baseResults: false, vaultRetrieval: false }),
});

export function readAiPolicy(value: unknown): AiPolicy {
  const parsed = aiPolicySchema.safeParse(value);
  return parsed.success ? parsed.data : defaultAiPolicy;
}

export function aiScopeAllowed(policy: AiPolicy, scope: AiScopeKind): boolean {
  if (policy.mode !== 'explicit') return false;
  return scope === 'promptOnly' || (scope === 'folderResults' ? policy.allow.vaultRetrieval : policy.allow[scope]);
}

export function setAiMode(policy: AiPolicy, mode: AiPolicy['mode']): AiPolicy {
  return mode === 'disabled' ? defaultAiPolicy : aiPolicySchema.parse({ ...policy, mode });
}

export function setAiScopePermission(policy: AiPolicy, scope: keyof AiPolicy['allow'], allowed: boolean): AiPolicy {
  if (policy.mode === 'disabled' && allowed) throw new Error('Enable explicitly invoked AI before granting note access.');
  return aiPolicySchema.parse({ ...policy, allow: { ...policy.allow, [scope]: allowed } });
}
