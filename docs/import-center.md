# Import Center

The Import Center previews user-selected files before changing a vault. Open it from the workspace, Settings, the command palette, or a folder's import action. Select files, a browser-supported folder, or one ZIP archive. Choose a destination vault and folder, review note and attachment counts, path conflicts, planned actions, and conversion warnings, then import. A native Noor Note backup creates a new vault and restores its archived metadata.

## Tested input boundaries

| Input | Implemented subset | Fixture |
| --- | --- | --- |
| Plain Markdown and Obsidian-style vault | `.md`/`.markdown`, nested and explicit empty ZIP folders, attachments, compatible `.canvas`, source-preserved wiki links, aliases, tags, YAML, relative links, embedded images; `.obsidian` settings skipped | `plain.md`, `obsidian-vault.test.ts` generated vault ZIP |
| Notion export | Markdown pages and database CSV files inside a ZIP, plus assets; sitemap HTML skipped | `notion-page.md`, generated ZIP |
| HTML and Apple Notes HTML export | Basic headings, paragraphs, emphasis, links, lists, code, blockquotes, and local image references | `page.html`, `apple.html` |
| CSV | One Markdown note containing a GFM table | `table.csv` |
| Google Keep JSON | Note text, checklist state, and labels as text | `keep.json` |
| Evernote ENEX | Note title, ENML text formatting, and tags as text; embedded resources flagged | `evernote.enex` |
| Joplin Markdown export | Markdown files and ordinary attachments in a directory or ZIP | `joplin.md` |
| Logseq/Roam Markdown export | Markdown source and nested paths; source-specific markers remain source text | `logseq.md`, `roam.md` |
| Noor Note legacy JSON | Existing `notes` backup schema | Generated legacy fixture in `import-center.test.ts` |
| Noor Note ZIP backup | Versioned vault manifest through the existing archive importer | Generated vault backup in `import-center.test.ts` |

These fixtures verify the stated subsets, not every version or feature of an external exporter. Joplin JEX, native Apple Notes packages, OneNote packages, OPML, arbitrary JSON schemas, Evernote embedded resources, and source-specific database metadata are not imported. The preview reports skipped files and lossy conversions. Unknown JSON schemas fail inspection. Source Markdown remains unchanged when imported.

For Markdown vaults, the preview and downloadable JSON report list successful actions, warnings, unsupported plugin syntax, and references unresolved within the selected source. Compatible JSON Canvas files become real Canvases with note and attachment cards linked after import. See [Obsidian-style vault import](obsidian-vault-import.md).

## Conflict policy

Conflicts use case-insensitive vault paths. **Rename** allocates a new path for imported content. **Skip** leaves an occupied path untouched. **Merge** is permitted for notes only when one complete Markdown body is an exact line-prefix of the other; incompatible bodies block the import. **Overwrite** replaces an existing non-collaborative note only after the user checks the explicit confirmation box. It creates a revision checkpoint. Colliding attachments are skipped under Merge and Overwrite. Folder/file path collisions block the plan. The plan is recomputed just before writing so a changed destination must be reviewed again.

If two selected source files convert to the same Markdown filename, inspection stops and asks the user to rename a source file before retrying. This prevents one converted file from silently replacing another in the batch.

Loose imports write items sequentially. A storage failure can leave already imported items in place; the error reports how many were written so the user can inspect the vault before retrying. Native Noor Note ZIP import retains its separate rollback behavior. Import reads text for preview, but ZIP attachment bytes are extracted one at a time during commit. Files are capped at 5,000 entries, text at 8 MiB per file, attachments at 64 MiB each, and generic ZIP declared uncompressed content at 512 MiB. Large or specially crafted archives still need browser memory and resource review.

## Architecture

`apps/web/src/lib/import-center.ts` owns adapter registration, inspection, destination planning, and commit. `ImportCenter.tsx` owns file selection and review; it calls the vault repository only through the import service. New adapters should declare accepted paths, parse bounded text, and add a realistic fixture plus preview/commit tests. Do not claim a format based on a file extension alone. Keep importer-specific transformations visible in `unsupported` warnings and preserve source files when conversion is incomplete.
