/** Base for resolving `next`: any fixed origin works, and it needs no `location` (the demo may run from `file:`). */
const BASE = 'http://app.invalid';

/**
 * The app path to go to after sign-in (or when continuing signed out), from an untrusted `?next=`. Only a path on
 * this origin passes: it must start with a single `/`, contain no backslash or control character (browsers turn
 * `\` into `/` and drop tabs and newlines, so `/\evil.com` or `/<TAB>/evil.com` would mean `//evil.com`), and
 * still resolve to the same origin. Anything else falls back to `/`.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/';
  for (const ch of next) {
    const code = ch.charCodeAt(0);
    if (ch === '\\' || code < 0x20 || code === 0x7f) return '/';
  }
  try {
    return new URL(next, BASE).origin === BASE ? next : '/';
  } catch {
    return '/';
  }
}
