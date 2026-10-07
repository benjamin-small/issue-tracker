/**
 * Verifies ES256 JWTs from an SSO issuer against its JWKS, with WebCrypto only (no dependency).
 *
 * Adapted from poietic-dot-tech packages/identity/verify.ts at 13d40d7: the cache lives in the verifier
 * (not module scope) and time comes from an injected clock, so tests and several issuers stay independent.
 * Returns claims or null — null is the only failure signal, so an unverified payload can never be used by mistake.
 * Throws only when no keys could be obtained at all.
 */

import type { webcrypto } from 'node:crypto';

export type JsonWebKey = Record<string, unknown>;
export type CryptoKey = webcrypto.CryptoKey;

export interface SsoClaims {
  iss: string;
  sub: string;
  aud: string;
  role: string;
  name: string;
  iat: number;
  exp: number;
}

export interface JwtVerifier {
  verify(token: string): Promise<SsoClaims | null>;
}

/** JWKS is cached this long; a rotation publishes a new `kid`, which forces a refetch sooner. */
const JWKS_TTL_MS = 3_600_000;
/** How often an unknown `kid` may force a refetch, so forged kids can't turn requests into JWKS fetches. */
const FORCED_REFETCH_MIN_MS = 60_000;

function b64urlDecode(value: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(value, 'base64url'));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSegment(segment: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(b64urlDecode(segment)));
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

export function createJwtVerifier(opts: {
  jwksUrl: string;
  issuer: string;
  audience: string;
  fetchImpl?: typeof fetch;
  /** Abort a JWKS fetch after this many milliseconds (default 5000). */
  fetchTimeoutMs?: number;
  /** Milliseconds since the epoch. */
  now?: () => number;
}): JwtVerifier {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  let cache: { keys: Map<string, webcrypto.CryptoKey>; fetchedAt: number } | null = null;
  let inFlight: Promise<Map<string, webcrypto.CryptoKey>> | null = null;
  let lastForcedAt = -Infinity;

  async function fetchKeys(): Promise<Map<string, webcrypto.CryptoKey>> {
    const res = await fetchImpl(opts.jwksUrl, {
      signal: AbortSignal.timeout(opts.fetchTimeoutMs ?? 5000),
    });
    if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
    const body = (await res.json()) as { keys?: (JsonWebKey & { kid?: string })[] };
    const keys = new Map<string, webcrypto.CryptoKey>();
    for (const jwk of body.keys ?? []) {
      if (!jwk.kid) continue;
      try {
        keys.set(
          jwk.kid,
          await crypto.subtle.importKey(
            'jwk',
            { ...jwk, key_ops: ['verify'] },
            { name: 'ECDSA', namedCurve: 'P-256' },
            true,
            ['verify'],
          ),
        );
      } catch {
        // A malformed key must not poison the usable ones.
      }
    }
    return keys;
  }

  async function loadKeys(force: boolean): Promise<Map<string, CryptoKey>> {
    if (cache && !force && now() - cache.fetchedAt < JWKS_TTL_MS) return cache.keys;
    inFlight ??= fetchKeys()
      .then((keys) => {
        // A response with no usable keys must not evict a working cache.
        if (keys.size === 0 && cache) cache = { keys: cache.keys, fetchedAt: now() };
        else cache = { keys, fetchedAt: now() };
        return cache.keys;
      })
      .finally(() => {
        inFlight = null;
      });
    try {
      return await inFlight;
    } catch (error) {
      // Serve stale keys rather than failing every sign-in while the issuer is briefly unreachable.
      if (cache) return cache.keys;
      throw error;
    }
  }

  return {
    async verify(token) {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const [rawHeader, rawBody, rawSig] = parts as [string, string, string];
      const header = parseSegment(rawHeader);
      // Only ES256, by allowlist: stops alg confusion, including alg=none.
      if (!header || header.alg !== 'ES256' || typeof header.kid !== 'string' || !header.kid)
        return null;

      let key = (await loadKeys(false)).get(header.kid);
      if (!key && now() - lastForcedAt >= FORCED_REFETCH_MIN_MS) {
        lastForcedAt = now();
        key = (await loadKeys(true)).get(header.kid);
      }
      if (!key) return null;

      let ok: boolean;
      try {
        ok = await crypto.subtle.verify(
          { name: 'ECDSA', hash: 'SHA-256' },
          key,
          b64urlDecode(rawSig),
          new TextEncoder().encode(`${rawHeader}.${rawBody}`),
        );
      } catch {
        return null;
      }
      if (!ok) return null;

      const claims = parseSegment(rawBody);
      if (!claims) return null;
      const nowS = Math.floor(now() / 1000);
      if (claims.iss !== opts.issuer || claims.aud !== opts.audience) return null;
      if (typeof claims.exp !== 'number' || claims.exp <= nowS) return null;
      if (typeof claims.iat !== 'number' || claims.iat > nowS + 60) return null;
      for (const field of ['sub', 'role', 'name'] as const)
        if (typeof claims[field] !== 'string' || !claims[field]) return null;
      return claims as unknown as SsoClaims;
    },
  };
}
