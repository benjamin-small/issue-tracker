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

function as(
  token: string | undefined,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  return Promise.resolve(
    app.request(`${BASE}/api/v1${path}`, {
      method,
      headers: {
        ...(token && { authorization: `Bearer ${token}` }),
        'content-type': 'application/json',
        origin: BASE,
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    }),
  );
}

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

describe(`member and repo routes (${testDialect()})`, () => {
  it('manages members and repos over HTTP', async () => {
    const add = await as(adminToken, 'POST', '/projects/PRV/members', {
      user: '@member',
      role: 'viewer',
    });
    expect(add.status).toBe(201);
    const added = (await add.json()) as { user: { handle: string }; role: string };
    expect(added.user.handle).toBe('member');
    expect(added.role).toBe('viewer');
    expect((await as(memberToken, 'GET', '/projects/PRV')).status).toBe(200);

    const list = await as(memberToken, 'GET', '/projects/PRV/members');
    expect(list.status).toBe(200);
    const listed = (await list.json()) as { data: { user: { handle: string }; role: string }[] };
    expect(listed.data.map((m) => [m.user.handle, m.role])).toEqual([['member', 'viewer']]);

    // A viewer cannot manage.
    expect(
      (await as(memberToken, 'POST', '/projects/PRV/repos', { repo: 'acme/app' })).status,
    ).toBe(403);
    expect(
      (await as(memberToken, 'POST', '/projects/PRV/members', { user: 'admin', role: 'viewer' }))
        .status,
    ).toBe(403);
    expect(
      (await as(memberToken, 'PATCH', '/projects/PRV/members/@member', { role: 'manager' })).status,
    ).toBe(403);

    const patched = await as(adminToken, 'PATCH', '/projects/PRV/members/@member', {
      role: 'editor',
    });
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { role: string }).role).toBe('editor');
    expect(
      (await as(adminToken, 'POST', '/projects/PRV/members', { user: '@member', role: 'viewer' }))
        .status,
    ).toBe(409);

    const repo = await as(adminToken, 'POST', '/projects/PRV/repos', { repo: 'acme/app' });
    expect(repo.status).toBe(201);
    const linked = (await repo.json()) as { id: string; owner: string; name: string };
    expect(linked).toMatchObject({ owner: 'acme', name: 'app' });
    expect(linked.id.startsWith('rpo_')).toBe(true);
    expect((await as(adminToken, 'POST', '/projects/PRV/repos', { repo: 'acme/app' })).status).toBe(
      409,
    );
    expect(
      (await as(adminToken, 'POST', '/projects/PRV/repos', { repo: 'not a repo' })).status,
    ).toBe(400);
    const shown = (await (await as(adminToken, 'GET', '/projects/PRV')).json()) as {
      repos: { id: string }[];
    };
    expect(shown.repos.map((r) => r.id)).toEqual([linked.id]);

    // Unlink by URL-encoded owner/name, then by id.
    const byName = await as(
      adminToken,
      'DELETE',
      `/projects/PRV/repos/${encodeURIComponent('acme/app')}`,
    );
    expect(byName.status).toBe(204);
    expect(await byName.text()).toBe('');
    expect(
      (await as(adminToken, 'DELETE', `/projects/PRV/repos/${encodeURIComponent('acme/app')}`))
        .status,
    ).toBe(404);
    const again = (await (
      await as(adminToken, 'POST', '/projects/PRV/repos', { repo: 'acme/app' })
    ).json()) as { id: string };
    expect((await as(adminToken, 'DELETE', `/projects/PRV/repos/${again.id}`)).status).toBe(204);

    expect((await as(adminToken, 'DELETE', '/projects/PRV/members/@member')).status).toBe(204);
    expect((await as(adminToken, 'DELETE', '/projects/PRV/members/@member')).status).toBe(404);
    expect((await as(memberToken, 'GET', '/projects/PRV')).status).toBe(404);
  });

  it('hides private projects from non-members and rejects anonymous writes', async () => {
    expect((await as(memberToken, 'GET', '/projects/PRV/members')).status).toBe(404);
    expect(
      (await as(memberToken, 'POST', '/projects/PRV/repos', { repo: 'acme/app' })).status,
    ).toBe(404);
    expect((await as(memberToken, 'DELETE', '/projects/PRV/members/@member')).status).toBe(404);
    expect((await as(undefined, 'GET', '/projects/PRV/members')).status).toBe(404);
    expect((await as(undefined, 'GET', '/projects/PUB/members')).status).toBe(200);
    expect(
      (await as(undefined, 'POST', '/projects/PUB/members', { user: '@member', role: 'viewer' }))
        .status,
    ).toBe(401);
    expect((await as(undefined, 'POST', '/projects/PUB/repos', { repo: 'acme/app' })).status).toBe(
      401,
    );
    expect((await as(undefined, 'DELETE', '/projects/PUB/members/@member')).status).toBe(401);
    expect(
      (await as(memberToken, 'POST', '/projects/PUB/repos', { repo: 'acme/app' })).status,
    ).toBe(403);
  });
});
