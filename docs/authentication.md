# Optional accounts

Noor Note can be used without an account. If Supabase public configuration is absent, the account page explains that the deployment is local-only. Signing in alone does not upload, sync, delete, or assign ownership to an existing vault. Each vault must be explicitly enabled for cloud sync in Settings. Notes, attachments, revisions, and exports remain in this browser's local storage.

## Configure a deployment

1. Create a Supabase project and enable Email authentication. For production, configure an SMTP sender and decide whether email confirmation is required; hosted projects require confirmation by default.
2. Set `NEXT_PUBLIC_SUPABASE_URL` to the project HTTPS origin and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to its **publishable** key in the Netlify build environment (or `apps/web/.env.local` for development). These are public browser values. Never use a secret or service-role key here.
3. In Supabase Auth URL Configuration, set the deployed site URL and allow the exact callback URL `https://<your-site>/account/`. For local development also allow `http://localhost:3000/account/`. The trailing slash is intentional: the Next.js static export emits an `account/index.html` file.
4. To enable cloud sync, apply [the sync migration](../supabase/migrations/202609290001_noor_cloud_sync.sql) to the project. Deploy again so Next.js embeds the public configuration in the client bundle. The default local-only build requires no Supabase project.

The account screen supports email/password sign-in and signup, resend of signup verification, magic-link sign-in for **existing accounts**, password-reset email and password update after recovery, and sign-out on this device or all devices. Signup verification, magic links, password reset, and OAuth rely on email templates and redirect configuration in the Supabase project. A future social provider can be enabled with `NEXT_PUBLIC_SUPABASE_OAUTH_PROVIDERS=google,github` (or `azure`) after its credentials and redirect URI are configured in Supabase. No social provider is enabled by default.

The browser client uses Supabase Auth's PKCE flow, automatic code detection, session persistence, and token refresh. Auth events update the account display, including recovery, refresh, and sign-out. A visibility or reconnect check asks the SDK to refresh an expired session. Sign-out defaults to `local`, preserving sessions on other devices; the separate all-device action uses `global` scope. Noor Note does not currently show a list of sessions. Cloud vault authorization is enforced by the Supabase migration, not the account display.

Supabase Auth stores browser session tokens using its standard storage adapter. Noor Note never copies passwords or tokens into its vault database, preferences, logs, ZIPs, or UI state. A browser profile with script execution rights can access browser-held sessions; the static app does not have an HTTP-only server session. Cloud data access uses server-side RLS and an owner-checking RPC; the account display is not an authorization check. These controls still need live-project verification.

Implementation: `apps/web/src/lib/auth-config.ts` validates public configuration; `auth-client.ts` owns one browser client; `auth-actions.ts` validates inputs and delegates operations; `AuthProvider.tsx` observes session events; `AccountScreen.tsx` is the user-facing flow. See [security](security.md) and [sync protocol](sync-protocol.md).

Official references: [Supabase PKCE flow](https://supabase.com/docs/guides/auth/sessions/pkce-flow), [auth sessions](https://supabase.com/docs/guides/auth/sessions), [redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls), and [sign-out scopes](https://supabase.com/docs/guides/auth/signout).
