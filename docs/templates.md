# Templates

Templates are ordinary Markdown notes in a folder selected under **Settings → Templates**. The source notes remain editable, searchable, and portable in vault ZIP exports. Creating a template from Settings creates the folder when needed and opens the new source note.

## Rules and commands

Choose a default template, a daily note template, and optional templates for destination folders and Bases. When creating a note, Noor Note checks the daily or Base rule, then the nearest ancestor folder rule, then the default. Notes created inside the template folder do not receive an automatic template. Use **Open or create daily note** to find today's note in the selected folder or make it from the daily rule.

The command palette offers **Insert template**, **Create note from template**, **Apply template properties**, and **Preview template**. The picker renders a preview before use. Insert adds the rendered body at the current editor selection and omits YAML frontmatter. Apply template properties adds only YAML fields absent from the note; it preserves existing values and unrelated fields. Create note uses the final collision-free Markdown filename for `{{filename}}`.

## Variables

| Variable | Value |
| --- | --- |
| `{{date}}`, `{{time}}` | Local date `YYYY-MM-DD` and time `HH:mm` |
| `{{year}}`, `{{month}}`, `{{day}}` | Local calendar parts |
| `{{title}}`, `{{filename}}`, `{{folder}}` | Target note title, Markdown filename, and vault-relative folder |
| `{{selection}}`, `{{clipboard}}` | Editor selection and clipboard text |

Clipboard access requires the **Read clipboard** button in the picker and browser permission. Automatic note creation leaves `{{selection}}` and `{{clipboard}}` empty. Date variables use the time at application, not the source note's timestamp.

## Functions

Expressions use `{{function(arguments)}}`. Arguments can be variables, quoted strings, numbers, booleans, `null`, or nested function calls. Examples:

```markdown
# {{title}}
Created: {{dateFormat("yyyy-MM-dd")}}
Author: {{upper(property("author"))}}
Status: {{if(eq(property("priority"), "High"), "Review", "Open")}}
```

The allowlist is `dateFormat`, `upper`, `lower`, `trim`, `titleCase`, `property`, `if`, `eq`, `ne`, `and`, `or`, `not`, and `contains`. `property("name")` reads a property of the target note; structured values are rendered as JSON text. Functions have no file, network, or JavaScript execution access. Invalid expressions stop the action and show an error; they are not silently written as raw syntax.

Templates are local to each vault. ZIP import gives the new vault fresh IDs and remaps the template folder, source note, folder, and Base rules. Folder-only ZIP export includes Markdown source notes but does not preserve whole-vault template rule settings.
