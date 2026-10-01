# Themes and CSS snippets

**Status: PARTIAL.** Settings → Appearance provides built-in Light, Dark, and System modes, local color theme installation, and constrained CSS snippets. Appearance data stays in this browser's `localStorage` under `noor-note-appearance`; it is not included in vault ZIP exports or cloud sync. Clearing browser storage removes installed themes and snippets.

## Local theme package

A theme is a JSON file containing `id`, `name`, `version`, `author`, `base` (`light` or `dark`), and a `tokens` object. See [Amber Paper](../examples/themes/amber.noor-theme.json) for an installable example. The `base` supplies built-in fallback values for tokens omitted by the package. The package must provide readable background, surface, text, muted text, border, accent, editor, syntax, graph, Canvas, and Base colors. Text contrast against the background and surface is checked at installation.

Theme tokens are CSS custom properties. The accepted token names are defined in `apps/web/src/theme/appearance.ts` and include:

| Area | Example tokens |
| --- | --- |
| Workspace | `--nn-bg`, `--nn-surface`, `--nn-text`, `--nn-text-muted`, `--nn-border`, `--nn-accent` |
| Editor and syntax | `--nn-editor-bg`, `--nn-editor-text`, `--nn-syntax-heading`, `--nn-syntax-link`, `--nn-syntax-keyword`, `--nn-syntax-string`, `--nn-syntax-comment` |
| Graph | `--nn-graph-node`, `--nn-graph-edge`, `--nn-graph-group-1` through `--nn-graph-group-6` |
| Canvas | `--nn-canvas-bg`, `--nn-canvas-card` |
| Bases | `--nn-base-bg`, `--nn-base-header`, `--nn-base-row-hover` |

Installed themes can be enabled, disabled, replaced through another reviewed file install, or removed. Disabling a local theme returns to the last built-in selection. The app applies a custom theme after hydration, so the first frame can briefly show the built-in colors.

## CSS snippets

Snippets are intended for small visual adjustments. Example:

```css
:root { --nn-accent: #665599; }
.cm-content { font-size: 16px; line-height: 1.6; }
```

Supported selectors are exactly `:root`, `body`, `.cm-editor`, `.cm-content`, `.cm-line`, `.cm-gutters`, and `.nn-reading`. A snippet can set known Noor Note color tokens on `:root`, hex colors through `color`, `background-color`, `border-color`, or `caret-color`, and bounded typography values through `font-size`, `line-height`, `letter-spacing`, `border-radius`, `font-weight`, and `font-family`. Snippets can be edited, enabled, disabled, and removed in Settings. Unsupported rules are rejected before storage.

Arbitrary CSS can request external resources through `url()` or `@import`, conceal controls, and mislead users visually. Noor Note reconstructs CSS from a strict subset: it rejects at-rules, URLs, escapes, unknown selectors and properties, and layout or interaction declarations. This prevents snippets from loading remote assets or changing application event handlers and data. A permitted color choice can still reduce legibility, so review the result in Light and Dark modes and keep a way to return to Settings. The parser and storage path have automated tests; a cross-browser visual and accessibility audit remains pending.
