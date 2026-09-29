import { aiPolicySchema, defaultAiPolicy, readAiPolicy, type AiPolicy } from '@noor-note/ai';

export const AI_POLICY_STORAGE_KEY = 'noor-note.ai-policy.v1';
const CHANGE_EVENT = 'noor-note:ai-policy-change';

export function parseAiPolicyJson(raw: string | null): AiPolicy {
  try { return raw ? readAiPolicy(JSON.parse(raw)) : defaultAiPolicy; }
  catch { return defaultAiPolicy; }
}

export function loadAiPolicy(storage: Pick<Storage, 'getItem'>): AiPolicy {
  try { return parseAiPolicyJson(storage.getItem(AI_POLICY_STORAGE_KEY)); }
  catch { return defaultAiPolicy; }
}

export function currentAiPolicy(): AiPolicy {
  try { return loadAiPolicy(window.localStorage); }
  catch { return defaultAiPolicy; }
}

export function saveAiPolicy(storage: Pick<Storage, 'setItem'>, policy: AiPolicy): AiPolicy {
  const validated = aiPolicySchema.parse(policy);
  storage.setItem(AI_POLICY_STORAGE_KEY, JSON.stringify(validated));
  if (typeof window !== 'undefined' && storage === window.localStorage) window.dispatchEvent(new Event(CHANGE_EVENT));
  return validated;
}

export function aiPolicySnapshot(): string | null {
  try { return window.localStorage.getItem(AI_POLICY_STORAGE_KEY); }
  catch { return null; }
}

export function subscribeAiPolicy(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => { if (event.key === AI_POLICY_STORAGE_KEY) listener(); };
  window.addEventListener('storage', onStorage);
  window.addEventListener(CHANGE_EVENT, listener);
  return () => { window.removeEventListener('storage', onStorage); window.removeEventListener(CHANGE_EVENT, listener); };
}
