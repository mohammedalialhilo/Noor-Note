# Base formulas

Bases can define named, read-only computed properties. Open a Base, open **View settings**, and add a formula such as `price * quantity`, `completed ? "Done" : "Open"`, `daysBetween(start, end)`, `upper(name)`, or `if(priority == "High", 3, 1)`. A formula reads each note's YAML properties and a small set of note fields (`title`, `path`, `createdAt`, `updatedAt`, `tasks`, `openTasks`). For a property name with spaces, use `prop("Unit price")`. Formula values are calculated for the Base view and never written into note Markdown.

| Syntax | Behavior |
| --- | --- |
| `+ - * / %`, unary `+ -` | Numeric arithmetic; division by zero or nonnumeric input returns null |
| `== != < <= > >=` | Strict equality and comparisons; mismatched relational types return false |
| `&& || !` | Boolean operations with short-circuit evaluation |
| `condition ? yes : no`, `if(condition, yes, no)` | Evaluate only the selected branch |
| `??`, `coalesce(a, b, …)` | First non-null value |
| `upper`, `lower`, `trim`, `concat`, `contains`, `startsWith`, `endsWith`, `length` | String helpers |
| `daysBetween(start, end)`, `addDays(date, count)` | ISO date calculations; `addDays` returns `YYYY-MM-DD` |
| `round`, `abs`, `min`, `max` | Numeric helpers |

Missing properties and nested objects evaluate to null. Formulas cannot access object members, arrays, other formulas, arbitrary functions, or JavaScript globals. Names are case-sensitive. The parser permits up to 500 source characters, 256 tokens, 40 levels of nesting, and 16 function arguments. Evaluation has a 2,048-step limit and string results are capped at 4,000 characters. Unsupported syntax is rejected before the formula is saved. These limits protect the browser; formula evaluation still runs locally on the main thread for the current Base result set.

Computed fields can be shown, sorted, filtered, grouped, and selected as card or date fields. Their field IDs remain stable when the formula is renamed. Deleting a formula removes its saved references from Base queries and views. Full-vault ZIP export includes formula definitions with the Base configuration.

Each Base view can save summaries using **count**, **sum**, **average**, **minimum**, **maximum**, and **unique values**. Count with no field counts rows; count with a field counts nonempty values. Numeric summaries ignore nonnumeric values and return an empty result when none are present. Unique values include primitive values and elements of list properties. Summaries reflect the notes currently visible after the Base query and view filters. Minimum and maximum currently apply to numbers, not dates or text.
