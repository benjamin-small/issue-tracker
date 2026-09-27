/** A GFM task-list item marker at the start of a line: `- [ ] `, `* [x] `, `1. [ ] `… */
const TASK = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/;
const FENCE = /^\s*(```|~~~)/;

/**
 * Checks or unchecks the `index`-th task item (in document order, skipping fenced code, the same
 * order marked renders the checkboxes in). Returns the source unchanged if there is no such item.
 */
export function setTaskChecked(source: string, index: number, checked: boolean): string {
  const lines = source.split('\n');
  let fence: string | null = null;
  let seen = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const f = FENCE.exec(line);
    if (f) {
      if (fence === null) fence = f[1]!;
      else if (f[1] === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const m = TASK.exec(line);
    if (!m) continue;
    if (seen++ === index) {
      lines[i] = line.replace(TASK, `$1${checked ? 'x' : ' '}$3`);
      return lines.join('\n');
    }
  }
  return source;
}
