# Knowledge graph

Open **Graph** from the activity bar or sidebar. The global graph shows notes and their resolved links. Open a note and choose **Show local graph** to center a local view on it. Local depth can be 1–4 hops; direction can include inbound links, outbound links, or both.

The canvas supports wheel and button zoom, pan, and node dragging. Click a note to open it. Right-click a note for tab, split, copy-link, and local-graph actions. The node list offers the same actions by keyboard. Search highlights matching nodes and narrows the accessible node list. Controls show or hide links, embeds, tags, attachments, tag relationships, and orphans. Node color can group by type or folder; size can be uniform or connection-based.

`GraphClient` loads note bodies in batches only when their revisions change. A dedicated Web Worker parses links, builds graph edges, and runs ForceAtlas2 layout. It keeps positions when topology is unchanged, so search and visual filters do not restart layout. Sigma renders the result with WebGL. Graph data is derived from local Markdown and attachment metadata; it is not a second source of truth and is not uploaded.

`sigma` provides a WebGL renderer suitable for thousands of nodes. `graphology` supplies the graph structure it accepts, and `graphology-layout-forceatlas2` calculates force positions inside the worker. These three packages are used only for the graph view.

Current boundaries: the graph opens on demand and has no persistent position overrides. Links in notes with unsaved drafts appear after their next save or graph refresh. Attachment nodes can be downloaded; Canvas nodes are not shown until Canvas files have a usable storage workflow. The accessible node list shows the first 40 matches and is intended as a keyboard path to graph navigation; a full screen reader audit remains pending.
