import { createToken } from '@poietic-tech/issues-core';
import { createTestContext, type TestContext } from '@poietic-tech/issues-core/testing';
import { testDialect } from '@poietic-tech/issues-db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';

let t: TestContext;
let app: ReturnType<typeof createApp>;
let adminToken: string;
let memberToken: string;

const BASE = 'http://tracker.test';

function asAdmin(path: string, init: { method?: string; body?: unknown } = {}) {
  return app.request(`${BASE}/api/v1${path}`, {
    method: init.method ?? 'GET',
    headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
    ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
  });
}

beforeAll(async () => {
  t = await createTestContext();
  app = createApp({ db: t.db, auth: { mode: 'standard', allowDevLogin: true } });
  adminToken = (await createToken(t.ctx, 'admin', { name: 'test' })).token;
  memberToken = (await createToken(t.member, 'member', { name: 'test' })).token;
  for (const [key, visibility] of [
    ['PUB', 'public'],
    ['PRV', 'private'],
  ] as const) {
    const res = await asAdmin('/projects', {
      method: 'POST',
      body: { key, name: key, visibility },
    });
    expect(res.status).toBe(201);
  }
});
afterAll(() => t.destroy());

describe(`anonymous HTTP access (${testDialect()})`, () => {
  it('treats requests without credentials as anonymous, never as admin', async () => {
    const me = await app.request(`${BASE}/api/v1/me`);
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ anonymous: true });
    expect((await app.request(`${BASE}/api/v1/projects`)).status).toBe(200);
    const list = (await (await app.request(`${BASE}/api/v1/projects`)).json()) as {
      data: { key: string; myAccess: string }[];
    };
    expect(list.data.map((p) => [p.key, p.myAccess])).toEqual([['PUB', 'read']]);
    expect((await app.request(`${BASE}/api/v1/projects/PRV`)).status).toBe(404);
    expect((await app.request(`${BASE}/api/v1/users`)).status).toBe(401);
    const post = await app.request(`${BASE}/api/v1/projects/PUB/issues`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE },
      body: JSON.stringify({ title: 'x' }),
    });
    expect(post.status).toBe(401);
    const admin = await app.request(`${BASE}/api/v1/webhooks`);
    expect(admin.status).not.toBe(200);
  });

  it('reports the access level of signed-in callers on project responses', async () => {
    const res = await app.request(`${BASE}/api/v1/projects`, {
      headers: { authorization: `Bearer ${memberToken}` },
    });
    const body = (await res.json()) as { data: { key: string; myAccess: string }[] };
    expect(body.data.map((p) => [p.key, p.myAccess])).toEqual([['PUB', 'read']]);
    const admin = (await (await asAdmin('/projects/PRV')).json()) as { myAccess: string };
    expect(admin.myAccess).toBe('manage');
  });

  it('does not reveal whether a user exists through their tokens', async () => {
    for (const user of ['admin', 'member', 'nobody-here']) {
      const res = await app.request(`${BASE}/api/v1/users/${user}/tokens`);
      expect(res.status, user).toBe(401);
      expect(((await res.json()) as { code: string }).code).toBe('UNAUTHENTICATED');
    }
  });

  it('still rejects an invalid bearer token instead of falling back to anonymous', async () => {
    const res = await app.request(`${BASE}/api/v1/projects`, {
      headers: { authorization: 'Bearer trk_nope' },
    });
    expect(res.status).toBe(401);
  });

  it('keeps the sign-in endpoints working for signed-out callers', async () => {
    const config = (await (await app.request(`${BASE}/api/v1/auth/config`)).json()) as {
      users: { handle: string; email?: unknown }[];
    };
    expect(config.users.map((u) => u.handle)).toContain('member');
    expect(config.users.every((u) => !('email' in u))).toBe(true);

    const dev = await app.request(`${BASE}/api/v1/auth/dev-login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE },
      body: JSON.stringify({ user: 'member' }),
    });
    expect(dev.status).toBe(200);
    expect(((await dev.json()) as { handle: string }).handle).toBe('member');

    const tokenLogin = await app.request(`${BASE}/api/v1/auth/token-login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE },
      body: JSON.stringify({ token: memberToken }),
    });
    expect(tokenLogin.status).toBe(200);
    expect(((await tokenLogin.json()) as { handle: string }).handle).toBe('member');
  });
});
