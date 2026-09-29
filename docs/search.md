# Offline search

Noor Note searches locally. The first query in a browser session loads active note bodies in batches and saved OCR and transcript sidecars, then builds an inverted index inside a dedicated Web Worker. Later queries compare note revisions and sidecar timestamps and reindex only changed items; removed or trashed items leave the index. The worker bundle is part of the offline application shell. Search does not send note, OCR, or transcript text to a server.

| Query | Meaning |
| --- | --- |
| `meeting` | Full-text word across title, path, Markdown, tags, properties, links, tasks, and headings |
| `"Project Alpha"` | Exact phrase |
| `proj*` | Word prefix |
| `projet~` | Fuzzy word, up to one or two edits depending on length |
| `tag:work` | Tag name, including nested tags |
| `path:Research` or `title:Plan` | Path or title contains text |
| `status:Draft` | YAML `status` property contains text |
| `property="Ali"` | Any property value equals text |
| `property.owner:Ali` | Named property contains text |
| `links:"Project Alpha"` | Outgoing link target contains text |
| `task:Review` or `heading:Overview` | Task or heading contains text |
| `before:2026-09-01` or `after:2026-01-01` | Updated date is strictly before or after the date |
| `has:tag`, `has:property`, `has:link`, `has:task`, `has:heading`, `has:attachment`, `has:ocr`, `has:transcript` | Note has that item, or an attachment result has saved OCR or transcript text |
| `is:completed`, `is:incomplete`, `is:empty` | Task or empty-body state |
| `regex:/pattern/` | Optional case-insensitive regular expression |
| `sort:relevance`, `sort:updated`, `sort:created`, `sort:title` | Result order |

Spaces combine conditions with AND. Search results show matching excerpts, highlights, paths, and matching property values. Results are limited to 500 per query. The note list also has a sort control, recent searches recorded when Enter is pressed, and saved query shortcuts. Recent and saved queries are kept per vault in browser localStorage and are not included in vault ZIP exports.

The index is held in memory and is rebuilt after a page reload. This keeps existing vault storage and migrations unchanged but makes the first search in a large vault slower than later searches. Corrected OCR text opens its source page, and corrected transcript segments open media at the matching timestamp. PDF annotations remain a reserved derived-text field without a producer. Regex length and complexity are limited, but regex search remains an advanced feature and runs in the worker.

## Semantic and hybrid search

The search panel offers **Lexical**, **Semantic**, and **Hybrid** modes. Lexical keeps the query syntax above. Semantic compares the meaning of a query with Markdown passages; Hybrid combines lexical and semantic ranks with reciprocal-rank fusion. A result shows its note, heading, source passage, and cosine similarity. Similarity is a relative ranking signal, not a calibrated confidence percentage. The semantic side searches note passages only; Hybrid can also show lexical OCR and transcript matches. Structured lexical filters do not constrain semantic matches, so use Lexical when a filter must apply to every result.

Selecting Semantic or Hybrid shows an explicit **Enable local semantic search** action. The first query then builds the index and downloads the pinned multilingual E5 model and tokenizer from Hugging Face (about 140 MB). Model files travel to the browser; note text and queries stay in the browser worker. Browser cache availability and storage quotas determine whether model files survive between visits. After the model has been downloaded and cached, search can run offline. A fresh browser without the model cannot start semantic search offline. No remote embedding provider is configured.

The worker chunks canonical Markdown by heading and source lines, keeping note ID, heading, optional block ID, character range, line, and embedding version with each vector. YAML frontmatter and fenced code are excluded. On each search, the client compares note revisions with the local semantic index and fetches only changed note bodies. Within a changed note, SHA-256 passage fingerprints allow unchanged passages to reuse their vectors. Deleted and trashed notes are removed. The semantic index is a derived IndexedDB cache (`noor-note-semantic`), separate from vault content and excluded from ZIP export. It can be rebuilt; deleting it never deletes notes. Changing the embedding model or chunk format changes the version and triggers re-embedding on the next semantic search.

The current implementation has no remote vector database or server API. Large vaults can use substantial browser storage and the first build may take time. Passage embeddings are local, while title/path matching and detailed filter syntax remain strengths of Lexical mode. Browser model inference and offline cache persistence need device-level validation.
