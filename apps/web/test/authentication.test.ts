import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseAuthConfiguration } from '../src/lib/auth-config';
import { accountRedirectUrl } from '../src/lib/auth-client';
import { authErrorMessage, resendVerification, sendMagicLink, sendPasswordReset, signInWithOAuth, signInWithPassword, signOutOfAccount, signUpWithPassword, updateAccountPassword } from '../src/lib/auth-actions';
import { readAccountIdentity } from '../src/auth/AuthProvider';

const email = 'person@example.com';
const origin = 'https://notes.example.com';
const ok = { data: { session: null }, error: null };

function fakeClient() {
  const auth = {
    signInWithPassword: vi.fn().mockResolvedValue(ok), signUp: vi.fn().mockResolvedValue(ok),
    signInWithOtp: vi.fn().mockResolvedValue(ok), resetPasswordForEmail: vi.fn().mockResolvedValue(ok),
    resend: vi.fn().mockResolvedValue(ok), updateUser: vi.fn().mockResolvedValue(ok),
    signOut: vi.fn().mockResolvedValue(ok), signInWithOAuth: vi.fn().mockResolvedValue(ok),
  };
  return { auth, client: { auth } as unknown as SupabaseClient };
}

describe('optional Supabase authentication', () => {
  it('keeps the application local without configuration and rejects secret or partial configuration', () => {
    expect(parseAuthConfiguration({})).toEqual({ kind: 'local' });
    expect(parseAuthConfiguration({ url: 'https://example.supabase.co' }).kind).toBe('invalid');
    expect(parseAuthConfiguration({ url: 'https://example.supabase.co', publishableKey: 'sb_secret_do_not_use' }).kind).toBe('invalid');
    expect(parseAuthConfiguration({ url: 'http://example.supabase.co', publishableKey: 'sb_publishable_1234567890' }).kind).toBe('invalid');
    expect(parseAuthConfiguration({ url: 'https://example.supabase.co', publishableKey: 'sb_publishable_1234567890', oauthProviders: 'google,github,google' })).toMatchObject({ kind: 'supabase', oauthProviders: ['google', 'github'] });
    expect(readAccountIdentity({ id: crypto.randomUUID(), email, email_confirmed_at: null, access_token: 'untrusted' })).toMatchObject({ email, emailConfirmed: false });
    expect(readAccountIdentity({ id: 'invalid', email })).toBeNull();
  });

  it('uses the same-origin callback path and Supabase PKCE-compatible auth methods', async () => {
    const { auth, client } = fakeClient();
    const redirect = 'https://notes.example.com/account/';
    expect(accountRedirectUrl(origin)).toBe(redirect);
    expect(() => accountRedirectUrl('http://notes.example.com')).toThrow();
    await signInWithPassword(client, ' Person@Example.com ', 'password123');
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email, password: 'password123' });
    await signInWithPassword(client, email, 'legacy');
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email, password: 'legacy' });
    expect(await signUpWithPassword(client, email, 'password123', origin)).toBe('verification');
    expect(auth.signUp).toHaveBeenCalledWith({ email, password: 'password123', options: { emailRedirectTo: redirect } });
    await sendMagicLink(client, email, origin);
    expect(auth.signInWithOtp).toHaveBeenCalledWith({ email, options: { emailRedirectTo: redirect, shouldCreateUser: false } });
    await sendPasswordReset(client, email, origin);
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith(email, { redirectTo: redirect });
    await resendVerification(client, email, origin);
    expect(auth.resend).toHaveBeenCalledWith({ type: 'signup', email, options: { emailRedirectTo: redirect } });
    await updateAccountPassword(client, 'new-password123');
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'new-password123' });
    await signInWithOAuth(client, 'google', origin);
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo: redirect } });
    await signOutOfAccount(client);
    await signOutOfAccount(client, 'global');
    expect(auth.signOut).toHaveBeenNthCalledWith(1, { scope: 'local' });
    expect(auth.signOut).toHaveBeenNthCalledWith(2, { scope: 'global' });
  });

  it('validates inputs before a network request and uses non-enumerating error text', async () => {
    const { auth, client } = fakeClient();
    await expect(signInWithPassword(client, 'not an email', 'password123')).rejects.toThrow();
    await expect(signUpWithPassword(client, email, 'short', origin)).rejects.toThrow();
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
    expect(auth.signUp).not.toHaveBeenCalled();
    expect(authErrorMessage('signIn', new Error('user_exists@example.com'))).not.toContain('user_exists');
    expect(authErrorMessage('reset', new Error('no account'))).not.toContain('no account');
  });
});
