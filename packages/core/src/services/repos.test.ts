import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDialect } from '@poietic-tech/issues-db/testing';
import { addRepo, parseRepoRef, removeRepo } from './repos.ts';
import { createProject, getProject } from './projects.ts';
import { createIssue } from './issues.ts';
import { createTestContext, type TestContext } from '../testing.ts';

describe('parseRepoRef', () => {
  it.each([
    ['acme/app', { owner: 'acme', name: 'app' }],
    ['https://github.com/acme/app', { owner: 'acme', name: 'app' }],
    ['https://github.com/acme/app.git', { owner: 'acme', name: 'app' }],
    ['github.com/acme/app/pull/12', { owner: 'acme', name: 'app' }],
  ])('parses %s', (input, expected) => expect(parseRepoRef(input)).toEqual(expected));
  it.each(['acme', 'https://gitlab.com/acme/app', 'acme/app/extra?x', '-bad/app', 'acme/ap p'])(
    'rejects %s',
    (input) => expect(() => parseRepoRef(input)).toThrow(/repository/i),
  );
});

describe(`repo links (${testDialect()})`, () => {
  let t: TestContext;
  beforeAll(async () => {
    t = await createTestContext();
    await createProject(t.ctx, { key: 'ENG', name: 'Eng' });
  });
  afterAll(() => t.destroy());

  it('adds and lists repos, rejects duplicates, and removes them', async () => {
    const repo = await addRepo(t.ctx, 'ENG', { repo: 'https://github.com/Acme/App' });
    expect(repo).toMatchObject({
      owner: 'Acme',
      name: 'App',
      fullName: 'Acme/App',
      url: 'https://github.com/Acme/App',
    });
    await expect(addRepo(t.ctx, 'ENG', { repo: 'acme/app' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect((await getProject(t.ctx, 'ENG')).repos.map((r) => r.fullName)).toEqual(['Acme/App']);
    await removeRepo(t.ctx, 'ENG', 'acme/app');
    expect((await getProject(t.ctx, 'ENG')).repos).toEqual([]);
    await expect(removeRepo(t.ctx, 'ENG', 'acme/app')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('clears a removed repo from issues that used it (temporary direct check until Task 11)', async () => {
    const repo = await addRepo(t.ctx, 'ENG', { repo: 'acme/clear-me' });
    const issue = await createIssue(t.ctx, 'ENG', { title: 'linked' });
    const db = t.ctx.db.kysely;
    await db.updateTable('issues').set({ repo_id: repo.id }).where('id', '=', issue.id).execute();
    await removeRepo(t.ctx, 'ENG', repo.id);
    const row = await db
      .selectFrom('issues')
      .select(['repo_id', 'version'])
      .where('id', '=', issue.id)
      .executeTakeFirstOrThrow();
    expect(row.repo_id).toBeNull();
    expect(Number(row.version)).toBe(issue.version + 1);
  });

  // Needs the issue `repo` field (Task 11): restore the issue assertions then.
  it.todo('removing a repo clears it from issues that used it');
});
