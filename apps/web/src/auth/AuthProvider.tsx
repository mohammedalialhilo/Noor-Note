'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { authConfiguration, type AuthConfiguration } from '../lib/auth-config';
import { getAuthClient } from '../lib/auth-client';

// Zod's JIT probe uses Function(), which a production CSP correctly blocks.
// Keep validation on its interpreter path before any client-side parsing starts.
z.config({ jitless: true });

export interface AccountState {
  configuration: AuthConfiguration;
  client: SupabaseClient | null;
  user: AccountIdentity | null;
  loading: boolean;
  recovery: boolean;
  sessionWarning: string | null;
  clearRecovery: () => void;
}

const AccountContext = createContext<AccountState | null>(null);
const identitySchema = z.object({ id: z.uuid(), email: z.email().optional(), email_confirmed_at: z.string().nullable().optional() });
export interface AccountIdentity { id: string; email: string | null; emailConfirmed: boolean }
export function readAccountIdentity(input: unknown): AccountIdentity | null {
  const parsed = identitySchema.safeParse(input);
  return parsed.success ? { id: parsed.data.id, email: parsed.data.email ?? null, emailConfirmed: Boolean(parsed.data.email_confirmed_at) } : null;
}

export function AuthProvider({ children, clientOverride, configurationOverride }: { children: ReactNode; clientOverride?: SupabaseClient | null; configurationOverride?: AuthConfiguration }) {
  const configuration = configurationOverride ?? authConfiguration;
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [user, setUser] = useState<AccountIdentity | null>(null);
  const [loading, setLoading] = useState(configuration.kind === 'supabase');
  const [recovery, setRecovery] = useState(false);
  const [sessionWarning, setSessionWarning] = useState<string | null>(null);

  useEffect(() => {
    let instance: SupabaseClient | null;
    try { instance = clientOverride === undefined ? getAuthClient() : clientOverride; }
    catch {
      queueMicrotask(() => { setLoading(false); setSessionWarning('Accounts are unavailable in this browser. Your local vault still works.'); });
      return;
    }
    if (!instance) return;
    let active = true;
    const { data: { subscription } } = instance.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED' || event === 'PASSWORD_RECOVERY' || event === 'USER_UPDATED') {
        const identity = session?.user ? readAccountIdentity(session.user) : null;
        setUser(identity);
        setLoading(false);
        setSessionWarning(session?.user && !identity ? 'The account response was invalid. Your local vault still works.' : null);
      }
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      if (event === 'SIGNED_OUT') setRecovery(false);
    });
    queueMicrotask(() => { if (active) setClient(instance); });
    const refresh = () => {
      if (document.visibilityState === 'hidden' || !navigator.onLine) return;
      void instance.auth.getSession().then(({ error }) => {
        if (error) setSessionWarning('Your account session could not be refreshed. Your local vault is still available.');
      }).catch(() => setSessionWarning('Your account session could not be refreshed. Your local vault is still available.'));
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', refresh);
    return () => { active = false; subscription.unsubscribe(); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('online', refresh); };
  }, [clientOverride]);

  const value = useMemo<AccountState>(() => ({ configuration, client, user, loading, recovery, sessionWarning, clearRecovery: () => setRecovery(false) }), [configuration, client, user, loading, recovery, sessionWarning]);
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount(): AccountState {
  const state = useContext(AccountContext);
  if (!state) throw new Error('Noor Note account context is unavailable.');
  return state;
}
