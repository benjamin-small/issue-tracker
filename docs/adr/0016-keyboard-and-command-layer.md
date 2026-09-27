# 0016. One keyboard, selection and command layer for the web app

- **Status:** Accepted
- **Date:** 2026-09-27

## Context

The web app was mouse-only. Each view handled its own clicks, bulk edits weren't possible, and destructive actions used the browser's `confirm()`. That dialog is unstyled, blocks the page, and does nothing in some embeds (the browser demo had to stub it). The people using a tracker all day expect Linear-style keys: ⌘K, j/k, x to select, and single letters to change a field.

## Decision

- **Shortcuts are global, handled in one place.** The `(app)` layout has a single `keydown` handler. It ignores keys typed into inputs and keys pressed while any dialog or menu is open. Views don't register their own shortcuts.
- **Views publish their order; they don't own focus.** `$lib/selection.svelte.ts` holds the focused key, the selected keys and the on-screen order. The list and the board each call `setOrder` with what they show, so j/k and shift-click ranges follow the visible layout.
- **What an action applies to** is resolved the same way everywhere: the selection, else the open issue, else the focused row or card.
- **Every action is in the command menu.** ⌘K (`CommandMenu.svelte`) lists issue actions, creation, navigation and preferences. Field shortcuts (s, a, p, l) open the same menu in a sub-mode, so each action is written once.
- **Bulk edits use `POST /issues/bulk`.** That keeps multi-issue changes atomic, and one toast (with one Undo for deletes) covers the whole set.
- **No `window.confirm`.** Destructive actions call `confirmAction()` from `$lib/confirm.svelte.ts`, which renders the app's own alert dialog and resolves a promise.

## Consequences

- New views must call `setOrder` to take part in keyboard navigation and selection.
- New actions belong in the command menu first. A button or shortcut is an extra way to reach them.
- The shortcut list lives in `ShortcutsDialog.svelte` (opened with `?`). Update it together with the layout handler.
