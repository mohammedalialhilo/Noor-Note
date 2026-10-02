# Settings architecture

The Settings screen is a category index over existing feature settings. A category can contain direct controls, a link to controls in the relevant workspace view, or a statement that global preferences are not available yet. The category catalog and scope labels live in `apps/web/src/lib/settings-system.ts`.

## Scope and persistence

| Category | Scope | Current persistence and boundary |
| --- | --- | --- |
| General | Device and vault | Active vault is local device state; vault name and statistics come from the local vault repository. PWA installation and readiness are browser state. |
| Appearance, Themes | Device | Light/Dark/System, installed theme packages, and CSS snippets use validated local appearance storage. |
| Editor | Device | CodeMirror defaults use a validated version 1 settings document in localStorage. |
| Files & Links | Vault | File tree sort order is in `Vault.settings`; connected directory handles are local device handles associated with a vault. |
| Search | Vault | Recent and saved searches are vault keyed local history; mode and sort are session controls in Search. There is no global search preference yet. |
| Graph | Vault workspace | Filters and view state live in local workspace layout; graph controls are in Graph. |
| Canvas | Vault workspace | Canvas documents and view controls are managed in Canvas; no global Canvas preference yet. |
| Bases | Vault | Property schemas and Base view configuration are local vault objects. |
| Tasks | Vault | Saved task queries live in vault settings; task view controls are in Tasks. |
| Calendar | Vault workspace | Calendar view state is in the local workspace layout; periodic note rules are vault settings. |
| Templates, Daily Notes | Vault | Template and period rules are validated fields of `Vault.settings`. |
| AI | Device | Validated local AI policy. Provider configuration must be explicit. |
| Sync | Account and vault | Supabase account identity and per-vault IndexedDB sync configuration; encryption keys are managed separately from preferences. |
| Collaboration | Account and vault | Shared-vault membership and invitations are server-authorized records; UI choices are not permission grants. |
| Plugins | Device | Local plugin installation and enablement. |
| Publishing | Account and vault | Explicit public site/page settings on the publishing backend. |
| Privacy | Device and vault | Private share links are server records for the selected vault; local AI policy is under AI. |
| Security | Account and vault | Account controls, per-vault encryption, and cloud role enforcement. Keys and credentials are never stored in the general settings document. |
| Backup | Vault | Manual ZIP and optional encrypted cloud backups. Browser restrictions prevent dependable scheduled local backups. |
| Advanced | Device | Keyboard shortcut overrides in validated local storage. |
| About Noor Note | Device | Static product information. |

## Versioning and migration

The device settings document has a strict Zod schema and a `version` discriminator. The first version holds editor preferences under `noor-note:settings:device`. On first read, the old `noor-note-editor-preferences` record is validated field by field, bounded numeric values are clamped, and a version 1 document is written. The old key remains available for rollback. An unknown future version is not rewritten by an older client. Writes parse the entire document before storage.

Vault settings use the core Zod schema with defaults, validated repository updates, and ZIP round trips. Existing feature stores retain their own validated formats. Account and sharing settings are changed through server-authorized APIs, not through a writable browser preference object. Future settings should declare scope, schema, version, migration, and a consumer before adding a control.

## Current limits

The category index does not yet unify all feature stores into one transactional settings service. Graph, Canvas, Search, Tasks, and Calendar retain contextual controls in their views. Account preferences across devices are not implemented. Editor storage failures are shown in Editor settings; the session remains usable.
