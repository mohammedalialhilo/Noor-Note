# @noor-note/core

Portable note types and Markdown helpers. A `Note` contains a UUID, a one-line title,
Markdown content, and ISO 8601 creation and update timestamps. An empty title is
valid while a person is editing; `createNote()` initially derives one from the
Markdown or uses `Untitled note`.

`noteSchema` validates records at runtime. `parseImportedNotes()` accepts an array
of notes or an object with a `notes` array. It rejects invalid fields, reversed
timestamps, and duplicate IDs before a storage import begins.

`exportNoteAsMarkdown()` adds a level-one title heading unless an equivalent heading
already starts the body. Its filename contains a sanitized title and the full UUID,
so notes with the same title have distinct, stable names. For Markdown import,
`parseMarkdownDocument()` separates an initial level-one heading from the body;
the caller can then pass both values to `createNote()`. Files without that heading
keep their full Markdown body and derive a title from its first nonblank line.

`extractTags()`, `extractWikiLinks()`, and `parseTasks()` provide lightweight
metadata for the local workspace. Task line numbers are one-based and refer to
the original Markdown document. These helpers skip fenced code; they are not a
complete Markdown parser.
