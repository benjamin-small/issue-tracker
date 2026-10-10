import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ANONYMOUS_ACTOR, SYSTEM_ACTOR, withActor } from './context.ts';
import {
  type AccessLevel,
  atLeast,
  projectLevel,
  projectLevels,
  readableProjectIds,
  requireLevel,
  writableProjectIds,
} from './access.ts';
import { createProject } from './services/projects.ts';
import { createTestContext, grant, type TestContext } from './testing.ts';
import { testDialect } from '@poietic-tech/issues-db/testing';

describe(`access (${testDialect()})`, () => {
  let t: TestContext;
  let pub: { id: string; visibility: 'public' | 'private' };
  let priv: { id: string; visibility: 'public' | 'private' };
  beforeAll(async () => {
    t = await createTestContext();
    pub = await createProject(t.ctx, { key: 'PUB', name: 'Public', visibility: 'public' });
    priv = await createProject(t.ctx, { key: 'PRV', name: 'Private' });
  });
  afterAll(() => t.destroy());

  const level = (ctx: Parameters<typeof projectLevel>[0], p: typeof pub) =>
    projectLevel(ctx, t.db.kysely, p);

  it('gives admins and the system actor manage everywhere', async () => {
    expect(await level(t.ctx, priv)).toBe('manage');
    expect(await level(withActor(t.ctx, SYSTEM_ACTOR), priv)).toBe('manage');
  });

  it('maps roles to levels and public to read', async () => {
    expect(await level(t.member, priv)).toBe('none');
    expect(await level(t.member, pub)).toBe('read');
    await grant(t, 'PRV', t.member, 'viewer');
    expect(await level(t.member, priv)).toBe('read');
    await grant(t, 'PRV', t.member, 'editor');
    expect(await level(t.member, priv)).toBe('write');
    await grant(t, 'PRV', t.member, 'manager');
    expect(await level(t.member, priv)).toBe('manage');
  });

  it('gives anonymous read on public projects only', async () => {
    const anon = withActor(t.ctx, ANONYMOUS_ACTOR);
    expect(await level(anon, pub)).toBe('read');
    expect(await level(anon, priv)).toBe('none');
    expect(await readableProjectIds(anon, t.db.kysely)).toEqual([pub.id]);
  });

  it('lists public plus member projects, or all for admins', async () => {
    expect(await readableProjectIds(t.ctx, t.db.kysely)).toBe('all');
    expect(new Set(await readableProjectIds(t.agent, t.db.kysely))).toEqual(new Set([pub.id]));
    await grant(t, 'PRV', t.agent, 'viewer');
    expect(new Set(await readableProjectIds(t.agent, t.db.kysely))).toEqual(
      new Set([pub.id, priv.id]),
    );
  });

  it('gives each role its level on a public project, never below the read floor', async () => {
    const open = await createProject(t.ctx, { key: 'ROLES', name: 'Roles', visibility: 'public' });
    const anon = withActor(t.ctx, ANONYMOUS_ACTOR);
    expect(await level(anon, open)).toBe('read');
    expect(await level(t.member, open)).toBe('read'); // signed in, no role
    await grant(t, 'ROLES', t.member, 'viewer');
    expect(await level(t.member, open)).toBe('read');
    await grant(t, 'ROLES', t.member, 'editor');
    expect(await level(t.member, open)).toBe('write');
    await grant(t, 'ROLES', t.member, 'manager');
    expect(await level(t.member, open)).toBe('manage');
    // The batch lookup agrees with the single one, for every actor.
    for (const who of [t.ctx, t.member, t.agent, anon]) {
      const batch = await projectLevels(who, t.db.kysely, [pub, priv, open]);
      for (const p of [pub, priv, open])
        expect(batch.get(p.id), `${who.actor.handle} ${p.id}`).toBe(await level(who, p));
    }
  });

  it('lists the projects an actor can write in: memberships with write, never the public floor', async () => {
    const mine = await createProject(t.ctx, { key: 'WRT', name: 'Writable', visibility: 'public' });
    const other = await createProject(t.ctx, { key: 'WRO', name: 'Read only' });
    await grant(t, 'WRT', t.agent, 'editor');
    await grant(t, 'WRO', t.agent, 'viewer');
    expect(await writableProjectIds(t.ctx, t.db.kysely)).toBe('all');
    expect(await writableProjectIds(withActor(t.ctx, SYSTEM_ACTOR), t.db.kysely)).toBe('all');
    expect(await writableProjectIds(withActor(t.ctx, ANONYMOUS_ACTOR), t.db.kysely)).toEqual([]);
    const writable = await writableProjectIds(t.agent, t.db.kysely);
    expect(writable).toContain(mine.id);
    expect(writable).not.toContain(other.id);
    expect(writable).not.toContain(pub.id);
  });
});

describe('atLeast', () => {
  const levels: AccessLevel[] = ['none', 'read', 'write', 'manage'];
  it('orders none < read < write < manage', () => {
    for (const [i, have] of levels.entries())
      for (const [j, need] of levels.entries())
        expect(atLeast(have, need), `${have} >= ${need}`).toBe(i >= j);
  });
});

describe(`requireLevel (${testDialect()})`, () => {
  let t: TestContext;
  beforeAll(async () => {
    t = await createTestContext();
  });
  afterAll(() => t.destroy());

  const anon = () => withActor(t.ctx, ANONYMOUS_ACTOR);

  it('returns quietly when the level is enough, for every pair that qualifies', () => {
    const enough: [AccessLevel, 'read' | 'write' | 'manage'][] = [
      ['read', 'read'],
      ['write', 'read'],
      ['write', 'write'],
      ['manage', 'read'],
      ['manage', 'write'],
      ['manage', 'manage'],
    ];
    for (const [have, need] of enough)
      for (const ctx of [t.member, anon()])
        expect(
          () => requireLevel(ctx, have, need, 'Thing', 'x'),
          `${have} for ${need}`,
        ).not.toThrow();
  });

  it('reports no access as not found about the resource, even to anonymous actors', () => {
    for (const need of ['read', 'write', 'manage'] as const)
      for (const ctx of [t.member, anon()])
        expect(() => requireLevel(ctx, 'none', need, 'Label', 'lbl_1')).toThrow(
          expect.objectContaining({ code: 'NOT_FOUND', message: 'Label "lbl_1" not found' }),
        );
  });

  it('asks anonymous actors with some access, but not enough, to sign in', () => {
    for (const [have, need] of [
      ['read', 'write'],
      ['read', 'manage'],
      ['write', 'manage'],
    ] as const)
      expect(() => requireLevel(anon(), have, need, 'Thing', 'x')).toThrow(
        expect.objectContaining({ code: 'UNAUTHENTICATED', message: 'Sign in to make changes' }),
      );
  });

  it('forbids signed-in actors with some access, but not enough, saying what is missing', () => {
    for (const have of ['read'] as const)
      expect(() => requireLevel(t.member, have, 'write', 'Thing', 'x')).toThrow(
        expect.objectContaining({
          code: 'FORBIDDEN',
          message: 'You have read-only access to this project',
        }),
      );
    for (const have of ['read', 'write'] as const)
      expect(() => requireLevel(t.member, have, 'manage', 'Thing', 'x')).toThrow(
        expect.objectContaining({
          code: 'FORBIDDEN',
          message: 'Only project managers can do this',
        }),
      );
  });
});
