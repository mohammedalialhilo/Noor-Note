# Daily and periodic notes

Open **Calendar** from the activity bar or navigation. Choose Daily, Weekly, Monthly, Quarterly, or Yearly. Previous, Next, and Current move by exactly one selected period. The date field jumps to any period. Daily mode also shows a month calendar; selecting a date opens its existing note.

Each period has vault-specific settings under **Settings → Daily and periodic notes**:

- **Folder:** vault root or an existing folder.
- **Filename format:** creates a portable `.md` note name. Supported tokens include `yyyy`, `yy`, `MM`, `M`, `dd`, `d`, `GGGG` (ISO week year), `WW`, `W`, `Q`, `MMMM`, `MMM`, `EEEE`, and `EEE`. Enclose literal letters in brackets: `GGGG-[W]WW`.
- **Display date format:** uses the same tokens for the period heading.
- **Template:** an ordinary note in the configured template folder. If none is chosen, the daily legacy rule or normal folder/default template rules apply.
- **Auto-create when opened:** creates only the period selected in the Calendar view. It does not fill gaps or create notes for surrounding dates.

Default names are `yyyy-MM-dd`, `GGGG-[W]WW`, `yyyy-MM`, `yyyy-[Q]Q`, and `yyyy`. Weeks begin Monday and use ISO week years. Dates and templates use the browser's local calendar. A missing period with auto-create off stays empty until **Create note** is pressed. The existing **Open or create daily note** command is an explicit create action; commands also open each period view.

Created notes contain portable YAML fields `noor_period_kind` and `noor_period_key`. These identify the period after a note is renamed or moved. Full-vault ZIP import preserves the fields and remaps configured folder and template IDs. Older date-named daily notes can still be opened in their configured folder.

Periodic notes are local Markdown notes. They are not scheduled reminders or calendar events. Simultaneous creation of the same period in separate browser tabs can produce duplicate notes; the storage engine prevents path overwrite but does not enforce unique period metadata across tabs.
