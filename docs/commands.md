# Commands and keyboard navigation

Noor Note's command registry is in `apps/web/src/lib/commands.ts`. Every registered command has a stable ID, name, category, handler, optional default shortcut, and optional availability condition. The command palette, global keyboard listener, and Settings shortcut editor all read this registry. Registration returns an unregister function, so a future plugin runtime can contribute commands without a separate palette implementation. Duplicate IDs and default shortcut conflicts are rejected.

| Shortcut | Action |
| --- | --- |
| Ctrl/Command + O | Open the quick switcher |
| Ctrl/Command + P | Open the command palette |
| Ctrl/Command + K | Legacy command palette shortcut |
| Ctrl/Command + N | Create a note |
| Ctrl/Command + Shift + F | Focus note search |
| Ctrl/Command + W | Close the active note tab |
| Ctrl/Command + Shift + T | Restore the last closed tab |

The quick switcher searches note titles, paths, and folders with fuzzy subsequence matching. It lists recently opened notes first. Enter opens the highlighted note, Ctrl/Command + Enter opens a new tab, and Alt + Enter opens a vertical split. Each note row also has accessible tab and split buttons. A nonmatching name can create a note, including inside a folder path. Choosing a folder focuses it in the file explorer.

Settings > Keyboard shortcuts searches all registered commands. Change records a modifier plus key, Remove disables the binding, and Reset restores its default. Conflicts are rejected with the other command's name. Overrides and recent note IDs are validated when read from localStorage. They are browser preferences and are not included in vault ZIP exports.

The registry covers current navigation, note, editor, tab, pane, and file actions with direct handlers, including global and local graph and Bases navigation. Multi-step vault and file-tree operations remain in their dedicated dialogs; a future command can open those dialogs through the same registry when those flows expose an action API. Plugins have no runtime yet, but the registry supports registration and removal.

The Templates category includes Insert template, Create note from template, Apply template properties, Preview template, and Open or create daily note. Template source notes and rule settings belong to the active vault. See [templates](templates.md).

The Periodic notes category opens the Daily, Weekly, Monthly, Quarterly, or Yearly Calendar view. Previous, Next, and Current controls are in that view. The existing Open or create daily note command explicitly opens today's note, creating it if needed. See [periodic notes](periodic-notes.md).
