import { z } from 'zod';

const providerSchema = z.enum(['google', 'github', 'azure']);
export type ConfiguredOAuthProvider = z.infer<typeof providerSchema>;
export type AuthConfiguration =
  | { kind: 'local' }
  | { kind: 'invalid'; message: string }
  | { kind: 'supabase'; url: string; publishableKey: string; oauthProviders: ConfiguredOAuthProvider[] };

export interface PublicAuthEnvironment {
  url?: string;
  publishableKey?: string;
  oauthProviders?: string;
}

/** Only public client configuration belongs here. Never accept a service-role or secret key. */
export function parseAuthConfiguration(environment: PublicAuthEnvironment): AuthConfiguration {
  const urlText = environment.url?.trim() ?? '';
  const key = environment.publishableKey?.trim() ?? '';
  if (!urlText && !key) return { kind: 'local' };
  if (!urlText || !key) return { kind: 'invalid', message: 'Set both public Supabase Auth values, or leave both unset for local-only use.' };
  let url: URL;
  try { url = new URL(urlText); } catch { return { kind: 'invalid', message: 'The Supabase URL is invalid.' }; }
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    return { kind: 'invalid', message: 'The Supabase URL must be an HTTPS origin (or local development origin).' };
  if (!/^sb_publishable_[A-Za-z0-9_-]{10,}$/u.test(key)) return { kind: 'invalid', message: 'Use a Supabase publishable key. Secret and service-role keys must never be exposed to the browser.' };
  const requested = (environment.oauthProviders ?? '').split(',').map((item) => item.trim().toLocaleLowerCase()).filter(Boolean);
  const providers: ConfiguredOAuthProvider[] = [];
  for (const requestedProvider of requested) {
    const parsed = providerSchema.safeParse(requestedProvider);
    if (!parsed.success) return { kind: 'invalid', message: `Unsupported OAuth provider: ${requestedProvider.slice(0, 30)}.` };
    if (!providers.includes(parsed.data)) providers.push(parsed.data);
  }
  return { kind: 'supabase', url: url.origin, publishableKey: key, oauthProviders: providers };
}

export const authConfiguration = parseAuthConfiguration({
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  oauthProviders: process.env.NEXT_PUBLIC_SUPABASE_OAUTH_PROVIDERS,
});
