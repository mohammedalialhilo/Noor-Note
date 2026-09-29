# @noor-note/ui

Reusable accessible controls for Noor Note. Import `@noor-note/ui/styles.css` once from the web app root layout, then import components from `@noor-note/ui`.

The stylesheet defines neutral `--nn-*` token defaults. Application themes can override them at `:root` or `[data-theme]` without changing component CSS.

## Components

- `Button`, `IconButton`, `Input`, `Select`
- `DropdownMenu` (`Menu` alias), `ContextMenu`, `Dialog`, `Tooltip`, `Tabs`, `ToastProvider`, `Toast`
- `Sidebar`, `CommandSurface`, `LoadingIndicator`, `EmptyState`, `ErrorState`

Dropdown menus, context menus, dialogs, tabs, tooltips, and toasts use Radix primitives for focus, keyboard, and screen reader behavior. The `Select` component is a native select so it retains operating system keyboard and touch behavior. `Dialog` is a complete accessible dialog with a required title. For custom layouts use `DialogRoot`, `DialogTrigger`, `DialogContent`, `DialogTitle`, and `DialogDescription` together.

`CommandSurface` receives controlled `open` and `onOpenChange` props plus an array of `CommandItem` objects. Each item needs a stable `id`, a visible `label`, and a real `onSelect` action. Search supports labels, descriptions, and optional keywords. Arrow keys move through actions; Enter activates the focused button.

`IconButton` requires an accessible `aria-label`. Inputs and selects should receive a visible `label`, or an `aria-label` for compact search controls.
