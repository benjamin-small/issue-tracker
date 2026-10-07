import { createTestContext, type TestContext } from '@tracker/core/testing';
import { testDialect } from '@tracker/db/testing';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import type { SsoOptions } from './env.ts';
import type { SsoClaims } from './sso/jwt.ts';

const BASE = 'http://tracker.test';
const ISS = 'https://auth.example.test';
let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.destroy());

/** A fake verifier: the cookie value is the subject; "admin-*" subjects carry role admin; "bad" fails; "down" throws. */
function sso(): SsoOptions {
  return {
    name: 'Example',
    cookie: 'example_session',
    issuer: ISS,
    loginUrl: `${ISS}/login`,
    refreshUrl: `${ISS}/me`,
    adminRole: 'admin',
    verifier: {
      verify: async (token) => {
        if (token === 'down') throw new Error('JWKS unavailable');
        return token === 'bad'
          ? null
          : ({
              iss: ISS,
              aud: 'x',
              sub: token,
              name: `Person ${token}`,
              role: token.startsWith('admin') ? 'admin' : 'user',
              iat: 0,
              exp: 0,
            } satisfies SsoClaims);
      },
    },
  };
}

function post(app: ReturnType<typeof createApp>, cookie: string | null, origin = BASE) {
  const headers: Record<string, string> = { origin };
  if (cookie !== null) headers.cookie = `example_session=${cookie}`;
  return app.request(`${BASE}/api/v1/auth/sso`, { method: 'POST', headers });
}

describe(`SSO sign-in (${testDialect()})`, () => {
  it('advertises SSO in /auth/config', async () => {
    const app = createApp({ db: t.db, auth: { mode: 'standard', sso: sso() } });
    const res = await app.request(`${BASE}/api/v1/auth/config`);
    expect(await res.json()).toMatchObject({
      devLogin: false,
      sso: { name: 'Example', loginUrl: `${ISS}/login`, refreshUrl: `${ISS}/me` },
    });
    const off = createApp({ db: t.db, auth: { mode: 'standard' } });
    expect(await (await off.request(`${BASE}/api/v1/auth/config`)).json()).toMatchObject({
      sso: null,
    });
  });

  it('signs an admin-role identity in with a tracker session', async () => {
    const app = createApp({ db: t.db, auth: { mode: 'standard', sso: sso() } });
    const res = await post(app, 'admin-1');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ role: 'admin', name: 'Person admin-1' });
    const session = res.headers.get('set-cookie')!.split(';')[0]!;
    expect(session).toMatch(/^tracker_session=/);
    const me = await app.request(`${BASE}/api/v1/me`, { headers: { cookie: session } });
    expect(((await me.json()) as { name: string }).name).toBe('Person admin-1');
  });

  it('answers PENDING_APPROVAL for a new non-admin identity, without a session', async () => {
    const app = createApp({ db: t.db, auth: { mode: 'standard', sso: sso() } });
    const res = await post(app, 'u-1');
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('PENDING_APPROVAL');
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('answers 401 without a valid cookie, 403 cross-origin, 404 when off', async () => {
    const app = createApp({ db: t.db, auth: { mode: 'standard', sso: sso() } });
    expect((await post(app, null)).status).toBe(401);
    expect((await post(app, 'bad')).status).toBe(401);
    expect((await post(app, 'admin-2', 'https://evil.example')).status).toBe(403);
    const off = createApp({ db: t.db, auth: { mode: 'standard' } });
    expect((await post(off, 'admin-3')).status).toBe(404);
  });

  it('answers 503 UNAVAILABLE, with no session, when the verifier cannot reach the issuer', async () => {
    const app = createApp({ db: t.db, auth: { mode: 'standard', sso: sso() } });
    const res = await post(app, 'down');
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe('UNAVAILABLE');
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('logs a warning when the verifier fails', async () => {
    const lines: string[] = [];
    const logger = pino({ level: 'warn' }, { write: (l: string) => void lines.push(l) });
    const app = createApp({ db: t.db, auth: { mode: 'standard', sso: sso() }, logger });
    await post(app, 'down');
    expect(lines.join('')).toContain('JWKS unavailable');
  });
});
