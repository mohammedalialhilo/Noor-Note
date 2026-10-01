# Markdown table editor

Place the cursor in a GFM Markdown table and choose **Edit table** from the note toolbar or Note actions. Noor Note shows a visual grid where you can edit cells, add or remove rows and columns, move columns left or right, and set column alignment. Choose **Apply to Markdown** to replace only that table's source range. The editor refuses the change if the note changed after the table editor opened. CodeMirror keeps the change undoable.

The **Temporary sort view** previews rows in ascending or descending order using a chosen column. It never changes the Markdown row order, including when other grid edits are applied.

To convert CSV, select CSV text in the note or paste it into **CSV source**, then choose **Convert CSV**. Review the resulting grid and apply it to Markdown. The parser supports comma-separated fields, quoted commas, escaped double quotes, CRLF, and LF. CSV must have a header row and consistent column counts. Multiline CSV cells are rejected because a GFM table cell is one Markdown line. Leading and trailing CSV cell spaces are normalized when converted.

To convert a table to CSV, open it and use the **CSV output** preview or **Download CSV**. Export includes current grid edits even before they are applied to Markdown, so review the grid before downloading. The Markdown source is untouched by downloading.

Limits: 50 columns, 1,000 data rows, 10,000 characters per cell, and 1 MiB of CSV input. The table finder ignores fenced code and YAML frontmatter. Tables with irregular column counts are left for Source Mode rather than being silently reshaped.
