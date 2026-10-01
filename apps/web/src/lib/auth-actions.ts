import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { accountRedirectUrl } from './auth-client';
import type { ConfiguredOAuthProvider } from './auth-config';
import { purgeAccountCaches } from './pwa-cache';

const emailSchema = z.email().max(254);
const passwordSchema = z.string().min(8, 'Use at least 8 characters.').max(1024);
const existingPasswordSchema = z.string().min(1, 'Enter your password.').max(1024);

export function validateEmail(value: string): string { return emailSchema.parse(value.trim().toLowerCase()); }
export function validatePassword(value: string): string { return passwordSchema.parse(value); }

export type AuthAction = 'signIn' | 'signUp' | 'magicLink' | 'reset' | 'resend' | 'updatePassword' | 'oauth' | 'signOut';

/** Keep provider errors readable without revealing whether an email address has an account. */
export function authErrorMessage(action: AuthAction, error: unknown): string {
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? 'Check the account form.';
  if (action === 'signIn') return 'Could not sign in. Check your email and password, or verify your email first.';
  if (action === 'signUp') return 'Could not create the account. Check the details and try again.';
  if (action === 'updatePassword') return 'Could not update the password. The recovery link may have expired; request a new one.';
  if (action === 'signOut') return 'Could not sign out. Check your connection and try again.';
  return 'The account request could not be completed. Check your connection and try again.';
}

function assertNoError(error: { message: string } | null): void { if (error) throw error; }

export async function signInWithPassword(client: SupabaseClient, email: string, password: string): Promise<void> {
  const response = await client.auth.signInWithPassword({ email: validateEmail(email), password: existingPasswordSchema.parse(password) });
  assertNoError(response.error);
}

export async function signUpWithPassword(client: SupabaseClient, email: string, password: string, origin: string): Promise<'verification' | 'signedIn'> {
  const response = await client.auth.signUp({ email: validateEmail(email), password: validatePassword(password), options: { emailRedirectTo: accountRedirectUrl(origin) } });
  assertNoError(response.error);
  return response.data.session ? 'signedIn' : 'verification';
}

export async function sendMagicLink(client: SupabaseClient, email: string, origin: string): Promise<void> {
  const response = await client.auth.signInWithOtp({ email: validateEmail(email), options: { emailRedirectTo: accountRedirectUrl(origin), shouldCreateUser: false } });
  assertNoError(response.error);
}

export async function sendPasswordReset(client: SupabaseClient, email: string, origin: string): Promise<void> {
  const response = await client.auth.resetPasswordForEmail(validateEmail(email), { redirectTo: accountRedirectUrl(origin) });
  assertNoError(response.error);
}

export async function resendVerification(client: SupabaseClient, email: string, origin: string): Promise<void> {
  const response = await client.auth.resend({ type: 'signup', email: validateEmail(email), options: { emailRedirectTo: accountRedirectUrl(origin) } });
  assertNoError(response.error);
}

export async function updateAccountPassword(client: SupabaseClient, password: string): Promise<void> {
  const response = await client.auth.updateUser({ password: validatePassword(password) });
  assertNoError(response.error);
}

export async function signOutOfAccount(client: SupabaseClient, scope: 'local' | 'global' = 'local'): Promise<void> {
  const response = await client.auth.signOut({ scope });
  assertNoError(response.error);
  // Local vault IndexedDB and the public app shell remain available after sign-out.
  await purgeAccountCaches().catch(() => undefined);
}

export async function signInWithOAuth(client: SupabaseClient, provider: ConfiguredOAuthProvider, origin: string): Promise<void> {
  const response = await client.auth.signInWithOAuth({ provider, options: { redirectTo: accountRedirectUrl(origin) } });
  assertNoError(response.error);
}
