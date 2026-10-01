# Bases

A Base is a saved query over existing Markdown notes. Open **Bases** from the activity bar or mobile navigation, create a Base, and use **Query** to choose its notes. The query can combine folder, nested tag, property, link target, date range, task state, and a search expression. Search expressions use the offline search index; the Base shows matching note summaries without copying note bodies.

Each Base can contain multiple named views. Table, List, Cards, Gallery, Kanban, Calendar, Map, Timeline, Gantt, and Chart share the query result. Each view saves its own filters, sort, group, visible fields, column order and widths, and layout settings. Views can be added, renamed, or removed. The table supports property and title edits, sorting, grouping, selection, bulk property edits, and moving selected notes to Trash. Property columns can be created from view settings; values live in note YAML frontmatter. Dragging a Kanban card, or choosing its **Move to** control, updates the underlying property, tag, or folder. Folder lanes use full paths to distinguish duplicate folder names.

Bases also support [safe formulas and view summaries](formulas.md). A computed column is read-only and its value is derived from note properties; formulas can participate in filters, sorting, grouping, cards, and date views. Each view can show count, sum, average, minimum, maximum, or unique values for its filtered notes.

Each Base can also [generate a form](forms.md) that creates normal Markdown notes with validated YAML properties, an optional note template, and relative attachment links.

Cards and Gallery can show a chosen title, description, local image attachment property, property list, and card size. The image property must contain an attachment ID, path, or name. Calendar uses configured date, end-date, and task-date properties. Map accepts `latitude, longitude` text or a structured property with `lat`/`lng` or `latitude`/`longitude`. It plots coordinates on an offline grid; place names without coordinates appear in an unplaced list. Timeline and Gantt use configured start and end properties; Gantt also displays dependency metadata and progress.

Chart views support bar, line, area, pie, donut, scatter, histogram, and number/KPI displays over structured properties and formula fields. Every chart has a visible data table. See [Charts and analytics](charts.md).

The Base configuration is a versioned, validated record in IndexedDB. Notes remain portable `.md` files. Full-vault ZIP export includes Bases and remaps their folder queries when imported into a new vault. Folder ZIP export omits Bases because a query can refer to content outside that folder.

Current limits: the map is a coordinate grid without map tiles or geocoding; Gantt dependency metadata is displayed but does not calculate schedules or draw dependency arrows. Calendar has no recurrence or standalone scheduling workflow. Cards do not automatically discover images embedded in Markdown. Very large Bases currently filter note summaries on the main thread, while search expressions use the search worker. Collaboration and cloud sync are not available.
