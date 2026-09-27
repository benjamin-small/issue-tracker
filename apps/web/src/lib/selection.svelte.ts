/**
 * Keyboard focus and multi-selection over the issues on screen (list rows or board cards).
 * The visible order is registered by whichever view is showing, so j/k and shift-click ranges follow it.
 */
export const selection = $state({
  /** Issue keys in on-screen order. */
  order: [] as string[],
  focused: null as string | null,
  selected: [] as string[],
  /** Last clicked or toggled key, the anchor for shift-click ranges. */
  anchor: null as string | null,
});

export function setOrder(keys: string[]) {
  selection.order = keys;
  if (selection.focused && !keys.includes(selection.focused)) selection.focused = null;
  if (selection.selected.some((k) => !keys.includes(k)))
    selection.selected = selection.selected.filter((k) => keys.includes(k));
}

export function isSelected(key: string): boolean {
  return selection.selected.includes(key);
}

export function toggleSelected(key: string, range = false) {
  if (range && selection.anchor) {
    const a = selection.order.indexOf(selection.anchor);
    const b = selection.order.indexOf(key);
    if (a >= 0 && b >= 0) {
      const span = selection.order.slice(Math.min(a, b), Math.max(a, b) + 1);
      selection.selected = [...selection.selected, ...span.filter((k) => !isSelected(k))];
      selection.focused = key;
      return;
    }
  }
  selection.selected = isSelected(key)
    ? selection.selected.filter((k) => k !== key)
    : [...selection.selected, key];
  selection.anchor = key;
  selection.focused = key;
}

export function clearSelection() {
  selection.selected = [];
  selection.anchor = null;
}

/** Moves keyboard focus by `delta` rows/cards; returns the newly focused key. */
export function moveFocus(delta: number): string | null {
  const { order } = selection;
  if (order.length === 0) return null;
  const index = selection.focused ? order.indexOf(selection.focused) : -1;
  const next =
    index < 0
      ? delta > 0
        ? 0
        : order.length - 1
      : Math.min(order.length - 1, Math.max(0, index + delta));
  selection.focused = order[next]!;
  return selection.focused;
}
