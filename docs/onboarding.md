# First-run onboarding

Noor Note shows a short welcome dialog when the local repository had no active or deleted vaults before startup. The repository still creates its normal empty `My vault` so the existing local-first workspace remains usable. Choosing **Create local vault** renames that empty bootstrap vault; it does not create an unnecessary second vault. Returning users, including users with only deleted vaults, do not see onboarding.

The welcome choices are:

- **Create local vault:** name the bootstrap vault, then optionally read the quick tour.
- **Import Markdown vault:** open the existing Import Center, with preview and conflict review before writing. Canceling returns to the welcome choices.
- **Open filesystem folder:** when `showDirectoryPicker` is available, read file handles with read permission and pass their relative paths into Import Center. Noor Note does not change the source directory. The picker is hidden when unsupported; Import Center's file and folder upload remains available.
- **Sign in:** open the existing account screen when Supabase Auth is configured. Signing in does not enable vault sync.
- **Continue without account:** use the local bootstrap vault and optionally read the quick tour.

The one-page tutorial explains notes, wiki links, backlinks, search, command palette, properties, Canvas, and Bases. It has **Skip tutorial** and **Start writing** actions. **Skip setup** closes the welcome dialog immediately. The tour can be reopened from Settings → About Noor Note.

Completion is a device-local `localStorage` marker (`noor-note:onboarding:v1`). The marker is checked only after repository initialization and first-run detection. It contains no vault content or account data. If browser storage rejects the marker, onboarding still closes for the current session; the presence of the bootstrap vault prevents repeated first-run prompts on later loads. Folder traversal is bounded to 5,000 files and 24 levels; Import Center applies its own content and path checks.
