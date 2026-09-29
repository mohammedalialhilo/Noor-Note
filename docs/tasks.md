# Tasks in Markdown

Noor Note reads ordinary Markdown checkboxes. The Tasks dashboard groups them into Inbox, Today, Upcoming, Overdue, Scheduled, Someday, Completed, and saved Custom views. The dashboard uses note summaries; editing loads and saves the original Markdown note with revision checking.

```markdown
- [ ] Draft proposal #work @due(2026-10-01) @scheduled(2026-09-28) @priority(high)
- [ ] Team check-in @due(2026-09-25) @repeat(weekdays) @assignee(Ali)
- [ ] Explore an idea @someday
```

Supported tokens are `@due(YYYY-MM-DD)`, `@scheduled(YYYY-MM-DD)`, `@start(YYYY-MM-DD)`, `@done(YYYY-MM-DD)`, `@priority(low|normal|high|urgent)`, `@repeat(...)`, `@assignee(name)`, `@someday`, and `#tags` including nested tags. Tokens can be edited directly in Markdown. Invalid tokens remain visible as text and are flagged in the dashboard. Assignees are plain Markdown metadata until shared vault identities and permissions exist.

Tasks edited in the dashboard receive a stable `<!-- noor-task-id:UUID -->` comment. The **Assign task IDs** action adds comments to legacy checkbox lines in the vault and repairs duplicate IDs it encounters. It preserves other Markdown and block IDs. Normal checkboxes remain readable in any Markdown editor; before an ID is assigned, the dashboard locates a task by note and line and checks its text before saving.

## Recurrence

`@repeat(...)` accepts `daily`, `weekdays`, `weekly`, `monthly`, `yearly`, or `every:N:days|weeks|months|years` with `N` from 1 to 365. When an open recurring task is completed **through the dashboard**, Noor Note marks that instance complete, records today's local date in `@done`, and inserts exactly one new open task immediately after it with a new ID. Its next due date is the first recurrence date strictly after completion. The previous due date is the anchor; if absent, the completion date is the anchor. Missed occurrences are skipped. Weekdays skip Saturday and Sunday. Monthly and yearly schedules keep the anchor day where possible and clamp to the last day of a shorter month. Scheduled and start dates move by the same number of calendar days as the due date. Reopening a completed instance does not remove a generated instance.

Source Mode remains authoritative. Manually typing `[x]` in Markdown does not automatically generate the next occurrence; complete recurring tasks in the dashboard for automatic recurrence. There are no background reminders or scheduled notifications.

## Views and saved filters

- **Inbox:** open tasks without due, scheduled, or start dates and without `@someday`.
- **Today:** open tasks due, scheduled, or starting today.
- **Upcoming:** open tasks with future due dates.
- **Overdue:** open tasks with due dates before today.
- **Scheduled:** open tasks with a scheduled date.
- **Someday:** open tasks with `@someday`.
- **Completed:** checked tasks.

Views can overlap. Custom filters combine space-separated terms with AND. Supported terms are `status:open|done`, `due:today|overdue|upcoming|none`, `priority:low|normal|high|urgent`, `tag:name`, `assignee:name`, `path:text`, `repeat:true|false`, `someday:true|false`, `before:YYYY-MM-DD`, `after:YYYY-MM-DD`, and `text:word`. Plain words search task and note titles; a quoted phrase works as one plain term. Saved views live in vault settings and travel with full-vault ZIP exports.
