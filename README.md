# Noor Note

Noor Note is a local-first Markdown workspace built with Next.js, TypeScript, Dexie, and CodeMirror. This repository implements the application foundation, a **partial local-first vault engine**, and a **partial Markdown editor**. It runs as a static site on Netlify; notes live in your browser, and no account is required.

## Run

Requires Node.js 24 and Corepack.

```bash
corepack pnpm install
corepack pnpm dev
```

Open `http://localhost:3000`. Use Settings → Export vault ZIP regularly. Clearing browser data may erase local vaults.

## Current features

- Create, switch, rename, delete, and restore vaults; manage nested folders, notes, and attachments in a keyboard-accessible file explorer.
- Edit portable Markdown with CodeMirror in Source, side-by-side Live Preview, or Reading Mode. Use formatting and slash commands, search and replace, document outline, math, diagrams, wiki links, embeds, callouts, footnotes, and editor preferences.
- Open multiple tabs, pin and reorder them, restore a closed tab, and arrange nested vertical or horizontal splits. Inactive panes show synchronized read-only previews. The current layout persists locally, and named Workspaces can be saved, loaded, and exported with a vault.
- Keep note, heading, block, search, Base, Canvas, and web bookmarks in nested groups. Favorite or pin notes, revisit recent notes and searches, and restore recently closed tabs. See [bookmarks](docs/bookmarks.md).
- Link notes with wiki or local Markdown links. Autocomplete inserts stable note IDs; the inspector shows outgoing links, backlinks, and unlinked mentions. Copy block links and preview affected files before a vault-wide rename refactor.
- Browse nested tags with per-note usage counts; filter notes or preview and confirm tag renames, merges, and reference deletion. Edit typed YAML properties in the inspector and define optional property templates in Settings.
- Search offline across titles, paths, Markdown, tags, properties, links, tasks, and headings. Use phrase, prefix, fuzzy, regex, and field filters, or explicitly build a local multilingual semantic index for passage and hybrid search. See [search](docs/search.md).
- Open the quick switcher with Ctrl/Command + O or the command palette with Ctrl/Command + P. Find notes and folders, open notes in tabs or splits, and customize shortcuts in Settings. See [commands](docs/commands.md).
- Explore global and local knowledge graphs with note links, embeds, optional tag and attachment nodes, depth and direction controls, filters, and keyboard-accessible node actions. See [graph](docs/graph.md).
- Organize existing Markdown notes in saved Bases with Table, List, Cards, Gallery, Kanban, Calendar, coordinate Map, Timeline, and Gantt views. Edit properties in the table and move cards between Kanban lanes. See [Bases](docs/bases.md).
- Add safe, read-only Base formulas and view summaries for count, sum, average, minimum, maximum, and unique values. See [formulas](docs/formulas.md).
- Arrange Markdown cards, real notes, attachments, websites, groups, frames, and connectors on a local Canvas. Present frames and import or export JSON Canvas files. See [Noor Canvas](docs/canvas.md).
- Keep reusable Markdown templates in a vault folder. Set default, daily, folder, and Base rules; insert, create, apply properties, or preview a template from the command palette. See [templates](docs/templates.md).
- Plan with month, week, day, and agenda Calendar views across tasks, daily notes, date properties, and Markdown events. Filter by folder, tag, property, task status, vault, or Base; drag or choose a new date to reschedule. Open daily, weekly, monthly, quarterly, and yearly Markdown notes from the same workspace. See [calendar](docs/calendar.md) and [periodic notes](docs/periodic-notes.md).
- Manage Markdown checkboxes in Tasks with dates, priorities, recurrence, tags, assignee metadata, seven dashboard views, and saved filters. Edits update their source notes. See [tasks](docs/tasks.md).
- Review PDFs with local page rendering, text selection, annotations, and links. Extract and correct text from images or scanned PDF pages with offline OCR. See [PDF reader](docs/pdf-reader.md) and [OCR](docs/ocr.md).
- Record voice notes or upload audio and video. Transcribe supported audio tracks with a browser speech model, review timestamped segments, seek playback, and create notes, tasks, or quotes. The model needs a first-use download. See [voice notes](docs/audio-recording.md) and [transcription](docs/transcription.md).
- Set optional AI privacy permissions in Settings. Run 19 note actions through the command palette or note menu using a local browser model. Review the exact text sent to the worker, preview and edit suggestions, then explicitly accept, insert, replace, reject, or undo. The model needs a large first-use download. See [AI foundation](docs/ai-foundation.md).
- Ask the local vault chat about a note, selected notes, a folder, Base results, or the vault. Review retrieved passages before generation, open verified source citations, and optionally save, export, or delete chat history. See [vault chat](docs/vault-chat.md).
- Optionally sign in to a Noor Note account with Supabase Auth when a deployment configures it. Email confirmation, password recovery, magic links, and per-device sign-out are available; local-only use needs no account. Cloud sync is a separate per-vault opt-in with an offline queue for Markdown notes, folders, and attachments. New unsynced vaults can use optional [end-to-end encrypted sync](docs/encryption.md). See [authentication](docs/authentication.md) and [sync protocol](docs/sync-protocol.md).
- Share a plaintext cloud vault through accepted account invitations. Owner, Admin, Editor, Commenter, and Viewer roles are checked in Postgres; members can comment, leave, or offer and accept a guarded ownership transfer. See [sharing and permissions](docs/sharing-permissions.md).
- Review [shared activity](docs/activity-history.md) for meaningful note, membership, comment, and revision-restore events, with filters for user, event, date, and note.
- Capture pages with the [Noor Note web clipper](docs/web-clipper.md), then review and save them to a local vault as Markdown.
- Move items to Trash, restore them, or permanently delete them. Save drafts automatically with local recovery. Browse note [version history](docs/version-history.md), preview and compare checkpoints, restore an earlier state, or duplicate it as a new note.
- Preview Markdown, HTML, CSV, Keep JSON, ENEX text, and portable ZIP imports in the [Import Center](docs/import-center.md), with conflict choices before saving. Import legacy JSON note backups and Noor Note vault ZIPs. Use the [Export Center](docs/export-center.md) for native and portable ZIPs, note Markdown/HTML, a browser print-to-PDF view, a bounded JSON archive, Base CSV, and Canvas JSON; review each format's portability report first. Optionally write files to a connected directory where supported.
- Import [Obsidian-style Markdown vaults](docs/obsidian-vault-import.md) with nested folders, attachments, compatible JSON Canvas, and a downloadable report of unresolved references and unsupported syntax.
- Use the responsive shell, Light/Dark/System themes, search, tasks, and the [installable offline app](docs/pwa.md) after an initial production visit. Noor Note keeps local vault access offline; optional OCR and transcription assets cache after first use.

Cloud sync, [collaboration](docs/collaboration.md), and sharing are **partial** and require the supplied Supabase migrations; they do not have live-project verification yet. Collaboration supports Markdown bodies in shared plaintext vaults. External calendar integration and publishing are **not available**. Accounts require optional Supabase configuration and do not move local data until sync is enabled for a vault. AI note actions and vault chat are partial and use a small local model whose output needs careful review. Bases, Canvas, Calendar, PDF annotations, and transcription remain partial; the [feature matrix](docs/feature-matrix.md) records exact boundaries.

## Verify

```bash
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

The build exports `apps/web/out` and generates `sw.js`. Netlify configuration is in `netlify.toml`.

See [architecture](docs/architecture.md), [data model](docs/data-model.md), [storage](docs/storage.md), [security](docs/security.md), [sync protocol](docs/sync-protocol.md), [accessibility](docs/accessibility.md), [Netlify deployment](docs/deployment-netlify.md), and [development](docs/development.md).
