# Shared activity history

**Status: PARTIAL.** The Activity view shows meaningful events for a signed-in, cloud-synced plaintext vault. Members with read access may browse the feed and filter it by actor, event type, local date range, and note. Events arrive by a private Realtime invalidation and are fetched from Postgres in pages of 50. The feed can open a note that is present locally.

## Event source

Migration `202609300001_noor_activity_history.sql` creates `noor_activity_events`. Database triggers record note creation, rename, move, and Trash restore when a versioned note sync record commits. They compare `title`, `path`, and `deletedAt`; a Markdown-only save, ordinary autosave, delete to Trash, or sync retry does not produce an event. Invitation, member removal, role change, comment insertion, and comment resolution are logged at their database writes. An accepted ownership transfer is not labeled as a member removal.

Restoring a local revision saves the note first, then adds a stable event UUID to an IndexedDB outbox. The sync engine sends the restore event after the note snapshot reaches the server. Offline failures retry with backoff; duplicate RPC delivery is ignored by the event UUID. The event names the source checkpoint but contains no note body or diff. A revision restored while cloud sync is disabled is not recorded in shared activity.

Each event stores actor UUID and email, event type, timestamp, optional note and target user UUIDs, and a small bounded metadata object for readable labels. Comment bodies, Markdown, attachment bytes, and revision content are excluded. Existing events are not backfilled when this migration is applied.

## Access and retention

The client has SELECT access through row-level security only when its current database role may read the plaintext vault. It has no direct INSERT, UPDATE, or DELETE grant. Trigger functions and the revision restore RPC write as server-controlled functions; the RPC checks edit permission and that the note exists in the synced vault. Activity filter option RPCs enforce the same read permission. Private Realtime messages contain only an event ID and trigger a fresh authorized query. The feed is not available for local-only or end-to-end encrypted vaults.

Events currently last until their vault is deleted. There is no retention setting, ZIP export of activity, administrative audit export, historical backfill, or live Supabase project verification. Account deletion behavior and GDPR retention policy need product decisions before treating the feed as an audit system. Local Markdown and revision history remain separate and portable.
