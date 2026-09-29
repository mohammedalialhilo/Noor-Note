# Feature matrix

**NOT STARTED**: no usable feature. **PARTIAL**: a real subset works. **COMPLETE**: bounded behavior works but needs stronger verification. **TESTED**: bounded behavior has relevant automated tests. Broad categories remain PARTIAL when only a subset is tested.

| Category | Status | Current boundary |
| --- | --- | --- |
| Editor | PARTIAL | CodeMirror source editing, side-by-side Live Preview, Reading, formatting and slash commands, find/replace, outline, settings, tabs, nested splits, and source stats; inactive panes show a synchronized read-only rendering, not a second writable editor |
| Files | PARTIAL | Nested vault tree, move, rename, duplicate notes, attachments, Trash; no bulk rename or attachment editor |
| Note composer | PARTIAL | Previewed merge, split, extraction, heading move/duplicate, Canvas cards, and index notes; transactional note changes and stable-reference retargeting tested. Relative attachments and ambiguous external links need review |
| Audio recording | PARTIAL | Microphone capture, pause/resume/stop, draft and saved playback, previewed rename with link updates, note attachment, recording metadata, and ZIP portability; no streaming capture for very long sessions |
| Transcription | PARTIAL | Provider interface, browser Whisper worker, timestamped editable segments, playback seek, note/task/quote/link actions, offline search, and ZIP sidecars; first-use model download, browser format limits, no diarization or browser model end-to-end test |
| PDF reader and annotations | PARTIAL | Local page rendering, navigation, zoom/fit, lazy thumbnails, page text search, selection highlights/comments/quotes, quote notes, stable links, backlinks, OCR entry point, and ZIP sidecars; no painted search matches, PDF-native annotation export, or full accessibility audit |
| OCR | TESTED | Local image and scanned-PDF OCR with English, Swedish, and Arabic models, multi-language selection, review/correction, sidecar storage, offline search, ZIP portability, and browser-provider tests; limited to bundled languages and 100-page batches |
| Links | PARTIAL | Wiki and local Markdown link resolution, stable ID annotations for new links, heading/block status, block link copy, fuzzy autocomplete, backlinks, unlinked mentions, and confirmed rename refactoring; older unannotated links can become ambiguous and the inspector scans note bodies on demand |
| Graph | PARTIAL | Global and local WebGL views, worker layout, note/link/embed/tag/attachment relationships, filters, grouping, zoom, pan, drag, and node actions; positions are session-only and screen reader review is pending |
| Canvas | PARTIAL | Local infinite board, 10 card kinds, links, frames, layout, grouping, undo, inspector, JSON Canvas import/export and presentation; no large-board virtualization, cross-app clipboard paste, or collaboration |
| Databases / Bases | PARTIAL | Saved local queries over Markdown note summaries; nine views, safe computed formulas, and count/sum/average/minimum/maximum/unique summaries with persisted settings. No cross-note formulas, geocoding, or dependency scheduling |
| Search | PARTIAL | Offline lexical worker for notes, OCR, and transcripts; local semantic passage index with explicit model download, revision/fingerprint updates, and hybrid ranking. Semantic excludes OCR, transcripts, lexical filters, and PDF annotations; browser model inference needs device testing |
| Tags | PARTIAL | Body and YAML hashtags, nested counts and filters, previewed rename/merge/delete references; no tag aliases or indexed cross-vault search |
| Properties | PARTIAL | YAML-backed structured editor with supported scalar/list types and optional folder/type/template/Base defaults; nested objects remain Source Mode only |
| Templates | TESTED | Markdown source notes, default/daily/folder/Base rules, variables, safe functions, insert/create/property/preview commands, and ZIP remapping; no cross-vault template library |
| Tasks | PARTIAL | Markdown checkbox dashboard with dates, priorities, tags, assignee text, seven views, saved filters, source edits, stable IDs on edit/explicit assignment, and recurrence on dashboard completion; no notifications or shared identity binding |
| Calendar | PARTIAL | Integrated month/week/day/agenda views for tasks, daily notes, date properties, and Markdown events; vault/folder/tag/property/task-status/Base filters; date drag and accessible date change; no hourly grid, reminders, or external calendar sync |
| Daily and periodic notes | TESTED | Daily, ISO weekly, monthly, quarterly, yearly Markdown notes; configurable folder, filename/date display, template, one-at-a-time auto-create, period navigation, daily calendar; no reminders. Recurring checkboxes are handled by Tasks. |
| Sync | PARTIAL | Opt-in account vault sync for vaults, folders, Markdown notes, and attachments; offline queue, retries, checksum validation, tombstones, server versions, conflict copies, per-vault attachment selection, and optional encrypted wire records tested locally. No live-project verification, resumable large files, structured-object sync, or Yjs collaboration |
| Authentication | PARTIAL | Optional Supabase Auth with email/password, confirmation resend, magic link, password recovery, browser PKCE session refresh, local/global sign-out, and configured OAuth entry points. No cloud vault binding, device list, or live-project end-to-end test |
| Collaboration | NOT STARTED | No realtime editing or Yjs |
| AI | PARTIAL | Default-off policy, 19 note actions, local vault chat, and optional knowledge organization with 11 local suggestion categories, per-item preview/accept/reject, safe batch acceptance, and undo. Model suggestions require exact-content approval and evidence checks. Organization scans are capped at 150 notes; model quality and first-use downloads need browser testing; no external provider |
| Plugins | NOT STARTED | No plugin runtime |
| Publishing | NOT STARTED | No public publishing |
| Security | PARTIAL | Validation, safe path handling, raw-HTML-free preview, publishable-key-only browser auth, owner-scoped RLS, and optional encrypted sync with recovery and encrypted attachments; no live RLS verification, key rotation, shared-vault access, or independent audit |
| End-to-end encryption | PARTIAL | New unsynced private vaults use AES-GCM cloud records and attachments, passphrase/recovery wraps, and tested device-key envelopes; 64 MiB attachment bound, no rotation, member sharing UI, or live-project verification |
| Mobile | PARTIAL | Drawer, bottom navigation, separate list/editor layout; broader touch review pending |
| Accessibility | PARTIAL | Labeled controls, tree keyboard navigation, dialogs; WCAG 2.2 AA audit pending |
| Import/export | TESTED | Vault and folder ZIP round trips, Markdown and attachments; no scheduled backups |
| Local vault storage | TESTED | Migration, paths, nested moves, collisions, Trash, restore, revision snapshots, attachment metadata |
| Version history | PARTIAL | Local checkpoint browser, Markdown and metadata diff, preview, guarded restore/duplicate, and ZIP round trip tested; cloud checkpoint transfer and retention controls are pending |
| Offline shell | TESTED | Static assets precached after first production visit; browser storage still subject to eviction |
| Application shell | PARTIAL | Activity bar, explorer, inspector, status bar, tabs, and nested splits; current layout persists locally and named Workspaces save view state; drag resizing and full window layout are pending |
| Workspaces | TESTED | Save, load, duplicate, rename, delete, startup selection, panel widths, recently closed tabs, missing-resource reconciliation, and full-vault ZIP portability; mobile-specific layout is session-only |
| Bookmarks and recents | TESTED | Typed bookmarks for notes, headings, blocks, searches, Bases, Canvases, and HTTP(S) URLs; nested groups, favorites, pinned notes, recent notes/searches, recently closed tabs, and vault ZIP portability; no cross-vault bookmark library |
| Keyboard navigation | PARTIAL | Quick switcher, command registry and palette, remappable shortcuts, conflict checks, editor/tab/pane commands; plugin runtime and some multi-step dialog commands pending |
| Themes | TESTED | Light, Dark, System with persisted preference |
| UI primitives | TESTED | Controls, menus, dialogs, tabs, command surface, feedback states |
| Error handling | TESTED | Error boundaries and privacy-safe logging; storage errors shown in workspace |

Structured Tag, Property, Link, Task, Canvas, Base, Template, Bookmark, Workspace, Comment, and UserPreference records have validated schemas and generic storage. Bases, Canvas, templates, bookmarks, tag references, and note properties have the workflows described above; other product workflows remain **NOT STARTED** unless described in the table.
