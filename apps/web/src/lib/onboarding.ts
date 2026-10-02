export const ONBOARDING_KEY = 'noor-note:onboarding:v1';

export function browserOnboardingStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try { return window.localStorage; } catch { return null; }
}

export function shouldShowOnboarding(firstRun: boolean | null, storage: Pick<Storage, 'getItem'> | null): boolean {
  if (firstRun !== true) return false;
  if (!storage) return true;
  try { return storage.getItem(ONBOARDING_KEY) !== 'complete'; }
  catch { return true; }
}

export function completeOnboarding(storage: Pick<Storage, 'setItem'> | null): boolean {
  if (!storage) return false;
  try { storage.setItem(ONBOARDING_KEY, 'complete'); return true; }
  catch { return false; }
}
