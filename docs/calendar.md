# Integrated calendar

Calendar has month, week, day, and a 30-day agenda view. It reads local note summaries: task due dates, daily-note markers, date and datetime properties, and events created in Noor Note. The current vault is selected by default; switching vaults uses the normal workspace switch. Folder filters include descendants. Tag, date-property source, task-status, and saved Base filters can be combined. A Base's query, including its search expression and formulas, determines which notes are eligible.

Select a date to open its daily note or create that one note using the configured daily-note rule. Periodic-note navigation and settings remain available through **Periodic notes**. Calendar navigation does not create notes in bulk.

Events are ordinary Markdown notes. The New event form writes YAML frontmatter fields `noor_event: true`, `date`, optional `end_date`, `start_time`, and `end_time`; details are the note body. Event dates use the browser's local calendar date. Open an event to edit its Markdown and properties. The calendar currently places an event on its start date; `end_date` is preserved and shifts by the same number of days when the event is moved.

Drag a task or dated note to a day to reschedule it. The Change date button offers the same action for keyboard and touch users. Task moves update `@due(...)` on the source checkbox line. Note and event moves update their source YAML property; datetime values keep their time suffix. Each move reloads the latest note, checks the original date, and saves a manual revision checkpoint. Daily-note markers cannot be dragged because they identify a specific day.

The calendar uses note-entry summaries and does not load every Markdown body to render. It does not currently offer an hourly time grid, notifications, external calendar import, or shared event invitations.
