# Collaborative comments

**Status: PARTIAL.** Comments are available to signed-in members of a plaintext cloud vault. They do not change Markdown or PDF bytes. The browser panel is shared by note, Canvas, and PDF readers.

Apply [migration 005](../supabase/migrations/202609290005_noor_comment_threads.sql) after the four earlier Supabase migrations. It migrates each old `noor_shared_comments` row into a one-message note thread and revokes direct writes to the old table. `noor_comment_threads` stores a stable target and optional anchor; `noor_comment_messages` stores ordered replies, author, edits, soft deletion, and mentioned member IDs. Both tables are readable only by current vault members. Writes use narrow `SECURITY DEFINER` functions that derive the actor from `auth.uid()` and check the live vault role and target. Direct authenticated table writes are denied.

| Action | Allowed roles |
| --- | --- |
| Read | Owner, Admin, Editor, Commenter, Viewer |
| Create thread or reply | Owner, Admin, Editor, Commenter |
| Edit | Author, while still allowed to comment |
| Delete | Author, Owner, Admin |
| Resolve or reopen | Thread creator, Owner, Admin, Editor |

The author is set by Postgres. Deletion clears the body and mentions while retaining a tombstone so replies and thread order survive. Mentions use `@member@example.com`; an autocomplete lists accepted vault participants and the owner. The server derives mentioned IDs from the text and current membership. Mentions appear in the panel for the mentioned user; email or push notifications are not implemented. Private Realtime Broadcast messages contain only the changed thread ID and make open panels refetch through RLS. On a disconnected browser, the panel can display already fetched comments, but posting and updates require cloud connectivity; there is no offline comment queue.

## Anchors

Whole-note threads use the stable note UUID. Inline text anchors combine an exact selected quote, 80 characters of prefix and suffix, source offsets, and, for collaborative Yjs notes, encoded Yjs relative positions. On navigation, the resolver first verifies the Yjs positions against the quote, then checks the original offsets, then searches for the quote and ranks matches using surrounding context and proximity. When the quoted text no longer exists, the thread stays visible and is marked as changed; navigation does not jump to unrelated text. Anchors are outside Markdown and cannot be recovered from a Markdown-only export.

Canvas threads use the Canvas UUID, with an optional card UUID anchor. An Editor or higher registers the Canvas UUID before threads can be created; the registration is a permission checked target record. Canvas documents remain local sidecars and are not cloud synced, so participants need the same Canvas document separately to see its cards. PDF threads use a synced PDF attachment UUID and a local annotation UUID, page number, and short quote. PDF annotation sidecars remain local; another device can read the comment and page/quote metadata, but may not have the underlying annotation sidecar. Neither Canvas nor PDF annotation target existence can currently be checked against a synced server copy.

Comment bodies and anchors are plaintext cloud records and are not part of encrypted vault sharing. They are not included in ZIP export or offline sync. A later portable comment export should include target IDs and anchors with stable ID remapping. Live Supabase Realtime and cross-device UI behavior still need deployment testing; the embedded PostgreSQL test checks migration, RLS, RPC permission decisions, and target ID isolation.
