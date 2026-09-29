# Cloud sync protocol

**Status: PARTIAL.** Cloud sync is opt-in per signed-in vault. The current implementation synchronizes vault, folder, note, and attachment records. New unsynced vaults may opt into end-to-end encryption before their first upload. Collaboration, Yjs documents, other structured objects, key rotation, large-file resumable uploads, and live-project end-to-end verification remain open.

## Deployment

Apply the [base sync migration](../supabase/migrations/202609290001_noor_cloud_sync.sql) and then the [encryption migration](../supabase/migrations/202609290002_noor_e2ee.sql) to the same project configured for Auth. They create owner-scoped vaults, immutable encryption mode, versioned records, an idempotent push RPC, RLS, and a private attachment bucket. The browser uses only the public publishable key. In Settings, sign in and explicitly enable sync for each vault. A second device can browse and recover an encrypted remote vault with its recovery code. Pausing sync keeps local data and the queue.

## Local write path

Editing writes to the existing Dexie vault repository first. It never waits for a cloud request. A separate `noor-note-sync` IndexedDB database stores a stable device UUID, per-account/vault preferences, a coalescing queue with operation UUIDs and revision UUIDs, server versions, pull cursor, and cached attachment SHA-256 values. Changes are detected from note summaries, then changed bodies are loaded on demand. The engine runs after local tree changes, on a timer, when the page becomes visible, and when connectivity returns. Failed operations remain queued with bounded exponential backoff.

The queue is not in the same transaction as the local edit. Startup and periodic reconciliation reconstruct missed queued changes from the durable vault state. Permanent note, folder, and attachment deletion now retains a redacted local tombstone in the same vault transaction as the final delete, so a crash before queueing still leaves a deletion to send. The tombstone contains an ID and deletion state, not deleted Markdown or attachment bytes. Other devices purge their local item after applying it. Deleting a whole vault permanently is not yet a cloud deletion protocol.

## Remote write and pull

The `noor_push_sync_record` RPC checks the authenticated vault owner, record identity and size, then locks one record key. An operation UUID is idempotent. A client sends its expected server version; the server either advances the version and global sequence or returns the current record as a conflict. Clients pull by sequence and validate every record and checksum before applying it. A pull cursor advances only after its local application. Realtime may later prompt a pull, but the database sequence is the source of truth.

Each attachment is uploaded separately to the private `noor-note-attachments` bucket under `owner/vault/attachment/checksum`. SHA-256 is calculated as Blob stream chunks; the client checks downloaded bytes before storing them. A failed attachment upload leaves that item queued while note and folder operations continue. Attachment metadata may point only to the immutable checksum path once bytes are uploaded. Attachment sync can be disabled per vault; enabling it later resets the pull cursor to fetch skipped attachment records.

## Conflicts and boundaries

When a plain Markdown note has both a local and remote change, the local content is copied to a new normal Markdown note with a conflict suffix before the original stable ID adopts the server version. The copy is queued for sync on the next pass. Remote metadata wins a version conflict; a locally changed attachment is copied before its remote version is applied. These rules are deterministic at the record level and preserve note text, but folder/path collisions can still require manual resolution and surface as sync errors. The server never chooses by client timestamp alone.

Remote records are currently whole snapshots, not operation transforms. Yjs collaborative editing is **not enabled**. A later collaboration mode must persist authorized Yjs updates and compact them into portable Markdown checkpoints, with its own migration and conflict tests. Current ordinary note sync is version checked snapshot sync.

Local note checkpoints now have a validated schema with optional `origin` and `deviceId` fields for future cloud history records. The server operation revision UUID is distinct from a checkpoint UUID. Current sync still transfers only the latest note snapshot and does not transfer the local history table; a second device cannot browse earlier checkpoints from the first device. See [version history](version-history.md).

Sync does not currently include Bases, Canvas, templates as separate objects, bookmarks, workspaces, OCR, transcripts, annotations, chats, semantic vectors, or AI preferences. Notes used as templates are ordinary Markdown notes and do sync. Superseded attachment blobs and retained server operation history need a deletion and retention policy. Ordinary cloud vaults remain readable to the authorized Supabase project; encrypted vaults upload only authenticated ciphertext and routing metadata. The local queue retains plaintext until its item is acknowledged. ZIP and Markdown export remain portable plaintext backups. A deployment must validate SQL migrations, RLS policies, Storage permissions, multi-device conflict behavior, encrypted recovery, and upload limits against a live Supabase project before treating sync as production verified. See [encryption](encryption.md).
