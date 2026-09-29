# Workspaces

A Workspace is a named snapshot of a vault's window layout. The current layout autosaves to this browser for each vault. Users can save it as a named Workspace, load or update a snapshot, duplicate or rename one, delete one, and choose a startup Workspace. Open the Workspaces manager from the sidebar or command palette. Deleting a Workspace does not delete notes, Bases, or Canvases.

Version 1 snapshots contain the active view, nested note pane tree and tabs, recently closed tabs, active note, navigation and inspector visibility, desktop panel widths, Graph settings, open Canvas and Base tabs, and Calendar view, date, period, and filters. The manager offers desktop width sliders. Mobile continues to use the responsive drawer and bottom navigation.

`workspace-layout.ts` validates snapshots with Zod before use. It limits pane depth and count, rejects duplicate pane and tab IDs, and drops references to notes and resources that have since been deleted. A load flushes pending note edits before changing the layout. Current layouts and startup choices are local browser preferences; named Workspaces are IndexedDB vault objects. Full-vault ZIP export includes named Workspaces and remaps referenced IDs on import. Folder ZIP export omits them.

Limitations: saved layouts contain no detached browser windows or arbitrary view state outside the fields above. Canvas and Base tabs do not support drag reordering yet. The browser's storage must remain available for live layout persistence.
