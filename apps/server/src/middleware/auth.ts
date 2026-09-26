import { actorForUser, authenticateSession, authenticateToken, SYSTEM_ACTOR } from '@tracker/core';
import { newId } from '@tracker/schema';
import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { type AppEnv, type ResolvedDeps, SESSION_COOKIE } from '../env.ts';
import { problem } from '../problem.ts';

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Assigns a request id (honouring a client-supplied `X-Request-Id`) and echoes it back. */
export const requestId = createMiddleware<AppEnv>(async (c, next) => {
  const incoming = c.req.header('x-request-id');
  const id =
    incoming && /^[\w.:-]{1,100}$/.test(incoming)
      ? incoming
      : newId('event').replace('evt_', 'req_');
  c.set('requestId', id);
  await next();
  c.header('x-request-id', id);
});

/**
 * Resolves the actor from a bearer token, a session cookie, or (trusted mode) configuration, and builds the
 * per-request ServiceContext. Cookie-authenticated unsafe requests must be same-origin (CSRF protection);
 * bearer requests carry no ambient credentials and are exempt.
 */
export function authenticate(deps: ResolvedDeps) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const db = deps.getDb();
    const clock = deps.clock ?? { now: () => new Date() };
    let actor = null;
    let via: AppEnv['Variables']['authVia'] = null;

    if (deps.auth.mode === 'trusted') {
      actor = await actorForUser({ db, actor: SYSTEM_ACTOR }, deps.auth.actor);
      if (!actor)
        return problem(
          c,
          'UNAUTHENTICATED',
          `Local actor "${deps.auth.actor}" not found or deactivated`,
        );
      via = 'trusted';
    } else {
      const header = c.req.header('authorization');
      if (header) {
        const match = /^Bearer\s+(\S+)$/i.exec(header);
        actor = match ? await authenticateToken({ db, clock }, match[1]!) : null;
        if (!actor) return problem(c, 'UNAUTHENTICATED', 'Invalid, expired or revoked token');
        via = 'bearer';
      } else {
        const cookie = getCookie(c, SESSION_COOKIE);
        if (cookie) {
          actor = await authenticateSession({ db, clock }, cookie);
          if (actor) {
            via = 'session';
            if (UNSAFE.has(c.req.method) && !sameOrigin(c.req.raw, deps.auth.allowedOrigins ?? []))
              return problem(c, 'FORBIDDEN', 'Cross-origin request rejected (CSRF protection)');
          }
        }
      }
    }

    c.set('actor', actor);
    c.set('authVia', via);
    c.set('ctx', {
      db,
      actor: actor ?? SYSTEM_ACTOR,
      clock,
      ids: deps.ids ?? newId,
      requestId: c.get('requestId'),
    });
    await next();
  });
}

/** Requires an authenticated actor. */
export const requireActor = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get('actor'))
    return problem(
      c,
      'UNAUTHENTICATED',
      'Authenticate with "Authorization: Bearer <token>" or sign in',
    );
  await next();
});

function sameOrigin(request: Request, allowed: string[]): boolean {
  const target = new URL(request.url).origin;
  const origin = request.headers.get('origin');
  if (origin) return origin === target || allowed.includes(origin);
  const site = request.headers.get('sec-fetch-site');
  if (site) return site === 'same-origin' || site === 'none';
  const referer = request.headers.get('referer');
  if (referer) {
    try {
      const ref = new URL(referer).origin;
      return ref === target || allowed.includes(ref);
    } catch {
      return false;
    }
  }
  // Non-browser clients (no Origin/Referer/Sec-Fetch-*) cannot be CSRF vectors.
  return true;
}
