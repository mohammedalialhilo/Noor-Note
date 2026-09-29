# Noor Note architecture

Noor Note is a static Next.js application with a local-first vault engine. Netlify serves the app shell; normal vault operations use browser storage. Optional Supabase accounts can enable per-vault cloud sync without changing the local write path.

```mermaid
flowchart LR
  UI[Responsive workspace and editor] --> Hook[useVaultWorkspace]
  UI --> Primitives[packages/ui]
  Hook --> Core[packages/core schemas and Markdown]
  Hook --> Repo[VaultRepository interface]
  Repo --> Dexie[(IndexedDB: metadata and note bodies)]
  Repo --> OPFS[(OPFS: larger attachments)]
  Hook --> Archive[ZIP and filesystem adapters]
  Hook --> Search[packages/search in Web Worker]
  UI --> AiPolicy[AI settings and per-request review]
  UI --> Auth[Optional browser Supabase Auth]
  Hook --> Sync[Opt-in cloud sync engine]
  Sync --> Crypto[packages/crypto Web Crypto envelopes]
  Sync --> Queue[(IndexedDB sync queue)]
  Sync --> Cloud[(Supabase records and private Storage)]
  AiPolicy --> AiContracts[packages/ai provider contracts and gateway]
  UI --> Graph[GraphClient and Sigma view]
  UI --> Bases[Bases query and view layer]
  UI --> Canvas[Canvas board and inspector]
  UI --> PDF[PDF.js reader and text layer]
  PDF --> Repo
  UI --> OCR[Browser OCR provider and review panel]
  OCR --> Repo
  OCR --> Search
  UI --> Speech[Transcription review and browser model worker]
  Speech --> Repo
  Speech --> Search
  Canvas --> Core
  Canvas --> Repo
  Bases --> Core
  Bases --> Repo
  Bases --> Search
  Graph --> GraphWorker[Link parsing and ForceAtlas2 in Web Worker]
  Build[Static export] --> SW[Offline shell service worker]
```

| Package | Responsibility |
| --- | --- |
| `apps/web` | Next.js shell, CodeMirror, vault explorer, trash, settings, browser lifecycle, ZIP and directory adapters |
| `packages/core` | Strict UUID domain schemas, safe paths, Markdown frontmatter, checksums, archive manifest |
| `packages/storage` | `VaultRepository`, Dexie schema and migrations, path reservations, revisions, OPFS fallback |
| `packages/search` | Pure query parser, inverted index, matching, ranking, and result excerpts |
| `packages/ai` | Default-off AI policy, provider contracts, note action plans, request scope validation, and approval gate |
| `packages/crypto` | Versioned AES-GCM content envelopes, passphrase and recovery key wraps, device ECDH envelopes |
| `packages/ui` | Reusable accessible controls and overlays |

The tree reads `NoteEntry` metadata and never needs every Markdown body. Opening a note loads its body; full-content search scans bodies on demand. The editor keeps an optimistic selected note, debounces writes, serializes them in this tab, and flushes before navigation or destructive operations. A local draft supports crash recovery. The repository checks revisions before saves to detect a competing tab write.

Version history uses the existing revision table behind `VaultRepository`. The history dialog loads only one note's checkpoints; its line diff is a pure display calculation over saved Markdown. Restore and duplicate are repository operations, and restore writes a new checkpoint in the same IndexedDB transaction as the note update. ZIP archives carry checkpoint JSON separately from canonical `.md` files. See [version history](version-history.md).

The optional account layer uses a single browser Supabase client and a React session observer. Its public configuration is validated at startup; absent configuration leaves the app local-only. The static `/account/` page handles PKCE email and OAuth redirects in the browser. Authentication state is not a gate on `VaultRepository`. The separate sync engine discovers local changes, queues them in IndexedDB, and sends them only for vaults explicitly enabled by the signed-in account. See [authentication](authentication.md) and [sync protocol](sync-protocol.md).

Encrypted sync keeps the local repository and local queue unchanged. `CloudSyncEngine` seals a queued record at the upload boundary and opens a remote record before validating and applying its domain object. The cloud vault's encryption mode is immutable; a locked key prevents sync instead of falling back to plaintext. Attachment bytes are encrypted before Supabase Storage upload and decrypted after download. A separate IndexedDB database stores only wrapped local key profiles. See [encryption](encryption.md).

Vault, folder, note, and attachment operations remain behind `VaultRepository`. ZIP export/import and optional connected-directory writes are separate web adapters. The directory connection is a manual export, not a bidirectional mirror. Markdown remains the canonical note source. Bases use the generic structured-object store for saved configuration; rows are ordinary Markdown notes.

The desktop shell has an activity rail, sidebar file explorer, editor/workspace, optional inspector, and status bar. Mobile uses a drawer, bottom navigation, and separate list/editor presentation. The workspace holds a versioned tree of panes and tabs; it supports nested vertical and horizontal splits, tab ordering, pinning, closing, and restoring a closed tab. Only the active pane has a writable CodeMirror editor. Other panes render the current saved or optimistic note state, including when the same note is open twice. The current layout is kept per vault in localStorage; named snapshots are validated Workspace records in IndexedDB and travel with full-vault ZIP exports. See [workspaces](workspaces.md). Bases, Canvas, and Calendar have workspace views; the PDF reader is a workspace overlay opened from attachments and Markdown links. Optional AI note actions use a local browser worker through the provider-neutral gateway; external assistant providers and collaboration remain planned extension points. See [AI foundation](ai-foundation.md) and [feature matrix](feature-matrix.md).

`PdfReader` uses PDF.js and its worker for page rendering and text extraction. `PdfPage` owns the selectable text layer and normalized selection coordinates. `PdfAnnotationsStore` owns validated sidecar records in the repository object table. `packages/core/src/pdf-reference.ts` defines portable Markdown links, stable ID resolution, and backlink scanning. This keeps PDF bytes, note Markdown, and Noor annotation metadata separate. See [PDF reader](pdf-reader.md).

`OcrProvider` is an interface separate from the review UI and storage. The initial browser provider uses locally packaged Tesseract.js assets; no server OCR is configured. `OcrStore` stores page-level sidecars, and `SearchClient` adds their corrected text to the existing worker index as attachment results. The review panel can process a raster image or rasterize a PDF page locally. See [OCR](ocr.md).

`TranscriptionProvider` separates speech recognition from transcript review and storage. The browser provider decodes supported media audio into 16 kHz samples and sends samples to a dedicated same-origin worker running Transformers.js and Whisper. The first use downloads model weights, while the WebAssembly runtime is part of the static build. `TranscriptStore` persists validated attachment sidecars; the existing search worker indexes corrected segments with seek timestamps. See [transcription](transcription.md).

`BookmarksStore` validates typed targets and group ancestry before writing vault-scoped bookmark records. The bookmarks panel resolves note, heading, block, search, Base, Canvas, and HTTP(S) URL targets. Favorites and pinned notes are bookmark flags. Recent notes and searches are local browser preferences, while closed-tab history is stored with the workspace layout. See [bookmarks](bookmarks.md).

`packages/core/src/editor-markdown.ts` owns pure outline, wiki-reference, embed, and document-stat transforms. `apps/web` owns editor behavior and display rendering. Source Markdown remains canonical; Source, Live Preview, and Reading switch between CodeMirror and a derived rendering without rewriting the note. Editor preferences are validated and stored in browser localStorage. Reading loads local attachments and whole-line note embeds through the repository; CodeMirror keeps syntax, history, and search state in the current session.

`packages/core/src/link-engine.ts` parses local links with source offsets and resolves them against stable note IDs, paths, titles, and aliases. New autocomplete links carry a portable HTML comment containing the target UUID immediately after readable wiki syntax. The inspector loads note bodies on demand to calculate backlinks, heading and block status, and unlinked mentions. It does not create a background full-text index. The repository applies a confirmed rename and its link edits in one IndexedDB transaction after checking the previewed revisions.

`packages/core/src/note-refactor.ts` plans note composition as a pure transform over loaded note bodies. The web composer presents the full plan before writing. `VaultRepository.applyNoteRefactor` validates all active note revisions, reserves new paths, and commits new notes, edited bodies, and revision checkpoints in one IndexedDB transaction. Canvas card conversion writes a validated Canvas document after checking the source revision. See [note composer](note-composer.md).

`apps/web/src/hooks/useAudioRecorder.ts` owns the browser microphone and `MediaRecorder` lifecycle; `AudioRecorder` handles local draft and saved attachment workflows. Recording metadata is an optional validated part of `Attachment`, while audio bytes use the existing IndexedDB/OPFS adapter. Saved note links remain plain relative Markdown. The core attachment-link planner and repository transaction preserve ordinary note links when recordings are renamed through the voice-note dialog. Transcription sidecars reference the attachment UUID. See [voice notes](audio-recording.md).

`packages/core/src/metadata.ts` owns YAML property parsing, typed input validation, and targeted frontmatter updates. `tag-engine.ts` derives hashtags from Markdown and YAML, builds nested counts from note summaries, and plans rename, merge, or removal operations. The tag sidebar renders derived counts; a confirmed tag operation loads bodies on demand and commits affected notes in one revision-checked IndexedDB transaction. Optional property templates live as validated `metadataSchema` objects in the generic object store. They apply only when the user requests defaults in the property panel.

The service worker caches static shell assets only. It does not back up notes. Future sync must keep local writes independent of network status and distinguish local durability from remote acknowledgement. See [sync protocol](sync-protocol.md).

Search uses a Web Worker bundle generated with esbuild before the Next.js build. `SearchClient` compares repository note revisions for each query, fetches only changed bodies, and sends updates to the worker. The worker owns the in-memory inverted index and returns ranked results. This avoids blocking the UI during parsing and tokenization and avoids rescanning all bodies on every keystroke. A main-thread fallback supports browsers without workers. The service worker precaches the search bundle for offline use. See [search syntax](search.md).

Semantic search uses a separate worker and Dexie database so the lexical index remains usable while a local model downloads or runs. `packages/search/src/semantic-engine.ts` owns passage segmentation, fingerprints, similarity ranking, and hybrid fusion. `SemanticSearchClient` compares vault note revisions and transfers changed bodies only; the worker reuses unchanged passage vectors by fingerprint. The pinned multilingual E5 model runs through Transformers.js and same-origin ONNX WebAssembly assets. The generic `EmbeddingProvider` contract in `packages/ai` remains the extension point for a future provider adapter; no remote adapter is registered. The semantic worker and model cache are derived data, not a vault authority. See [search](search.md).

[Vault chat](vault-chat.md) adds a local retrieval stage before the existing AI gateway. The web retrieval adapter resolves a requested note, selection, folder, Base, or vault to eligible note summaries; the local lexical search client narrows broad scopes before the passage ranker loads at most 12 candidate bodies. It ranks at most four source passages for the reviewed `AiRequestPlan`. `packages/ai/src/vault-chat.ts` validates source IDs and answer citations. The existing local chat provider receives only those passages after per-request approval. Optional conversations live in a separate Dexie database and do not alter notes or the semantic index.

[Knowledge organization](organization.md) is a web-layer local scan over bounded note bodies. Pure planners produce proposed Markdown changes; the repository applies approved changes through its atomic, revision-checked vault edit. Optional model output passes the existing gateway and a constrained, evidence-checked parser before entering the same review flow. No separate content store is introduced.

Keyboard navigation is driven by a shared `CommandRegistry` in the web app. Core commands are declared once; the palette, global hotkey listener, and shortcut settings read the same definitions. An active editor exposes its existing actions through a typed imperative handle, so commands invoke the same implementation as toolbar buttons. The quick switcher uses note and folder summaries rather than loading Markdown bodies. See [commands](commands.md).

The [knowledge graph](graph.md) derives note, tag, and attachment nodes from local metadata and Markdown links. GraphClient fetches changed note bodies on demand and a worker parses links and calculates ForceAtlas2 positions. Sigma renders the graph with WebGL, while React controls filters, local neighborhoods, and the keyboard-accessible node list. The graph does not persist or modify note content.

[Bases](bases.md) use a versioned Zod configuration in `packages/core/src/base-engine.ts`. Selection uses `NoteEntry` summaries; a search expression delegates to the offline search worker. The web Base store persists validated records in IndexedDB. Table and Kanban edits call existing note and property operations, so YAML frontmatter and Markdown remain authoritative. The nine views share the same filtered note collection.

[Noor Canvas](canvas.md) uses pure validated document operations in `packages/core/src/canvas-engine.ts`. The web Canvas store persists documents in the generic IndexedDB object table. The board draws cards in a transformed world and connectors in SVG; the inspector edits one selected object. Note and attachment cards reference vault records, so edits to source notes remain visible. JSON Canvas conversion is isolated in the core engine, including its `noor-note` metadata namespace.

`packages/core/src/formula-engine.ts` tokenizes, parses, and interprets a bounded expression grammar. It uses no JavaScript evaluation. The Base engine compiles saved formulas, evaluates them against primitive note fields and YAML properties, then passes computed values to view filters, sorting, grouping, and aggregates. Formula results remain derived data and are never stored as note properties. See [formula syntax](formulas.md).

`packages/core/src/template-engine.ts` renders variables and a bounded, allowlisted expression grammar. Template sources are regular notes inside a configured vault folder. Vault settings store only rule references for default, daily, folder, and Base creation. `useVaultWorkspace` selects the rule, loads its source Markdown, and passes a path-aware renderer to the repository; the repository reserves the final path and writes the new note and initial revision atomically. The picker shares this engine for preview, insert, create, and YAML property application. See [templates](templates.md).

`packages/core/src/period-notes.ts` owns period boundaries, ISO week numbering, filename/date formatting, validation, and portable frontmatter identity. The workspace hook locates a period by its frontmatter marker and creates one note on an explicit action or when the selected period's auto-create rule is enabled. `calendar-engine.ts` derives calendar entries and ranges from note summaries and validates portable Markdown event inputs. The web Calendar owns month/week/day/agenda interaction and Base filtering; changes go through revisioned note saves. Calendar navigation does not generate dates in bulk. See [calendar](calendar.md) and [periodic notes](periodic-notes.md).

`packages/core/src/task-engine.ts` parses structured metadata from Markdown checkboxes and updates a selected source line by stable task ID, or by checked note/line/text for legacy tasks. It computes the next recurrence instance when the dashboard completes a task. `task-query.ts` filters note-entry task summaries for built-in and saved views. The web Tasks dashboard does not keep a separate task content store; it saves edits through the revisioned note repository. Saved task queries live in vault settings. See [tasks](tasks.md).
