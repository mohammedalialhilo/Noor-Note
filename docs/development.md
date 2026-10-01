# Development

Large-vault benchmark instructions, measured results, and current limits are in [performance.md](performance.md). Keep the opt-in benchmark out of routine unit test timing; use `NOOR_PERF=1` when profiling changes to storage, indexing, tree rendering, graph layout, Bases, tasks, or sync.

Publishing requires the Supabase publishing migration and the two public Supabase environment values. `pnpm --filter @noor-note/web build` creates the public Mermaid and KaTeX assets. Netlify Dev is needed to exercise `/p/*` locally; `next dev` does not run the Netlify Function. The embedded PostgreSQL test `apps/web/test/publishing.test.ts` checks anonymous reads, role-gated writes, and asset revocation.

Private links require `202609300003_noor_private_shares.sql` and PostgreSQL `pgcrypto` in the `extensions` schema. The `/s/*` route uses the same public Supabase environment values. Run `apps/web/test/private-shares.test.ts` for database access checks and `private-share-route.test.ts` for the function gate and cookie flow. Netlify Dev is needed to exercise the route locally.

Use Node.js 24, Corepack, and pnpm from the repository root:

```bash
corepack pnpm install
corepack pnpm dev
```

Open `http://localhost:3000`. Browser origins have separate local vaults. Export a ZIP before clearing site data.

The [Export Center](export-center.md) uses `apps/web/src/lib/export-center.ts` for portability reports and artifact builders. Keep native vault ZIP round trips in `vault-archive.ts`; portable Markdown ZIPs must preserve source paths and bytes. Test all output formats, missing attachment handling, and report wording when adding an adapter. PDF is currently a browser print flow, and JSON archive import is not implemented.

Plugin authors can create a validated local JSON bundle using `@noor-note/plugin-sdk` and install it from Settings → Plugins. Developer mode allows loading a local development bundle and, where file handles are supported, reloading edits from disk during the current app session. The bundle format, permission model, manager controls, and current extension points are documented in [Plugin SDK](plugins.md). Plugin bundles are device-local and are not included in vault ZIP exports.

Theme authors can start with [Amber Paper](../examples/themes/amber.noor-theme.json), then install the JSON package from Settings → Appearance. Accepted tokens, CSS snippet syntax, storage behavior, and security limits are documented in [Themes and CSS snippets](themes.md).

Run the full phase gate:

```bash
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

Vitest covers core parsing and editor Markdown transforms, UI primitives, IndexedDB migrations and file operations, ZIP round trips, editor layout actions, settings persistence, and rendered/editor components. The production build statically exports `apps/web/out`, generates the versioned offline shell service worker and build-specific Netlify CSP, then verifies required deployment assets. `.github/workflows/ci.yml` runs these checks. `netlify.toml` publishes `apps/web/out` and prevents caching of `sw.js`. See [Netlify deployment](deployment-netlify.md) and [PWA](pwa.md).

Place schemas and pure Markdown transforms in `packages/core`; persistence behind `VaultRepository` in `packages/storage`; browser adapters and UI in `apps/web`. Validate external data at runtime and add migration tests for schema changes. Keep note bodies out of file tree queries. Explain unfinished feature boundaries in [feature matrix](feature-matrix.md). Browser review is still needed for keyboard, mobile, storage quota, and offline behavior.

The default Netlify deployment needs no note API or secrets. Optional accounts and sync use public Supabase build variables; see [authentication](authentication.md), [deployment](deployment-netlify.md), and `.env.example`. Apply `supabase/migrations/202609290001_noor_cloud_sync.sql` before enabling sync in Settings. The migration has not been verified against a live project. `@supabase/supabase-js` handles Auth, record RPCs, and private Storage; `@noble/hashes` provides incremental SHA-256 for large Blob streams because Web Crypto digest requires a whole input buffer. No protected key belongs in a `NEXT_PUBLIC_` variable. Test owner isolation and multi-device conflicts against a real Supabase project before deployment. See [sync protocol](sync-protocol.md).

`packages/ai` defines the optional assistant provider contracts, versioned permission policy, bounded request plan, note-action catalog, edit planner, and per-request review gateway. The web app stores AI preferences in this browser and registers a local browser text model for note actions; no external or embedding provider is registered. `scripts/build-search-worker.mjs` also bundles `ai-note-worker.ts` into the same-origin static export. The pinned model weights download only after a reviewed request and are browser cached. Keep protected provider credentials in a future server adapter, with network-body tests before connecting one. Run `packages/ai/test/gateway.test.ts`, `note-actions.test.ts`, and the web AI component tests when changing scope, prompts, or apply behavior. See [AI foundation](ai-foundation.md).

Knowledge organization lives in `apps/web/src/lib/organization.ts` and `OrganizationReview.tsx`. The scanner and edit planner are pure; approved changes use `VaultRepository.applyVaultNoteEdits`. Model output is parsed by `organization-ai.ts` and must quote reviewed source text. Run `apps/web/test/organization.test.ts` and `organization-ui.test.tsx` when changing suggestion logic, preview, acceptance, or undo. See [knowledge organization](organization.md).

Vault chat reuses this gateway and local model. `packages/ai/src/vault-chat.ts` owns the source and answer-citation contract; `apps/web/src/lib/vault-chat-retrieval.ts` owns scoped candidate selection and passage ranking; `chat-history.ts` owns optional local session storage. Keep retrieval limits, exact-content review, and citation verification in sync. Tests cover retrieval bounds, unknown citations, scope permission, history deletion, and the UI approval-to-citation flow. See [vault chat](vault-chat.md).

Editor dependencies have distinct roles: CodeMirror search and language data provide find/replace and fenced-language highlighting; `remark-math`, `rehype-katex`, and KaTeX render math; Mermaid renders diagrams in Reading Mode; `rehype-highlight` colors preview code. React Testing Library and jsdom are development-only dependencies for browser component tests. Mermaid is loaded on demand, though the offline service worker currently precaches the resulting static chunk files.

`packages/search` owns pure offline indexing and query behavior. The web app uses esbuild as a development build dependency to bundle `src/lib/search-worker.ts` into `public/search-worker.js`; the current Next.js static build otherwise emits that worker source as an untransformed TypeScript asset. `pnpm dev` and `pnpm build` generate the bundle before starting Next.js. The file is generated and ignored by Git. Search tests cover syntax, relevance, incremental updates, and 5,000 notes. See [search syntax](search.md).

The same script builds `semantic-worker.js`. It uses the existing Transformers.js dependency and same-origin ONNX runtime assets; model weights are downloaded only when the user starts Semantic or Hybrid search. `packages/search/test/semantic-engine.test.ts` covers passage metadata, fingerprints, ranking, and fusion. Web tests cover revision-based body fetching and worker-level vector reuse in IndexedDB. When changing model, pooling, normalization, or chunk format, update `SEMANTIC_EMBEDDING_VERSION` so old vectors are rebuilt. See [semantic search](search.md#semantic-and-hybrid-search).

The same prebuild script bundles `src/lib/graph-worker.ts` into `public/graph-worker.js`. Graph derivation and ForceAtlas2 layout run in that worker; Sigma loads only when the graph view mounts. Both worker bundles are precached by the production service worker. See [knowledge graph](graph.md).

`tesseract.js` provides the browser OCR worker and multilingual recognition engine; it is loaded only when OCR runs. `scripts/prepare-ocr-assets.mjs` copies its pinned worker and LSTM WebAssembly variants into same-origin public assets before `dev` or `build`. The checked-in English, Swedish, and Arabic `tessdata_fast` models are under `public/ocr/lang`, with their Apache-2.0 license. The production service worker caches the runtime and selected models after first use. To refresh models, run `node apps/web/scripts/fetch-ocr-languages.mjs`, review hashes and licensing, then run recognition and offline tests. Normal builds never fetch models. See [OCR](ocr.md).

`@huggingface/transformers` supplies the browser speech recognition pipeline. Its transitive ONNX runtime WebAssembly files are copied into same-origin assets by `scripts/prepare-transcription-assets.mjs`. The transcript worker is bundled with esbuild alongside search and graph workers because the Next.js static build does not compile source passed through a worker URL. The model itself downloads from Hugging Face on first use and is browser cached; normal builds do not download model weights. Pinning the package avoids runtime asset mismatches. See [transcription](transcription.md).

Link logic is pure and testable in `packages/core/src/link-engine.ts`. The web inspector reads bodies on demand, while the file tree still uses note metadata. Test resolution, renamed IDs, block targets, mention conversion, and the atomic repository rename whenever changing link behavior. The ID annotation format is part of portable Markdown and should remain backward compatible.

Metadata logic is split between `packages/core/src/metadata.ts` and `tag-engine.ts`. Keep YAML updates loss-conscious: preserve unknown fields and unrelated comments, and test against manually edited frontmatter. Test nested tag counts, code exclusion, preview planning, concurrent-edit rejection, and ZIP schema round trips when changing this area. Property templates are optional hints; applying a default must never replace an existing property.

Add new global actions through `commandRegistry.register` with a stable namespaced ID, category, handler, and availability check. Use `CommandContext` for workspace actions; keep hotkeys out of individual UI components. Test default shortcut conflicts and keyboard capture when adding commands. See [commands](commands.md).

Base query, view, and coordinate parsing belong in `packages/core/src/base-engine.ts`; the web store persists the validated definition. Change Base schema versions deliberately and keep old ZIP manifests importable. Test query combinations, view rendering and mutations, and full-vault ZIP remapping when changing Bases. See [Bases](bases.md).

Canvas document operations and JSON Canvas conversion belong in `packages/core/src/canvas-engine.ts`. `apps/web/src/lib/canvases.ts` owns persistence; `CanvasBoard`, `CanvasInspector`, and `CanvasPresentation` own interaction. Update the versioned schema and import compatibility together. Check core operations, store persistence, keyboard behavior, and full-vault ZIP reference remapping when changing Canvas. See [Noor Canvas](canvas.md).

Formula parsing and interpretation belong in `packages/core/src/formula-engine.ts`. Keep its language independent of JavaScript execution and property object traversal. Test precedence, null and date behavior, short-circuiting, malformed syntax, resource limits, and malicious property content. Base formula IDs are stable view field references; update formula deletion cleanup and ZIP tests when adding new view fields. See [formula syntax](formulas.md).

Template parsing and YAML application belong in `packages/core/src/template-engine.ts`. The web picker and settings use the workspace hook rather than writing note bodies directly. Preserve the storage path reservation and revision behavior when changing creation. Test expression safety, YAML preservation, collision-aware filenames, and full-vault ZIP ID remapping. See [templates](templates.md).

Period boundaries, ISO weeks, filename formatting, and YAML markers belong in `packages/core/src/period-notes.ts`. Period settings are validated before saving and during ZIP import. Keep Calendar UI limited to the selected date so navigation cannot create many notes by accident. Test year/week boundaries, leap dates, rename-stable identity, auto-create calls, calendar selection, and ZIP remapping. See [periodic notes](periodic-notes.md).

Task parsing, recurrence, and source-line mutation belong in `packages/core/src/task-engine.ts`; saved-view predicates belong in `task-query.ts`. The storage entry summary uses these parsers, while the dashboard writes through `useVaultWorkspace.updateTask`. Preserve old plain-checkbox syntax and Markdown line endings. Test source conflict checks, recurrence after missed dates, ID assignment, saved-view filtering, and full-vault ZIP settings round trips. See [tasks](tasks.md).

Calendar derivation, local date ranges, event validation, and source-property date moves belong in `packages/core/src/calendar-engine.ts`. The integrated UI filters note summaries and delegates mutations to `useVaultWorkspace`; Base filters reuse the Base query engine. Keep drag and keyboard/touch date changes equivalent. Test date-range boundaries, source-date conflicts, and event Markdown portability. See [calendar](calendar.md).

Workspace snapshot validation and reference reconciliation belong in `apps/web/src/lib/workspace-layout.ts`. Keep saved layouts versioned, validate before loading, and remap references when importing a vault ZIP. `Workspace.tsx` owns the current layout and the manager actions. When adding a new view state, include it in the layout schema, restore path, archive remapping if it contains IDs, and tests. See [workspaces](workspaces.md).

Bookmark target and group validation belongs in `apps/web/src/lib/bookmarks.ts`; keep the UI in `BookmarkManager.tsx`. Persist stable IDs for note and resource targets, constrain external URLs to HTTP(S), and remap all references in full-vault ZIP imports. Do not store recent searches or note history as bookmark objects. See [bookmarks](bookmarks.md).

## Encrypted sync development

`packages/crypto` uses browser Web Crypto for AES-GCM, PBKDF2-HMAC-SHA-256, P-256 ECDH, and HKDF; it introduces no new third-party cipher dependency. Keep its versioned envelopes and authenticated-data fields compatible when changing serialization. `packages/crypto/test/crypto.test.ts` covers passphrase/recovery unlock, tampering, attachment bytes, and device envelopes. `apps/web/test/encrypted-sync.test.ts` verifies the actual sync boundary and second-device recovery. Apply both Supabase migrations in order; the encryption migration fixes a vault's mode at creation. Before deployment, run the live RLS and Storage tests described in [encryption](encryption.md). Do not enable encrypted sync against a project that has only the base sync migration.

## Collaboration development

Apply the collaboration, sharing, and comment SQL migrations after the base sync and encryption migrations. `yjs`, `y-codemirror.next`, and `y-protocols` provide the CRDT, CodeMirror binding, and cursor awareness; the persistent transport uses the already configured Supabase client. Preserve the rule that a collaborative note's Markdown snapshot is synced once before the Yjs document is created, and subsequent Yjs updates are journaled locally before upload. Run `apps/web/test/collaboration.test.ts` for concurrent insert, delete/edit, offline reconnect, and large-note behavior, plus `markdown-editor.test.tsx` for the binding. Verify owner/member RLS, revocation, private Realtime authorization, and Storage policies against a live Supabase project before deployment. See [collaboration](collaboration.md).

## Sharing development

`@electric-sql/pglite` is a development-only embedded PostgreSQL dependency. It runs all six production migrations and realistic Auth, Storage, and Realtime RLS checks in `apps/web/test/sharing-permissions.test.ts` without needing a local Docker daemon. It is not bundled into the web application. Run that test when changing roles, invitations, transfer, comments, activity, Storage paths, or sync RPCs. The test catches SQL name resolution and three-valued boolean mistakes, but still needs a live Supabase check for Auth integration, Storage API behavior, and Realtime policy caching. See [sharing and permissions](sharing-permissions.md) and [activity history](activity-history.md).

The web clipper is a separate workspace. `corepack pnpm --filter @noor-note/clipper-extension build` emits Chromium and Firefox development bundles in `apps/clipper-extension/dist`. Its tests exercise reader cleanup, metadata, selection, and handoff URL validation; `apps/web/test/clipper-import.test.ts` covers local draft recovery and note/attachment saves. Run the full root lint, typecheck, test, and build pipeline before distributing an extension bundle. Mozilla Readability supplies reader extraction; Turndown and its GFM plugin convert cleaned HTML to Markdown. Browser permission and store packaging still need manual verification. See [web clipper](web-clipper.md).

Import adapters and conflict planning belong in `apps/web/src/lib/import-center.ts`; the dialog is only the review and selection surface. Add a fixture under `apps/web/test/fixtures/import-center` for every claimed source format or variant, and cover both inspection and repository commit. Keep source-specific unsupported elements visible in the preview. Check stale-plan rejection and attachment memory behavior when changing ZIP handling. See [Import Center](import-center.md).

Markdown-vault reference analysis belongs in `apps/web/src/lib/obsidian-vault.ts`; keep it read-only and preserve source Markdown. Test aliases, wiki/heading/block links, relative attachment references, ignored code fences, ambiguous targets, and JSON Canvas file cards when changing the analyzer. Canvas files must import after notes and attachments so stable IDs can be attached. See [Obsidian-style vault import](obsidian-vault-import.md).


## Browser accessibility checks

Install Chromium once with `corepack pnpm --filter @noor-note/web exec playwright install chromium`, then run `corepack pnpm --filter @noor-note/web test:e2e`. Playwright starts the web app and checks the core keyboard, reflow, and axe workflows. See [the accessibility audit](accessibility.md) for coverage and remaining manual review.
