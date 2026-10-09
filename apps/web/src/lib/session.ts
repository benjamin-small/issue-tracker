import type { QueryClient } from '@tanstack/svelte-query';
import type { Schemas } from '@poietic-tech/issues-client';
import { api } from './api.ts';
import { navigate } from './nav.ts';

export type SsoConfig = NonNullable<Schemas['AuthConfig']['sso']>;

/** The outcome of an SSO sign-in attempt: signed in, or the server's problem response. */
export type SsoResult =
  | { ok: true }
  | { ok: false; status: number; problem: { code?: string; detail?: string } | undefined };

/**
 * Signs in with the SSO issuer's cookie: renews a lapsed cookie first (its tokens are short-lived; a failure just
 * means "not signed in"), then asks the server. Uses the raw client, not `call()`, so a 401 is an answer here
 * rather than a trigger for the global sign-in redirect. Network errors reject.
 */
export async function attemptSso(sso: SsoConfig): Promise<SsoResult> {
  if (sso.refreshUrl)
    await fetch(sso.refreshUrl, { credentials: 'include' }).catch(() => undefined);
  const { error, response } = await api.POST('/auth/sso');
  if (response.ok) return { ok: true };
  return {
    ok: false,
    status: response.status,
    problem: error as { code?: string; detail?: string } | undefined,
  };
}

const SILENT_SSO_KEY = 'poietic-issues.silent-sso';
/** Fallback when sessionStorage is unavailable: once per page load instead of once per browser session. */
let silentSsoDone = false;

/**
 * Whether this browser session should still try a silent SSO sign-in. It is tried once per session, and never
 * after signing out (the issuer's cookie would sign the visitor straight back in).
 */
export function silentSsoAllowed(): boolean {
  if (silentSsoDone) return false;
  try {
    return sessionStorage.getItem(SILENT_SSO_KEY) === null;
  } catch {
    return true;
  }
}

/** Records that the silent SSO attempt was made (or must not be made) for this browser session. */
export function markSilentSsoDone(): void {
  silentSsoDone = true;
  try {
    sessionStorage.setItem(SILENT_SSO_KEY, '1');
  } catch {
    // remembered for this page load only
  }
}

/** Signs out, forgets everything cached for this user, and lands on the sign-in page. */
export async function signOut(qc: QueryClient): Promise<void> {
  markSilentSsoDone();
  await api.POST('/auth/logout');
  qc.clear();
  await navigate('/login?signedout=1');
}
