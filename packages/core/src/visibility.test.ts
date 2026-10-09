import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDialect } from '@poietic-tech/issues-db/testing';
import { ANONYMOUS_ACTOR, withActor } from './context.ts';
import { createIssue, getIssue, updateIssue } from './services/issues.ts';
import { createProject, getProject } from './services/projects.ts';
import { createTestContext, grant, type TestContext } from './testing.ts';

describe(`project visibility (${testDialect()})`, () => {
  let t: TestContext;
  beforeAll(async () => {
    t = await createTestContext();
    await createProject(t.ctx, { key: 'PUB', name: 'Public', visibility: 'public' });
    await createProject(t.ctx, { key: 'PRV', name: 'Private' });
    await createIssue(t.ctx, 'PUB', { title: 'open' });
    await createIssue(t.ctx, 'PRV', { title: 'secret' });
  });
  afterAll(() => t.destroy());

  it('hides private projects and their issues as not found', async () => {
    await expect(getProject(t.member, 'PRV')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(getIssue(t.member, 'PRV-1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('lets anyone read public projects but only editors write', async () => {
    const anon = withActor(t.ctx, ANONYMOUS_ACTOR);
    expect((await getIssue(anon, 'PUB-1')).title).toBe('open');
    await expect(updateIssue(anon, 'PUB-1', { title: 'x' })).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await expect(updateIssue(t.member, 'PUB-1', { title: 'x' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await grant(t, 'PUB', t.member, 'editor');
    expect((await updateIssue(t.member, 'PUB-1', { title: 'x' })).title).toBe('x');
  });
});
