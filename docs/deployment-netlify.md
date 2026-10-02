# Deploy Noor Note on Netlify

Noor Note uses the Next.js **static export**. Netlify serves the exported application and PWA files from `apps/web/out`. Three separate Netlify Functions serve published pages, private share links, and a diagnostic endpoint. The build does not require a persistent Next.js server. This preserves local-only use when no cloud service is configured. Netlify's Next.js adapter is intentionally skipped for this static build; do not switch the publish directory to `.next` without redesigning the runtime. See [Next.js static export](https://nextjs.org/docs/app/guides/static-exports) and [Netlify function routing](https://docs.netlify.com/build/functions/configuration/).

## Netlify project settings

Connect this repository with the repository root as the base directory. The checked-in `netlify.toml` sets Node 24, build command `pnpm --filter @noor-note/web build`, publish directory `apps/web/out`, and functions directory `apps/web/netlify/functions`. Keep the root `packageManager` pin and install with the frozen lockfile. Netlify's pnpm install uses `--shamefully-hoist` for its Next.js integration, as recommended in its [pnpm support guidance](https://docs.netlify.com/snippets/frameworks/nextjs-pnpm-support/). Deploys generate `sw.js` and an `_headers` file after the Next.js export; the build fails if required artifacts, CSP hashes, or Node 24 Function bundles are missing.

The routes are:

| Path | Source | Purpose |
| --- | --- | --- |
| `/`, `/account/`, `/clipper/` | Static Next.js export | App, Supabase Auth callback, clip review |
| `/manifest.webmanifest`, `/sw.js`, `/_next/static/*`, icons and workers | Static export | PWA and application assets |
| `/p/*` | `publish.tsx` Netlify Function | Public sites, pages, graph and published images |
| `/s/*` | `private-share.tsx` Netlify Function | Private share pages, password posts and downloads |
| `/health` | `health.ts` Netlify Function | Liveness only |

Do not add a catch-all rewrite to `/index.html`: it would hide missing assets and interfere with function routes. Netlify's static file resolution serves the exported `account/index.html` at `/account/`. The callback retains its query string for Supabase's browser PKCE flow. In Supabase Auth URL Configuration, set the production site URL and allow exactly `https://<your-domain>/account/`; add exact preview or local callback URLs only when needed. See [authentication](authentication.md).

## Environment variables

The root `.env.example` lists the supported public values. For local Next.js development, copy the public entries to `apps/web/.env.local`; Next.js runs from `apps/web`. In Netlify, set them in the site's environment variable settings for **Builds and Functions** and trigger a new deploy after changing a `NEXT_PUBLIC_` value, because the browser bundle is compiled at build time.

| Variable | Where used | Required | Meaning |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser build and publishing/share Functions | Only for account or cloud features | HTTPS Supabase project origin; the generated CSP allows only this project's HTTPS and WSS origins |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser build and publishing/share Functions | Alongside URL | Supabase **publishable** key for the public/anon role, subject to RLS and public RPC permissions; legacy JWT anon keys are not accepted by the current client validator |
| `NEXT_PUBLIC_SUPABASE_OAUTH_PROVIDERS` | Browser build | No | Comma-separated configured providers (`google`, `github`, `azure`) |

No protected Supabase key is required by the current Functions. Never set a service-role or Supabase secret key in a `NEXT_PUBLIC_` variable. Keep any future server credential in a Functions-only variable with an appropriate Netlify scope, and do not import it from a client component. No hosted AI provider variable or server AI feature flag is implemented. AI note actions, vault chat, and semantic search currently use explicit local configuration; setting an API key would not enable a hosted provider. The current feature switches are user settings, not deployment environment flags. `NETLIFY_NEXT_PLUGIN_SKIP` and `NODE_VERSION` are fixed build settings in `netlify.toml`.

For optional sync, sharing, publishing, private links, and encrypted cloud backups, apply the required Supabase migrations in order, including `202610020001_noor_backups.sql` for the private backup bucket, and verify RLS against a real project before enabling those workflows. Manual backup works without Supabase. The static app and `/health` work without Supabase; `/p/*` and `/s/*` return 503 when public Supabase configuration is absent.

## Security and caching

`netlify.toml` sends `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options`, and HSTS on static responses. The build-generated `out/_headers` contains a CSP with SHA-256 hashes for the exact inline scripts emitted by Next.js. It allows the configured Supabase origin, local workers, and the model download hosts used by optional local AI. Inline styles support runtime editor styles. The isolated plugin iframe currently needs `data:` scripts; this is a deliberate CSP exception and should be revisited if the plugin transport changes. Published and private pages return their own narrower CSP and no-store headers from their Functions because Netlify static header rules do not apply to Function responses.

`sw.js` is never cached by the CDN, hashed Next.js assets are immutable, and the manifest has a short cache lifetime. The service worker precaches only public shell assets, bypasses `/p/*`, `/s/*`, `/.netlify/*`, and `/api/*`, and does not cache authenticated or private responses. See [PWA](pwa.md) and [security](security.md).

HSTS is set for the current host after HTTPS deployment. The policy does **not** include subdomains or preload, since Noor Note cannot assume control over every subdomain of a custom domain.

## Verify a deployment

Run `corepack pnpm install --frozen-lockfile`, then `corepack pnpm lint`, `corepack pnpm typecheck`, `corepack pnpm test`, and `corepack pnpm build`. The build verifies the app, callback, PWA and public assets, generated service worker, and script hashes. Run `corepack pnpm --filter @noor-note/web test:deploy` to load the exported app, callback, clipper, and active service worker in Chromium with its generated CSP. Run `corepack pnpm --filter @noor-note/web test:e2e` for browser workspace checks.

After deploying, request `/health` and expect HTTP 200 with `{"status":"ok","service":"noor-note"}`. This is a liveness response, not a Supabase dependency check, and reveals no project URL, version, environment, or secret. Check `/account/` with a configured Auth callback, `/manifest.webmanifest`, `/sw.js`, and a representative `/_next/static/` file. With publishing enabled, check `/p/<site>` and `/s/<token>` using test content and confirm private links are not cached. Use Netlify Dev for local Function routing; `next dev` serves the static app routes only. A local build and unit tests do not prove live Netlify or Supabase configuration.
