# Markdown presentations

Use a whole-line `<!-- slide -->` comment between slides. A note without a separator is one slide. Ordinary Markdown thematic breaks (`---`) remain part of the slide, so existing notes do not change meaning when presented. YAML frontmatter is omitted from the audience view. Separators inside fenced or indented code are treated as code.

Add private presenter cues with a comment block inside a slide:

````markdown
# Research update

Main point for the audience.

<!-- speaker-notes
Mention the source of the figures.
Pause for questions.
-->

<!-- slide -->

## Next finding

More Markdown, including images and diagrams.
````

Press **Present note** in the note toolbar or choose **Present current note** in the command palette. Use Previous and Next, Left and Right arrows, Page Up and Page Down, Space, Home, and End to move. Press N to toggle speaker notes, F to toggle fullscreen, or Escape to exit. Fullscreen requires browser support and a user action; the presentation stays usable in its window if the request fails. Speaker notes are hidden while fullscreen is active so they are not shown on the presentation display.

`packages/core/src/presentation.ts` derives a slide list from canonical Markdown without writing to the note. `NotePresentation` displays one slide using `MarkdownReadingView`, so links, local images, math, and Mermaid use the existing reading path. A future PDF exporter should consume the same slide list and a dedicated export renderer; it should not fork the note editor or create a second content store. There is no PDF export command yet.

The current slide model is intentionally simple: no slide layouts, transitions, presenter window, or embedded video playback controls. Speaker notes are plain text in the presenter panel. A browser-level fullscreen and accessibility review remains pending.
