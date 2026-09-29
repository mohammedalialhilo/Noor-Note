// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthChangeEvent, Session, SupabaseClient, User } from '@supabase/supabase-js';
import { AuthProvider } from '../src/auth/AuthProvider';
import { AccountScreen } from '../src/components/AccountScreen';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const config = { kind: 'supabase' as const, url: 'https://project.supabase.co', publishableKey: 'sb_publishable_1234567890', oauthProviders: [] };
const user = { id: crypto.randomUUID(), email: 'person@example.com', email_confirmed_at: '2026-09-29T00:00:00Z' } as User;
const session = { user, access_token: 'not-displayed', refresh_token: 'not-displayed' } as Session;

function fakeClient() {
  let listener: ((event: AuthChangeEvent, session: Session | null) => void) | null = null;
  const auth = {
    onAuthStateChange: vi.fn((callback: typeof listener) => { listener = callback; queueMicrotask(() => listener?.('INITIAL_SESSION', null)); return { data: { subscription: { unsubscribe: vi.fn() } } }; }),
    getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    signInWithPassword: vi.fn(async () => { listener?.('SIGNED_IN', session); return { data: { session }, error: null }; }),
    signOut: vi.fn(async () => { listener?.('SIGNED_OUT', null); return { error: null }; }),
    updateUser: vi.fn(async () => ({ data: { user }, error: null })),
  };
  return { client: { auth } as unknown as SupabaseClient, auth, emit: (event: AuthChangeEvent, value: Session | null) => listener?.(event, value) };
}

describe('Noor Note account screen', () => {
  it('signs in and out without hiding the local workspace', async () => {
    const { client, auth } = fakeClient();
    render(<AuthProvider clientOverride={client} configurationOverride={config}><AccountScreen /></AuthProvider>);
    fireEvent.change(await screen.findByLabelText('Email address'), { target: { value: user.email } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /^Sign in$/u }));
    await waitFor(() => expect(screen.getByText(user.email!)).toBeTruthy());
    expect(screen.queryByText('not-displayed')).toBeNull();
    expect(screen.getByText(/Signing in alone does not upload your vault/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out this device' }));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' }));
    expect(await screen.findByRole('link', { name: 'Open workspace' })).toBeTruthy();
  });

  it('responds to recovery and token-refresh events with the same account state', async () => {
    const { client, auth, emit } = fakeClient();
    render(<AuthProvider clientOverride={client} configurationOverride={config}><AccountScreen /></AuthProvider>);
    await screen.findByLabelText('Email address');
    await act(async () => { emit('TOKEN_REFRESHED', session); });
    expect(screen.getByText(user.email!)).toBeTruthy();
    await act(async () => { emit('PASSWORD_RECOVERY', session); });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-password123' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'new-password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
    await waitFor(() => expect(auth.updateUser).toHaveBeenCalledWith({ password: 'new-password123' }));
    expect(await screen.findByText(/Password updated/)).toBeTruthy();
    await act(async () => { emit('SIGNED_OUT', null); });
    expect(screen.getByLabelText('Email address')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open workspace' })).toBeTruthy();
  });

  it('keeps the local-only deployment usable', () => {
    render(<AuthProvider clientOverride={null} configurationOverride={{ kind: 'local' }}><AccountScreen /></AuthProvider>);
    expect(screen.getByText(/Cloud accounts are not configured/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open workspace' })).toBeTruthy();
  });
});
