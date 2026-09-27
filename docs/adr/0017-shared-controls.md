# 0017. Shared controls instead of native form widgets

- **Status:** Accepted
- **Date:** 2026-09-27

## Context

The web app mixed its own pickers with native `<select>`, `type="date"` and `type="color"` inputs. The native widgets look different in every browser and ignore the dark theme. The colour input and date input give no quick picks. Button styles had drifted too, with a dozen hand-written variants and inconsistent disabled states.

## Decision

- **Buttons and bordered inputs use `$lib/styles.ts`**: `btn.primary`, `btn.primarySm`, `btn.secondary`, `btn.ghost` and `btn.danger`, plus `input`. Pages don't define their own button or input class strings.
- **No native `<select>`, date or colour inputs.** Use these components instead:
  - `Select.svelte` for single choices.
  - `Picker.svelte` for searchable single or multi choices.
  - `DateInput.svelte` for dates: a calendar with Today, Tomorrow and In a week.
  - `ColorInput.svelte` for colours: a palette plus a hex field.
  - `SortableList.svelte` for anything the user orders. It is drag-to-reorder with a grip, and works from the keyboard too.
- **Property editors show what they would set** ("Set due date", "Unassigned", "No priority") in muted text, never a bare "—", so empty values still read as editable.
- **Filter chips state the condition** ("Status is Todo, In Progress"): `is`/`is not` toggles, and the × removes the filter.

## Consequences

- Controls look and behave the same across browsers, themes and the browser demo.
- e2e tests pick options through the `choose()` fixture instead of `selectOption`.
- New form controls should reuse or extend these components rather than add a native widget.
