# Sharing and permissions

**Status: PARTIAL.** Noor Note shares an entire plaintext cloud vault, including its notes and attachments, with verified Noor Note accounts. Folder and individual note grants are reserved for a future path-aware policy; `noor_has_scope_permission` denies those scopes today. Encrypted vaults remain private until shared-key distribution is implemented.

Apply [database security migration 202610010001](../supabase/migrations/202610010001_noor_database_security.sql) after the publishing and private-share migrations. It removes execute access from the old immediate-add member RPC; use invitations and recipient acceptance. It also lets Auth deletion revoke memberships without historical author references blocking the deletion. See the [database security audit](database-security.md).

Apply [sharing migration 004](../supabase/migrations/202609290004_noor_sharing_permissions.sql) after the first three cloud migrations, then [comment migration 005](../supabase/migrations/202609290005_noor_comment_threads.sql) and [activity migration 006](../supabase/migrations/202609300001_noor_activity_history.sql). Existing accepted collaborators retain the `editor` role. These migrations add database-derived roles, pending invitations, threaded comments, shared activity, guarded ownership transfer, and an immutable `storage_owner_id` so attachment paths survive a change of owner.

| Role | Read vault | Comment | Edit notes and attachments | Invite and manage members | Transfer ownership |
| --- | --- | --- | --- | --- | --- |
| Owner | Yes | Yes | Yes | All roles | Offer to accepted member |
| Admin | Yes | Yes | Yes | Editor, Commenter, Viewer | No |
| Editor | Yes | Yes | Yes | No | No |
| Commenter | Yes | Yes | No | No | No |
| Viewer | Yes | No | No | No | No |

The owner invites an existing, email-verified account from Settings. An invitation expires after seven days and grants **no access** until the recipient accepts it in Settings. The recipient can decline; an owner or eligible admin can revoke it. There is no outbound email delivery yet. A removed member or a member who leaves loses new database and Storage access immediately. Already downloaded local bytes cannot be recalled. Realtime channel authorization is cached during a connection and may persist until JWT refresh or disconnect; deploy with short JWT lifetimes and verify revocation on the target Supabase project.

Role checks run in Postgres from `auth.uid()` inside row-level security and narrowly granted `SECURITY DEFINER` RPCs. Browser role state controls presentation only. Sync writes, Storage reads/uploads, collaboration update appends, Realtime Broadcast, comments, and activity reads each check the actual vault record and the current role. Knowing a vault, note, or object ID is insufficient. The SQL regression test runs all six migrations in PGlite with two isolated vaults and separate identities; it covers guessed IDs, direct table access, RPC escalation, comment authorship and moderation, activity read/write authorization, Storage paths, Realtime write denial, membership revocation, and transfer. This embedded test does not replace a live Supabase integration test.

Only the current owner can offer ownership to an accepted member. The recipient must accept within seven days. On acceptance, a transaction locks the vault, changes `owner_id`, removes the recipient's former membership row, adds the former owner as Admin, and preserves `storage_owner_id`. The owner can cancel a pending offer. Encrypted vaults cannot transfer because the new owner would need a safe key handoff and recovery design.

The browser currently blocks note editing for Viewer and Commenter and provides shared comment panels for notes, Canvas, and PDF annotations. Other local-only surfaces can still change the downloaded browser copy; server policy will refuse synced changes. Treat this as a read-only UX limitation and avoid presenting local edits as synced. Shared comments are plaintext cloud records, limited to plaintext vaults. They are outside portable Markdown and are not yet included in ZIP export or offline sync. See [collaborative comments](comments.md) for anchor and target limitations.

Folder and note-specific sharing requires stable server-side ancestry, effective-role precedence, and RLS on every content and attachment path. The current `noor_has_scope_permission` accepts only an exact vault scope and fails closed for `folder` and `note`. Do not enable narrower grants until every read and write path, including search, snapshots, comments, collaborative updates, Storage, and exports, applies the same effective permission.
