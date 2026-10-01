# Accessibility audit

Noor Note targets WCAG 2.2 AA where practical. This audit covers the local workspace in Chromium. Accessibility remains **PARTIAL** until assistive technology and cross-browser reviews cover the full feature set.

## Implemented in this pass

- Added visible keyboard focus for controls, including menus, Canvas objects, graph nodes, table controls, and editor controls.
- Raised light-theme text contrast and validated imported theme text and focus tokens before applying them.
- Restored focus to a dialog's trigger when the dialog closes. The note actions menu now supports arrow keys, Home, End, Escape, and focus restoration.
- Kept the activity rail's Settings control reachable at shorter desktop heights. Mobile editor tabs and actions have larger touch targets.
- Replaced compound tab semantics with labeled button groups where each resource has its own actions. Base view tabs retain tab semantics, use one tab stop, and support arrow, Home, and End keys.
- Added a table caption, sort state, keyboard column movement, and keyboard-operable column resize controls to Base tables.
- Added a collapsible list of Canvas cards and connectors with selection, movement, editing, and note opening. Canvas cards and resize handles also support keyboard operation. The graph retains its searchable node list; graph context menus support keyboard navigation.
- Disabled animated graph camera movement when reduced motion is requested.

## Verification

`corepack pnpm --filter @noor-note/web test:e2e` runs five Playwright workflows in Chromium. They scan the initial workspace, a note, graph, populated Canvas, Base table, Settings, and command dialog with axe rules tagged WCAG 2 A/AA, 2.1 A/AA, and 2.2 AA. The workflows also check keyboard menu and tab operation, dialog focus trapping and restoration, Base sort state, Canvas list movement, dark theme, reduced motion, and 640 px and 320 px CSS viewports. Serious and critical axe findings fail the workflow. CI installs Chromium and runs these tests after lint, typecheck, unit tests, and build.
Keyboard focus also opens an activity tooltip, and Escape dismisses it.

Desktop Base and 320 px mobile note screenshots were visually reviewed. The mobile workspace retains its bottom navigation, readable editor controls, and visible focus. The desktop Base exposes the current view and table sort state. A development-server `DatabaseClosedError` notification appeared in screenshots; it requires separate investigation and was not seen as a Playwright `pageerror` in the narrow-viewport test.
Set `NOOR_A11Y_SCREENSHOT=1` when running the browser suite to save review images under the ignored `apps/web/test-results` directory.

The 640 px and 320 px viewport checks approximate reflow at 200% and 400% on a 1280 px screen. They do not replace testing real browser zoom, browser text scaling, or operating-system magnification.

## Remaining review

| Area | Current state | Follow-up |
| --- | --- | --- |
| Keyboard and focus | Core navigation, note menu, dialog, Base tabs/table, graph and Canvas alternatives checked in Chromium | Audit every specialized editor, importer, settings panel, and plugin surface with keyboard only |
| Screen readers | Semantic labels, roles, sort state, and Canvas/graph alternatives added | Review with NVDA/JAWS and VoiceOver; check announcements during editing and dynamic updates |
| Contrast and themes | Built-in light/dark surfaces scanned; local theme text tokens checked | Check user CSS snippets, all imported themes, charts, PDF annotations, and Canvas colors manually |
| Reflow and touch | 640/320 px shell and note workflow tested; mobile navigation and editor targets checked | Test actual 200%/400% zoom, text-only scaling, landscape devices, and physical touch targets |
| Motion | Reduced-motion browser setting covered; graph camera obeys it | Review Canvas, charts, presentations, and plugin animations |
| Graph and Canvas | Searchable/list alternatives support core selection and navigation | Test complex connectors and spatial editing with screen readers; improve nonvisual layout descriptions |
| Data views and forms | Base table and view tabs checked | Audit all Base view kinds, form validation messages, calendar, dashboards, and task drag alternatives |
| Browsers and devices | Chromium automation and screenshot review | Repeat in Firefox, WebKit/Safari, and on physical mobile devices |

Automated scans cannot prove WCAG conformance. Record manual findings and regression tests here as each remaining surface is reviewed.
