export const PRIORITY_LABELS = ['No priority', 'Urgent', 'High', 'Medium', 'Low'] as const;
/** Display order for priority groups/pickers: urgent first, none last. */
export const PRIORITY_ORDER = [1, 2, 3, 4, 0] as const;

export function relativeTime(iso: string, now = Date.now()): string {
  const diff = (now - Date.parse(iso)) / 1000;
  if (Math.abs(diff) < 45) return 'just now';
  const units: Array<[number, Intl.RelativeTimeFormatUnit]> = [
    [60, 'minute'],
    [3600, 'hour'],
    [86400, 'day'],
    [604800, 'week'],
    [2629800, 'month'],
    [31557600, 'year'],
  ];
  const fmt = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  let chosen: [number, Intl.RelativeTimeFormatUnit] = units[0]!;
  for (const u of units) if (Math.abs(diff) >= u[0]) chosen = u;
  return fmt.format(-Math.round(diff / chosen[0]), chosen[1]);
}

export function shortDate(value: string): string {
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  });
}

export function isOverdue(dueDate: string | null, completed: boolean): boolean {
  return !!dueDate && !completed && dueDate < new Date().toISOString().slice(0, 10);
}

/** The GitHub page of a repo (`owner/name`): the linked repo's own url when the project has it. */
export function repoUrl(repos: { fullName: string; url: string }[], fullName: string): string {
  const linked = repos.find((r) => r.fullName.toLowerCase() === fullName.toLowerCase());
  return linked?.url ?? `https://github.com/${fullName}`;
}
