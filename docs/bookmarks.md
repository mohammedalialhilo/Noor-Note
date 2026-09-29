# Bookmarks, favorites, and recents

Open **Bookmarks** from the sidebar or command palette. Bookmarks can point to a note, heading, block ID, search, Base, Canvas, or HTTP(S) URL. Choose a group when creating a bookmark; groups can contain nested groups and bookmarks. The manager supports rename, move, and delete. Deleting a group moves its immediate children to the root. Invalid group cycles and missing targets are rejected.

The note toolbar has separate buttons to bookmark, favorite, or pin the active note. Favorites and pinned notes appear in the bookmarks panel. Pinned notes are independent of pinned editor tabs. Note, heading, and block targets use stable note IDs, so moving or renaming a note does not change their target.

Recent notes and recent searches are capped, per-vault browser preferences. Recently closed note tabs are kept in the current workspace layout and can be restored from the panel or the tab strip. A named Workspace also saves its closed-tab history. Bookmark records and groups are included in full-vault ZIP exports; import remaps note, Base, Canvas, and group IDs. Folder ZIP exports omit bookmarks.

Limitations: bookmarks are scoped to one vault. A bookmark to a deleted note or resource stays visible but cannot open until its target is restored. External URL bookmarks open in a new browser tab. Recent note and search history is local to the browser and is not exported.
