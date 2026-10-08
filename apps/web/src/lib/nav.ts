import { goto, pushState } from '$app/navigation';
import { resolve } from '$app/paths';
import { page } from '$app/state';

/**
 * App-internal links and navigation that work with both routers: normal path routing (the served app) and hash
 * routing (the self-contained demo, which may be hosted at any URL). Always build internal URLs through these.
 */
const HASH = import.meta.env.POIETIC_ISSUES_DEMO;

/** Link target for an app path such as `/p/ENG/board` or `/login?next=/p/ENG`. */
export function href(path: string): string {
  if (HASH) return `#${path}`;
  const q = path.indexOf('?');
  const pathname = q < 0 ? path : path.slice(0, q);
  return (resolve as (p: string) => string)(pathname) + (q < 0 ? '' : path.slice(q));
}

/** Navigates to an app path. */
export function navigate(path: string, options?: Parameters<typeof goto>[1]): Promise<void> {
  return goto(href(path), options);
}

/** The current app path (without query) and its query parameters. */
export function current(): { path: string; params: URLSearchParams } {
  if (HASH) {
    const [path, query = ''] = page.url.hash.replace(/^#/, '').split('?');
    return { path: path || '/', params: new URLSearchParams(query) };
  }
  return { path: page.url.pathname, params: page.url.searchParams };
}

/** Absolute URL of an app path, for sharing. */
export function shareUrl(path: string): string {
  return new URL(href(path), location.href).href;
}

/** Shallow routing: a history entry with page state but the same app URL (e.g. the issue peek panel). */
export function pushPageState(state: App.PageState): void {
  pushState(HASH ? page.url.hash || '#/' : '', state);
}
