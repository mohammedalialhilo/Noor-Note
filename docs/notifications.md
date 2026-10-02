# In-app notifications

Noor Note creates notifications for actionable events. Normal note edits never create notifications.

| Kind | Source | Destination |
| --- | --- | --- |
| Sync issue | Local sync status changes to an error | Sync settings |
| Collaboration invite | Server invitation trigger | Collaboration settings |
| Mention | Server comment insertion with a resolved member mention | Referenced note, Canvas, or PDF |
| Comment reply | Server comment insertion replying to another member's thread | Referenced note, Canvas, or PDF |
| Share changed | Server membership role change or removal | Collaboration settings |
| Backup failure | A user-started manual or encrypted backup attempt fails | Backup Center |
| App update | A waiting service worker is available | General settings, where Update now flushes pending edits |

Account events live in `noor_notifications`. The database writes them from trusted triggers. Authenticated clients can read only their own rows and update only `read_at`; they cannot insert or change recipients or content. Polling refreshes the center every 30 seconds while visible and when the browser returns online. The server stores metadata and generic comment text, not comment bodies. Encrypted vaults do not support shared comments.

Accepting, declining, or revoking an invitation changes its notification to a read historical item. Expired invitations are hidden by the client after their server-set expiry time.

Device events live in a separate IndexedDB database. They are scoped to the current account or local device, with vault-specific issues shown only in that vault. Stable source keys deduplicate repeat failures. The center combines both sources, supports type and unread filters, lets users mark an item read or unread, and marks all items read. A notification is not a substitute for the sync status or backup error shown at its source.

Account notifications load in 50-item pages with a Load older control. The unread badge uses a separate server count, including pages not yet loaded. There is no retention control, push delivery, outbound email, or cloud synchronization of device-event read state yet. The account schema requires migration `202610020002_noor_notifications.sql`; without it the center reports the load error while local notifications remain available. Live Supabase and mobile browser review remain pending.
