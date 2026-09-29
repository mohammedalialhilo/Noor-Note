'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ArrowLeft, KeyRound, Mail, ShieldCheck } from 'lucide-react';
import { BrandMark } from './BrandMark';
import { useAccount } from '../auth/AuthProvider';
import { authErrorMessage, resendVerification, sendMagicLink, sendPasswordReset, signInWithOAuth, signInWithPassword, signOutOfAccount, signUpWithPassword, updateAccountPassword, type AuthAction } from '../lib/auth-actions';
import type { ConfiguredOAuthProvider } from '../lib/auth-config';
import styles from './AccountScreen.module.css';

type Mode = 'signIn' | 'signUp' | 'magicLink' | 'reset';
const providerName: Record<ConfiguredOAuthProvider, string> = { google: 'Google', github: 'GitHub', azure: 'Microsoft' };

export function AccountScreen() {
  const { configuration, client, user, loading, recovery, sessionWarning, clearRecovery } = useAccount();
  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verificationPending, setVerificationPending] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('error')) return;
    const timer = window.setTimeout(() => setError('The account link was invalid or expired. Request a new link.'), 0);
    url.searchParams.delete('error'); url.searchParams.delete('error_code'); url.searchParams.delete('error_description');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    return () => window.clearTimeout(timer);
  }, []);

  const switchMode = (next: Mode) => { setMode(next); setPassword(''); setConfirmPassword(''); setError(null); setMessage(null); };
  const run = async (action: AuthAction, operation: () => Promise<void>) => {
    if (!client) return;
    setBusy(true); setError(null); setMessage(null);
    try { await operation(); }
    catch (caught) { setError(authErrorMessage(action, caught)); }
    finally { setBusy(false); setPassword(''); setConfirmPassword(''); }
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!client) return;
    const origin = window.location.origin;
    if (recovery) {
      if (password !== confirmPassword) { setError('The passwords do not match.'); return; }
      void run('updatePassword', async () => { await updateAccountPassword(client, password); clearRecovery(); setMessage('Password updated. Your local vault is unchanged.'); });
      return;
    }
    if (mode === 'signIn') void run('signIn', async () => { await signInWithPassword(client, email, password); setMessage('Signed in. Your local vault is unchanged.'); });
    if (mode === 'signUp') void run('signUp', async () => { const result = await signUpWithPassword(client, email, password, origin); setVerificationPending(result === 'verification'); setMessage(result === 'verification' ? 'Check your email to verify your account. Your local vault remains available.' : 'Account created and signed in. Your local vault is unchanged.'); });
    if (mode === 'magicLink') void run('magicLink', async () => { await sendMagicLink(client, email, origin); setMessage('If this address has an account, a sign-in link will arrive shortly.'); });
    if (mode === 'reset') void run('reset', async () => { await sendPasswordReset(client, email, origin); setMessage('If this address has an account, a password reset link will arrive shortly.'); });
  };
  const logout = (scope: 'local' | 'global') => {
    if (!client) return;
    if (scope === 'global' && !window.confirm('Sign out Noor Note on every device? Local vaults on those devices will remain stored there.')) return;
    void run('signOut', async () => { await signOutOfAccount(client, scope); setMessage(scope === 'global' ? 'Signed out on all devices. Local vaults remain on each device.' : 'Signed out on this device. Your local vault remains available.'); });
  };

  return <main className={styles.page}>
    <div className={styles.frame}>
      <header className={styles.header}><Link href="/" className={styles.back}><ArrowLeft size={17} /> Workspace</Link><div className={styles.brand}><BrandMark size={32} /><span>Noor Note</span></div></header>
      <div className={styles.card}>
        <div className={styles.eyebrow}>OPTIONAL ACCOUNT</div>
        <h1>{recovery ? 'Set a new password' : user ? 'Your Noor Note account' : mode === 'signUp' ? 'Create an account' : mode === 'magicLink' ? 'Email sign-in link' : mode === 'reset' ? 'Reset your password' : 'Sign in to Noor Note'}</h1>
        <p className={styles.intro}>Accounts are optional. Notes and attachments stay in this browser. Signing in alone does not upload your vault; enable cloud sync for a vault in Settings when you choose.</p>
        {configuration.kind === 'local' && <div className={styles.notice}><ShieldCheck size={18} /><p>Cloud accounts are not configured on this deployment. Continue using Noor Note locally.</p></div>}
        {configuration.kind === 'invalid' && <div role="alert" className={styles.notice}><ShieldCheck size={18} /><p>Cloud accounts are unavailable: {configuration.message} Your local vault still works.</p></div>}
        {loading && configuration.kind === 'supabase' && <p role="status">Checking your account session…</p>}
        {sessionWarning && <p role="status" className={styles.noticeText}>{sessionWarning}</p>}
        {message && <p role="status" className={styles.success}>{message}</p>}
        {error && <p role="alert" className={styles.error}>{error}</p>}
        {configuration.kind === 'supabase' && !loading && client && user && !recovery && <section className={styles.account} aria-label="Current account">
          <div className={styles.identity}><Mail size={18} /><div><strong>{user.email ?? 'Signed-in account'}</strong><span>{user.emailConfirmed ? 'Email verified' : 'Email verification pending'}</span></div></div>
          <p>Your session is specific to this browser. Other devices may have their own sessions and local vaults.</p>
          <div className={styles.actions}><button type="button" disabled={busy} onClick={() => logout('local')}>Sign out this device</button><button type="button" disabled={busy} onClick={() => logout('global')}>Sign out all devices</button></div>
          {user.email && <button type="button" className={styles.textButton} disabled={busy} onClick={() => { void run('reset', async () => { await sendPasswordReset(client, user.email!, window.location.origin); setMessage('If this address has an account, a password reset link will arrive shortly.'); }); }}>Send password reset email</button>}
        </section>}
        {configuration.kind === 'supabase' && !loading && client && (!user || recovery) && <>
          <form className={styles.form} onSubmit={submit}>
            {!recovery && <label htmlFor="account-email">Email address<input id="account-email" name="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>}
            {(mode === 'signIn' || mode === 'signUp' || recovery) && <label htmlFor="account-password">{recovery ? 'New password' : 'Password'}<input id="account-password" name="password" type="password" autoComplete={recovery ? 'new-password' : mode === 'signUp' ? 'new-password' : 'current-password'} required minLength={mode === 'signIn' && !recovery ? 1 : 8} maxLength={1024} value={password} onChange={(event) => setPassword(event.target.value)} /></label>}
            {recovery && <label htmlFor="account-confirm-password">Confirm new password<input id="account-confirm-password" name="confirm-password" type="password" autoComplete="new-password" required minLength={8} maxLength={1024} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>}
            <button type="submit" className={styles.primary} disabled={busy}>{busy ? 'Please wait…' : recovery ? 'Update password' : mode === 'signUp' ? 'Create account' : mode === 'magicLink' ? 'Send sign-in link' : mode === 'reset' ? 'Send reset link' : 'Sign in'}</button>
          </form>
          {!recovery && <div className={styles.links}>
            {mode !== 'signIn' && <button type="button" onClick={() => switchMode('signIn')}>Sign in</button>}
            {mode !== 'signUp' && <button type="button" onClick={() => switchMode('signUp')}>Create account</button>}
            {mode !== 'magicLink' && <button type="button" onClick={() => switchMode('magicLink')}>Magic link</button>}
            {mode !== 'reset' && <button type="button" onClick={() => switchMode('reset')}>Forgot password?</button>}
          </div>}
          {verificationPending && !recovery && <button type="button" className={styles.textButton} disabled={busy} onClick={() => { void run('resend', async () => { await resendVerification(client, email, window.location.origin); setMessage('If this address is awaiting verification, a new email will arrive shortly.'); }); }}>Resend verification email</button>}
          {!recovery && configuration.oauthProviders.length > 0 && <div className={styles.oauth}><span>Or continue with</span>{configuration.oauthProviders.map((provider) => <button type="button" key={provider} disabled={busy} onClick={() => { void run('oauth', () => signInWithOAuth(client, provider, window.location.origin)); }}>{providerName[provider]}</button>)}</div>}
        </>}
        <div className={styles.local}><KeyRound size={17} /><span>Prefer to stay local? No account is required.</span><Link href="/">Open workspace</Link></div>
      </div>
    </div>
  </main>;
}
