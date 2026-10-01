# Data model

A Base definition includes one form configuration: target folder ID, optional note template ID, filename template, default properties, and stable field IDs with type and validation rules. A submission creates an ordinary note and optional Attachment records; there is no separate proprietary response record. Full-vault ZIP import remaps the folder and template IDs.

StudyCard is a vault-scoped local object with a stable ID, source note ID, source line/kind/key, card kind, prompt, answer, due time, interval in days, ease, repetition count, last review, and review history. A Review records a rating and the prior and next interval/ease. The source note remains the Markdown origin; card text is a snapshot for consistent reviews.

Publishing adds `noor_public_sites` (one per synced vault) and `noor_public_pages` (one explicit snapshot per published note). The page stores a public slug, title, copied note body, selected image IDs, and timestamps; it does not replace the local Markdown note. The site stores branding, navigation, theme, homepage, graph, and robots settings. See [publishing.md](publishing.md).

Private sharing adds `noor_private_shares` for a single note snapshot, SHA-256 link verifier, optional bcrypt password verifier, expiration, download setting, and revocation time. `noor_private_share_sessions` stores hashed, time-limited password-session verifiers. Neither table is anonymously readable; recipients access snapshots only through a validating RPC. See [private-share-links.md](private-share-links.md).

An `Attachment` may carry `recording: { recordedAt, durationMs }`. The audio MIME type and byte size remain the normal attachment fields. Notes link to recordings with portable relative Markdown paths. A separate transcript refers to the attachment's stable `id` without extending the recorder state.

Note refactoring does not add a proprietary content type. A preview is a temporary plan of Markdown note creations and edits. New notes receive stable UUIDs, normal vault paths, checksums, and initial revisions. Moved heading and block links use the existing ID annotation in portable Markdown to resolve their destination after a move. Canvas selection creates ordinary Canvas text nodes that copy Markdown.

`packages/core/src/vault-domain.ts` defines strict Zod schemas for Vault, Folder, Note (`VaultNote` in TypeScript), Attachment, Tag, Property, Link, Task, Canvas, Base, Template, Bookmark, Workspace, Revision, Comment, and UserPreference. Every object has a stable UUID. Files belong to a vault; folders form a parent tree. Deleted files retain `deletedAt` and `trashGroupId` until permanently removed.

## Canonical note

| Field | Meaning |
| --- | --- |
| `id`, `vaultId`, `folderId`, `path` | Stable identity and location; paths are vault-relative, such as `/Research/Plan.md` |
| `title`, `markdown` | Display title and canonical portable Markdown source |
| `createdAt`, `updatedAt`, `deletedAt` | ISO timestamps and trash state |
| `aliases`, `properties` | Validated frontmatter data |
| `revision`, `checksum` | Local optimistic concurrency number and SHA-256 of Markdown |
| `trashGroupId` | Root of a deleted folder subtree or individually deleted item |

Paths are unique per active vault under Unicode normalization and case folding. A file operation reserves the destination path transactionally; a collision fails instead of overwriting another file. Paths may change, IDs do not. Relative attachment references in Markdown resolve from the note's directory.

The `noteEntries` table stores titles, paths, excerpts, tags, links, and task summaries without Markdown bodies. `noteBodies` stores source Markdown separately. Tags, wiki and local Markdown links, and Markdown checkboxes are derived summaries. The generic object table persists Base query/view configurations, versioned Canvas documents, and PDF annotation sidecars; Base rows and Canvas note cards reference regular notes. Shared comment threads and messages are cloud records outside Markdown; note, Canvas, and PDF targets use stable UUIDs and optional anchors. See [comments](comments.md).

Shared `noor_activity_events` are server-side metadata records with stable UUID, vault and actor IDs, event kind, timestamp, optional note and target-user IDs, and bounded display details. They do not hold note bodies or comment text. An IndexedDB revision-restore outbox holds event UUIDs until cloud acknowledgement. See [activity history](activity-history.md).

A `WebClip` is a versioned transfer object with source URL, capture mode, selected page metadata, Markdown, optional highlights, and optional bounded screenshot bytes. The extension keeps it temporarily for origin-scoped handoff. The web app stages it in a separate IndexedDB inbox until saved or discarded. Saved clips become ordinary Markdown notes, frontmatter, and optional attachments; no proprietary clip record is required for the vault. See [web clipper](web-clipper.md).

Cloud sync records use the same stable vault, folder, note, and attachment IDs. Each remote record has a server version, sequence, operation revision UUID, checksum, device UUID, and validated snapshot. Permanent deletion leaves a local tombstone snapshot so other devices can learn the deletion after the item leaves the active tables. The sync queue and server ledger are operational state, not canonical note content. See [sync protocol](sync-protocol.md).

For an encrypted cloud vault, the remote payload keeps only kind and routing UUIDs outside a versioned AES-GCM box. The box contains the ordinary validated sync snapshot. The encrypted vault record also carries a recovery envelope; encrypted attachment records carry a ciphertext checksum used to locate opaque Storage bytes. Local vault objects retain their portable plaintext schema. See [encryption](encryption.md).

For a collaborative note in a plaintext shared vault, `VaultNote.collaborative` marks the switch from note snapshot updates to a Yjs document. Postgres stores one initial Yjs update and an append-only ordered update log with stable update IDs. IndexedDB stores applied updates, unsent updates, and the highest fetched sequence. These are sync metadata; the local `VaultNote.markdown` remains the portable source for Markdown export. See [collaboration](collaboration.md).

A `PdfAnnotation` stores `id`, `vaultId`, `attachmentId`, one-based `page`, `kind`, selected `quote`, `comment`, `color`, normalized `rects`, and timestamps. Its UUID and attachment UUID are stable within a vault. Note links remain standard Markdown URLs to a PDF path, with `page`, `noor-pdf`, and optional `annotation` fragment fields. ZIP import assigns new IDs and rewrites these fragment IDs in imported notes. The PDF bytes are separate and unchanged. See [PDF reader](pdf-reader.md).

An `OcrRecord` stores one attachment page's stable ID, attachment ID, page number, provider ID, language codes, raw detected text, corrected text, confidence, and timestamps. It is a sidecar object; no OCR text is written into the image, PDF, or a note without a separate user action. ZIP import remaps the attachment and record IDs. Search uses corrected text and returns an attachment/page target. See [OCR](ocr.md).

A `Transcript` stores one media attachment's stable ID, attachment ID, provider ID, optional language, combined corrected text, and timestamped segments. Each segment has a stable ID, time range, text, nullable speaker, and nullable confidence. The sidecar leaves source bytes untouched; ZIP import remaps attachment, transcript, and segment IDs. See [transcription](transcription.md).

Hashtags such as `#work` and `#work/meetings` are derived from body text, the YAML `tags` field, and YAML fields explicitly typed as `tag`. Code spans, fenced code, and YAML comments are excluded from body scanning. The tag tree counts each note once per tag prefix; `#work/meetings` contributes to the `work` count. Renaming or merging a tag rewrites its Markdown and YAML references after a preview. A `metadataSchema` object stores optional field definitions for a folder, a YAML `type`, `template`, or `base` selector. Schema IDs are stable in the vault; ZIP import assigns fresh IDs and remaps folder selectors.

The property panel edits the note's YAML frontmatter directly. It supports text, number, boolean, date, datetime, HTTP(S) URL, email, single or multi select, tag, wiki note reference, list, location, color, and half-step rating values. `noor_property_types` and `noor_property_options` are optional portable YAML hints for values whose type or choices cannot be inferred reliably. Unknown YAML fields remain in source; nested mapping fields are shown read-only in the panel and can be edited in Source Mode. Targeted edits preserve unrelated YAML keys and comments where the YAML library can retain them. Properties remain optional on ordinary notes.

Search documents are derived from canonical notes and saved OCR and transcript sidecars at query time and held in memory for the browser session. Note documents include title, path, Markdown, tags, properties, outgoing link targets, task text, headings, timestamps, and an attachment-reference flag. OCR documents include the source attachment path, page, language metadata, and corrected text. Transcript documents use one segment per result with its source attachment and start time. The search contract reserves optional derived text for future PDF annotation indexing. No search index table or migration is required in the current storage version.

Semantic search has a separate derived cache. Each passage record has a generated cache ID, vault and note UUIDs, note title and path, heading and optional block ID, Markdown character range and source line, text, SHA-256 fingerprint, embedding version, and a 384-number vector. A companion note-cache record stores its last indexed revision and embedding version. These records are not canonical note data and are not in vault ZIPs. Changing a note path updates passage metadata on its next revision even when the text vector is reusable.

Vault chat source records contain a request-local label (`S1`–`S4`), vault/note UUIDs, note revision, title/path, heading or block reference, Markdown range and line, and the exact retrieved excerpt. Assistant messages retain only verified source records. An optional browser chat session has a stable UUID, vault UUID, title, timestamps, and validated user/assistant messages. Chat sessions are not Markdown notes or Base rows. They are excluded from vault ZIPs and can be downloaded as JSON from the chat view.

Command definitions are application code with stable string IDs. Shortcut overrides and recent note IDs are validated per-browser preferences in localStorage, separate from vault content. A versioned Workspace layout stores pane and tab IDs, active note, sidebars and widths, Graph controls, Canvas and Base tabs, and Calendar state. The current layout and startup Workspace ID are per-browser preferences; named Workspace snapshots are vault objects in IndexedDB and ZIP exports. Opening a note through the quick switcher updates the live pane tree.

The optional AI permission policy is a versioned per-browser preference, outside vault data and ZIP exports. An AI request plan is temporary: it lists the chosen provider, recipient, scope, prompt, and exact note Markdown or selected excerpt for one reviewed invocation. A generated suggestion and edit preview are temporary until accepted. Accepted Markdown edits update ordinary notes through CodeMirror autosave and revision history; suggested titles use the same note save path. No assistant conversation or embedding records are stored in this phase. See [AI foundation](ai-foundation.md).

Bookmark records have a kind, stable vault-local target ID or URL/query, optional parent group ID, title, and favorite/pinned flags. Note, heading, and block bookmarks store note IDs rather than paths. The group graph is validated against cycles by the bookmark store. Recent notes and searches are capped per-vault browser preferences; recently closed tabs are part of the versioned workspace layout. See [bookmarks](bookmarks.md).

The editor stores no alternate rich-text document. Reading and Live Preview derive display copies from Markdown; wiki links, whole-line note embeds, callouts, and `==highlight==` are transformed only for display. Fenced code is left literal. Tabs and panes are ephemeral UI state, while font, wrapping, line numbers, spelling, and focus preferences are kept in localStorage. These preferences are separate from vault content and are not included in vault ZIP exports.

An internal wiki link may carry a stable ID annotation: `[[Plan]]<!-- noor-note-id:UUID -->`. This remains human-readable Markdown and survives export. The ID controls resolution if a title or path changes; the visible target remains editable. Older links without this annotation resolve by path, title, then alias. Renaming keeps the old title as an alias, but an unannotated link can become ambiguous if another note claims that title. A block ID appears at the end of a Markdown line as `^b-UUID`; copying a block link adds the ID if needed. Ignored unlinked mentions are personal browser preferences in localStorage, outside vault ZIP exports.

Each meaningful note save advances `revision` and stores a validated checkpoint with Markdown, checksum, title, path, and (for new checkpoints) folder, aliases, and properties. Autosaves within a five-minute window replace the latest autosave checkpoint; explicit rename, move, restore, and folder move add separate checkpoints. Older checkpoints without metadata remain readable. The history dialog previews, compares, restores, and duplicates these records. See [version history](version-history.md).

## Portable formats

Single notes download as `.md`. The source may include YAML frontmatter, which is parsed with alias expansion disabled and a size limit. A vault ZIP contains real Markdown paths, attachment files, and `noor-note.json` manifest version 1 with metadata. Import validates the manifest, paths, sizes, and note checksums, then creates a separate vault. A folder ZIP rebases that subtree to its own root. Individual Markdown, legacy JSON note backups, and dropped folders are also accepted.

The optional manifest `revisions` list points to separate `.noor-history/UUID.json` entries. Import checks each archived snapshot and remaps its stable relationships into the new vault. The current `.md` file remains authoritative; history is an additional portable backup.

Vault ZIP manifests may include `metadataSchemas`. Older manifests without this field remain valid. A folder ZIP includes schemas for folders retained in the rebased subtree; a schema attached to the exported folder root is omitted because that folder becomes the vault root on import.

Full vault ZIP manifests may also include `bases`. Import validates each versioned definition, assigns a new Base ID, and remaps its query folder ID and Base-scoped schema selector. Older manifests without Bases remain valid. Folder ZIPs omit Bases because their queries can depend on notes outside the exported subtree. See [Bases](bases.md).

Canvas documents have `version`, `nodes`, `edges`, `viewport`, `grid`, and `frameOrder`. Each node and edge has a stable UUID. A note or attachment card stores its referenced vault object ID and a portable path fallback; group membership points to a group node ID. Full vault ZIP import remaps note and attachment IDs after recreating the files. Standalone `.canvas` export maps the document to JSON Canvas, with Noor fields under `noor-note`. See [Noor Canvas](canvas.md).

Each Base definition can include named formulas with stable UUIDs and expression source. A formula field is addressed as `formula:UUID`; saved views may refer to it without depending on its display name. View summaries store operation, optional field, and label. Formula values and aggregate results are calculated from note summaries and are not added to Markdown or IndexedDB note bodies. See [formula syntax](formulas.md).

A Chart is a Base view with saved chart type, group/value or X/Y fields, aggregation, group sort, display limit, and histogram bin count. It inherits the Base query and view filters. Rendered series, points, and KPI values are derived and are never stored as a second copy of note properties. See [Charts and analytics](charts.md).

Dashboards have stable IDs, a vault ID, name, optional source template, and ordered widget records. Each widget stores its kind, order, width, height, hidden state, item limit, and optional Base ID. These records configure views over existing vault data; they do not duplicate note, task, or event content. Full-vault ZIP import assigns new dashboard and widget IDs and remaps Base IDs.

Vault settings include `templates`: a source `folderId`, default and daily source note IDs, and maps from destination folder and Base IDs to source note IDs. The source Markdown is a normal `VaultNote`, not a second content format. A full-vault ZIP recreates source notes and remaps all template references to imported IDs. Applying a template creates an ordinary revisioned note; the rendered output has no runtime dependency on its source template. See [templates](templates.md).

Vault settings also include `periodNotes` rules for daily, weekly, monthly, quarterly, and yearly notes. Each stores a folder ID, filename format, display date format, optional template note ID, and auto-create flag. A created note has `noor_period_kind` and `noor_period_key` YAML fields. The key is a canonical local calendar date, ISO week, month, quarter, or year, independent of the configured filename. ZIP import remaps rule folder and template IDs; Markdown markers remain portable. See [periodic notes](periodic-notes.md).

Tasks are derived from Markdown checkbox lines, not rows in a second database. Each `NoteEntry` caches task summaries with note ID supplied by the containing entry, source line, optional block ID, stable task ID comment when assigned, status, dates, priority, recurrence, tags, assignee text, and parser issues. Dashboard edits add `<!-- noor-task-id:UUID -->` on first edit. A vault setting stores saved task view IDs, names, and validated queries; full-vault ZIP export includes them. Legacy tasks without a comment use note/line/text until their IDs are assigned. See [tasks](tasks.md).

Calendar items are derived from `NoteEntry` metadata and tasks. Events are ordinary Markdown notes marked by `noor_event: true` with `date`, optional `end_date`, and optional time fields in YAML. Date-property items reference their source note ID and property key; tasks reference their source note ID, line, and optional stable task ID. No second calendar-content table is used. See [calendar](calendar.md).

`packages/core/src/note.ts` and the legacy `DexieNoteRepository` export remain for version-1 import and migration tests; they are not the current app storage API. The workspace uses `VaultNote` and `DexieVaultRepository`; the version-1 Dexie upgrade migrates old notes into a default vault while preserving note IDs and Markdown.
