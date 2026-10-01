# Dashboards

Noor Note provides five starting layouts: Home, Productivity, Research, Writing, and Study. Create any number of dashboards from these templates. Each dashboard can be renamed and its widgets can be added, reordered, hidden, resized, and configured. Drag a widget handle onto another widget to reorder it, or use **Move earlier** and **Move later** from **Customize** for keyboard access. On narrow screens, widgets stack in saved order.

Dashboard layouts are validated records in the vault's local IndexedDB object table. A full-vault ZIP includes the records; folder exports omit them because widgets can reference other parts of the vault. Editing a layout does not change Markdown content. Deleting a dashboard leaves notes, tasks, bookmarks, and Bases intact.

Recent notes, modified notes, tasks, calendar items, favorites, bookmarks, graph counts, and local organization opportunities use existing vault summaries. The Base widget applies a saved Base query, formulas, and active view filters to those summaries. Search-expression-backed Base queries need the full Base view. The activity widget reads the existing shared feed only when cloud sync is active. It is unavailable in local-only vaults. AI suggestions are local organization opportunities and never send content to a provider automatically.

Writing statistics and unlinked mentions inspect Markdown bodies only when **Scan notes** is pressed. The scan reads notes one at a time to avoid loading the whole vault into memory. Unlinked mentions target the currently selected note. These scans are local and can take time for a large vault.

Current limitations: drag reordering uses desktop HTML drag and drop; touch users use the reorder buttons. Dashboard layouts currently have no cloud sync transport. The Base widget does not run search-expression filters. The activity widget refreshes when the dashboard is opened, rather than subscribing to live activity updates.
