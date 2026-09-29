import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { authConfiguration } from './auth-config';

let browserClient: SupabaseClient | null = null;

export function getAuthClient(): SupabaseClient | null {
  if (typeof window === 'undefined' || authConfiguration.kind !== 'supabase') return null;
  browserClient ??= createClient(authConfiguration.url, authConfiguration.publishableKey, {
    auth: {
      flowType: 'pkce',
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      storageKey: 'noor-note-auth-v1',
    },
  });
  return browserClient;
}

export function accountRedirectUrl(origin: string): string {
  const parsed = new URL(origin);
  if ((parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) || parsed.username || parsed.password) throw new Error('Invalid account redirect origin.');
  return new URL('/account/', parsed.origin).toString();
}
