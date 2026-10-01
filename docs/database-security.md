# Database security audit

**Status: PARTIAL.** Migration 202610010001 hardens the existing Supabase policies. The automated audit runs every production migration in embedded PostgreSQL. A live Supabase project has not yet been tested.

## Authorization boundary

Browser roles and filters are presentation only. Database policies and narrowly granted RPCs derive the caller from `auth.uid()`; the client never supplies its own role. Vault ownership and accepted plaintext-vault membership control access to sync records, attachments, collaboration, comments, and activity. Viewer can read, Commenter can also comment, Editor can edit content, Admin can manage memberships, and Owner can transfer ownership. Folder and note grants are not available. Public publishing and private bearer links are separate explicit disclosure paths.

All Noor tables in `public` have RLS enabled. Tables with client reads or writes have policies for those operations. Internal tables with no client grants or no applicable policy fail closed:

| Table | Direct client boundary |
| --- | --- |
| `noor_sync_vaults`, `noor_sync_records` | Current owner or accepted member reads; record writes use checked RPC |
| `noor_vault_members` | Participants read; invitation, role, removal, and transfer RPCs mutate |
| `noor_device_public_keys`, `noor_vault_key_envelopes` | User owns device keys; only current encrypted-vault owner reads and inserts their own sealed envelopes |
| `noor_collab_documents`, `noor_collab_updates` | Participants read; Editors and higher append through checked RPCs |
| `noor_comment_threads`, `noor_comment_messages`, `noor_activity_events` | Plaintext-vault participants read; checked RPCs or server triggers mutate |
| `noor_public_sites`, `noor_public_pages` | Anonymous users read explicitly published snapshots; Admin and Owner manage |
| `noor_private_shares` | Managers see limited metadata columns; bearer RPC checks token, expiry, password, and revocation |
| `noor_sync_operations`, `noor_vault_invites`, `noor_vault_transfers`, `noor_comment_canvas_targets`, `noor_private_share_sessions` | No direct client table privileges; checked RPCs manage them |
| `noor_shared_comments` | Legacy table has no client privileges or policies after threaded-comment migration |

The private Storage bucket authorizes paths against the current vault ID and immutable storage owner namespace. Publishing assets are readable anonymously only when referenced by a current public snapshot. Private note Realtime policies check the current vault role for database authorization.

## Revocation and account removal

Membership removal immediately denies new database reads, writes, and Storage requests, even if the client retains a stale user ID. Pending invitations grant no access. The old direct-add RPC is no longer executable by clients; new sharing requires invitation acceptance. A revoked private share is rejected on the next bearer RPC request, including requests with an existing session token.

Deleting an Auth user cascades their memberships, invitations, transfer offers, device keys, and private shares they created. Historical shared comments, collaboration updates, and activity remain in surviving vaults with nullable author references; the interface labels such comments and events as a former member. Historical activity rows still store the recorded email and may need a separate retention or erasure policy. Deleting a vault owner cascades that owner's vaults. Already downloaded local content or previously disclosed keys cannot be recalled.

## Verification

Run `corepack pnpm --filter @noor-note/web exec vitest run test/database-security.test.ts`. The test applies all migrations and enumerates every Noor table to assert RLS is enabled. It checks no-grant tables, two-user vault isolation, Viewer and Commenter write denial, Editor membership denial, Storage access, encrypted key envelopes, invitation acceptance, member removal, deleted accounts with stale identity claims, and private-share revocation. The existing sharing, publishing, collaboration, encryption, and private-share tests provide additional coverage.

Before a production rollout, apply migrations in order to a disposable Supabase project and repeat these cases using real Supabase Auth JWTs, Storage API calls, Realtime subscriptions, and anonymous public routes. A service-role key bypasses RLS by design and must stay server-side. Live Realtime channels can cache an authorization decision until refresh or reconnect; revoke or disconnect active sessions as part of incident response. Test Auth-user deletion with populated production-like data and define retention of historical email addresses.
