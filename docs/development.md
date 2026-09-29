# Development

Use Node.js 24, Corepack, and pnpm from the repository root:

```bash
corepack pnpm install
corepack pnpm dev
```

Open `http://localhost:3000`. Browser origins have separate local vaults. Export a ZIP before clearing site data.

Run the full phase gate:

```bash
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

Vitest covers core parsing and editor Markdown transforms, UI primitives, IndexedDB migrations and file operations, ZIP round trips, editor layout actions, settings persistence, and rendered/editor components. The production build statically exports `apps/web/out` and generates the versioned offline shell service worker. `.github/workflows/ci.yml` runs the four checks. `netlify.toml` publishes `apps/web/out`.

Place schemas and pure Markdown transforms in `packages/core`; persistence behind `VaultRepository` in `packages/storage`; browser adapters and UI in `apps/web`. Validate external data at runtime and add migration tests for schema changes. Keep note bodies out of file tree queries. Explain unfinished feature boundaries in [feature matrix](feature-matrix.md). Browser review is still needed for keyboard, mobile, storage quota, and offline behavior.

The default Netlify deployment needs no note API or secrets. Optional accounts and sync use public Supabase build variables; see [authentication](authentication.md) and `apps/web/.env.example`. Apply `supabase/migrations/202609290001_noor_cloud_sync.sql` before enabling sync in Settings. The migration has not been verified against a live project. `@supabase/supabase-js` handles Auth, record RPCs, and private Storage; `@noble/hashes` provides incremental SHA-256 for large Blob streams because Web Crypto digest requires a whole input buffer. No protected key belongs in a `NEXT_PUBLIC_` variable. Test owner isolation and multi-device conflicts against a real Supabase project before deployment. See [sync protocol](sync-protocol.md).

`packages/ai` defines the optional assistant provider contracts, versioned permission policy, bounded request plan, note-action catalog, edit planner, and per-request review gateway. The web app stores AI preferences in this browser and registers a local browser text model for note actions; no external or embedding provider is registered. `scripts/build-search-worker.mjs` also bundles `ai-note-worker.ts` into the same-origin static export. The pinned model weights download only after a reviewed request and are browser cached. Keep protected provider credentials in a future server adapter, with network-body tests before connecting one. Run `packages/ai/test/gateway.test.ts`, `note-actions.test.ts`, and the web AI component tests when changing scope, prompts, or apply behavior. See [AI foundation](ai-foundation.md).

Knowledge organization lives in `apps/web/src/lib/organization.ts` and `OrganizationReview.tsx`. The scanner and edit planner are pure; approved changes use `VaultRepository.applyVaultNoteEdits`. Model output is parsed by `organization-ai.ts` and must quote reviewed source text. Run `apps/web/test/organization.test.ts` and `organization-ui.test.tsx` when changing suggestion logic, preview, acceptance, or undo. See [knowledge organization](organization.md).

Vault chat reuses this gateway and local model. `packages/ai/src/vault-chat.ts` owns the source and answer-citation contract; `apps/web/src/lib/vault-chat-retrieval.ts` owns scoped candidate selection and passage ranking; `chat-history.ts` owns optional local session storage. Keep retrieval limits, exact-content review, and citation verification in sync. Tests cover retrieval bounds, unknown citations, scope permission, history deletion, and the UI approval-to-citation flow. See [vault chat](vault-chat.md).

Editor dependencies have distinct roles: CodeMirror search and language data provide find/replace and fenced-language highlighting; `remark-math`, `rehype-katex`, and KaTeX render math; Mermaid renders diagrams in Reading Mode; `rehype-highlight` colors preview code. React Testing Library and jsdom are development-only dependencies for browser component tests. Mermaid is loaded on demand, though the offline service worker currently precaches the resulting static chunk files.

`packages/search` owns pure offline indexing and query behavior. The web app uses esbuild as a development build dependency to bundle `src/lib/search-worker.ts` into `public/search-worker.js`; the current Next.js static build otherwise emits that worker source as an untransformed TypeScript asset. `pnpm dev` and `pnpm build` generate the bundle before starting Next.js. The file is generated and ignored by Git. Search tests cover syntax, relevance, incremental updates, and 5,000 notes. See [search syntax](search.md).

The same script builds `semantic-worker.js`. It uses the existing Transformers.js dependency and same-origin ONNX runtime assets; model weights are downloaded only when the user starts Semantic or Hybrid search. `packages/search/test/semantic-engine.test.ts` covers passage metadata, fingerprints, ranking, and fusion. Web tests cover revision-based body fetching and worker-level vector reuse in IndexedDB. When changing model, pooling, normalization, or chunk format, update `SEMANTIC_EMBEDDING_VERSION` so old vectors are rebuilt. See [semantic search](search.md#semantic-and-hybrid-search).

The same prebuild script bundles `src/lib/graph-worker.ts` into `public/graph-worker.js`. Graph derivation and ForceAtlas2 layout run in that worker; Sigma loads only when the graph view mounts. Both worker bundles are precached by the production service worker. See [knowledge graph](graph.md).

`tesseract.js` provides the browser OCR worker and multilingual recognition engine; it is loaded only when OCR runs. `scripts/prepare-ocr-assets.mjs` copies its pinned worker and LSTM WebAssembly variants into same-origin public assets before `dev` or `build`. The checked-in English, Swedish, and Arabic `tessdata_fast` models are under `public/ocr/lang`, with their Apache-2.0 license. The production service worker precaches the runtime and models. To refresh models, run `node apps/web/scripts/fetch-ocr-languages.mjs`, review hashes and licensing, then run recognition and offline tests. Normal builds never fetch models. See [OCR](ocr.md).

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

