# Charts and analytics

Create a **Chart** view inside a Base. The Base is the source; use the **Source Base** selector in chart settings to switch to another Base. The Base query, including offline search expressions, selects notes. Each chart view can add its own property filters. Chart settings choose type, fields, aggregation, sorting, bin count, and maximum groups.

Bar, line, area, pie, and donut charts group notes by a property, formula, folder, date, tag, or built-in field. Count counts notes; sum, average, minimum, and maximum use numeric values from the chosen value field. A note with multiple tags contributes once to each tag group. Pie and donut charts require nonnegative values and a positive total; other charts can show negative values. Histogram counts numeric values in configurable bins. Scatter plots numeric X and Y fields and can open a source note from its data table. Number/KPI shows a single aggregate over the filtered Base notes.

Values remain derived from Markdown properties and note summaries. No chart data is copied into a separate content store. Existing formula results can be chart fields. Chart configuration is saved with the Base and travels with full-vault ZIP exports. The chart engine is pure and does not use JavaScript evaluation.

Every chart presents a visible HTML table with a caption, column headers, and the same values as the graphic. SVG charts are hidden from assistive technology; scatter note links remain available in the table. Empty or invalid numeric fields produce a text explanation. Limits are explicit when data points or groups are omitted.

Current limits: charts render on the main thread from Base note summaries, with at most 100 grouped categories or 1,000 scatter points. Histograms count observations only. There is no chart image export or dashboard chart widget yet.
