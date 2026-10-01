# Base forms

Open a Base and choose **Form**. **Configure** sets a destination folder, filename template, optional note template, default YAML properties, and up to 50 fields. **Fill form** creates a normal Markdown note. Form configuration lives inside the Base definition; answers live only in the created note and its attachments.

The default form has a required title. Supported fields are text, long text, number, date, local date and time, single and multiple select, checkbox, tags, note reference, URL, email, and file attachment. Field keys become YAML frontmatter properties, except `title` sets the note title and `body` appends a Markdown section. Attached files are saved beside the note, linked with relative Markdown paths, and capped at 100 MiB each. Name collisions receive a numeric suffix. A failed submission removes newly created attachments.

Required, minimum, maximum, allowed options, and bounded regex patterns are checked before submission and again in the submission service. Minimum and maximum mean numeric value for number fields, date for date fields, character length for text fields, and item count for list fields. Regex patterns must be anchored and use only literals, character classes, and finite repeats. Arbitrary JavaScript and unrestricted regex operators are unavailable.

Filename and note templates use Noor Note's safe template renderer. For example, `{{date}} {{title}}` or `{{property("status")}}` can name a file. Default properties are configured as a JSON object in the form editor and written as YAML. Template comments and unknown frontmatter fields are preserved where the YAML updater can preserve them.

Full-vault ZIP export includes form definitions. Import remaps destination folder and template note IDs. Folder-only ZIP export omits Bases. Forms are local to a vault; there is no public or anonymous form endpoint, conditional field logic, or submission inbox yet.
