# Export Center

Open **Export Center** from the Files sidebar, Settings, or the command palette. Choose a format and read its portability report before exporting. The active editor draft is saved before the inventory is read and again before the artifact is created. Export uses the current local vault; it does not transmit data to a server.

| Format | Contents | Main limits |
| --- | --- | --- |
| Noor Note vault ZIP | Active Markdown, attachments, revisions, and supported vault records with a versioned manifest | Trash, local account state, cloud comments/activity, AI chats, plugin installations, and device preferences are outside the archive. This is the format for Noor Note round trips. |
| Portable Markdown vault ZIP | Original `.md` files, attachment bytes, explicit folders, and compatible `.canvas` JSON | No revisions, Bases, dashboards, OCR/transcript sidecars, PDF annotations, or other Noor-only records. Wiki links remain plain source text. |
| Folder Markdown ZIP | The selected folder and descendants in the same portable layout | References outside the folder may break. Same structured-data exclusions as portable vault ZIP. |
| Individual Markdown | Exact source Markdown, including YAML frontmatter | Linked files and other notes are not bundled. |
| Individual HTML | Rendered GFM in a standalone page, escaped original Markdown in a collapsible section, and available local raster images up to 5 MiB each | Other attachments and Noor-only records are not bundled. Mermaid, LaTeX, note embeds, and wiki navigation have limited rendering. Missing or oversized images produce visible labels and warnings. Raw HTML in notes is inert. |
| PDF via browser print | Printable HTML with supported embedded images | The browser creates the PDF when the user chooses **Print → Save as PDF**. Original source and linked files are not embedded in the printed PDF. Browser print support and layout vary. |
| JSON archive | Vault metadata, full active note records, local revisions, attachment metadata and base64 bytes, and generic structured records | Trash is excluded. This versioned format is documented for third-party recovery. Noor Note cannot import it yet. Total attachments are limited to 32 MiB and note Markdown to 64 MiB; use Noor ZIP for larger vaults. |
| Base CSV | Rows selected by the Base query and active view, ID, path, visible fields, and computed formula values | Bodies, attachments, Base configuration, formula definitions, and hidden fields are omitted. Spreadsheet formula prefixes in cells are escaped. |
| Canvas JSON | One JSON Canvas document, with Noor extensions namespaced by the core converter | Referenced note/attachment content, comments, and undo history are not bundled. |

The portability report states inclusions and omissions before the action is enabled. An export fails visibly if an expected attachment is missing rather than creating an incomplete ZIP or JSON archive. HTML and print exports replace unavailable images with labels and add a warning after generation. Exported files contain private content in plaintext; store and share them accordingly.

`apps/web/src/lib/export-center.ts` builds and reports artifacts. `export-html.tsx` renders inert standalone HTML. The existing `vault-archive.ts` remains the native backup format. `ExportCenter.tsx` owns file delivery and the browser print tab. ZIP writing reads attachment Blobs one at a time; JSON deliberately has a small attachment bound because base64 encoding requires memory.
