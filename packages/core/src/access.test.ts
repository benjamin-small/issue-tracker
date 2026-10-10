import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ANONYMOUS_ACTOR, SYSTEM_ACTOR, withActor } from './context.ts';
import { projectLevel, readableProjectIds } from './access.ts';
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
});
