import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDialect } from '@poietic-tech/issues-db/testing';
import { parseRepoRef } from '../refs.ts';
import { addRepo, removeRepo } from './repos.ts';
import { createProject, getProject } from './projects.ts';
import {
  createIssue,
  deleteIssue,
  getIssue,
  listIssueActivity,
  listIssues,
  moveIssue,
  updateIssue,
} from './issues.ts';
import { createTestContext, type TestContext } from '../testing.ts';

describe('parseRepoRef', () => {
  it.each([
    ['acme/app', { owner: 'acme', name: 'app' }],
    ['https://github.com/acme/app', { owner: 'acme', name: 'app' }],
    ['https://github.com/acme/app.git', { owner: 'acme', name: 'app' }],
    ['github.com/acme/app/pull/12', { owner: 'acme', name: 'app' }],
    // Scheme and host in any case; owner and name keep theirs.
    ['HTTPS://GitHub.com/Acme/App', { owner: 'Acme', name: 'App' }],
    ['Http://WWW.GITHUB.COM/Acme/App.git', { owner: 'Acme', name: 'App' }],
    ['GITHUB.COM/acme/App', { owner: 'acme', name: 'App' }],
    ['Acme/App', { owner: 'Acme', name: 'App' }],
  ])('parses %s', (input, expected) => expect(parseRepoRef(input)).toEqual(expected));
  it.each([
    'acme',
    'https://gitlab.com/acme/app',
    'HTTPS://GitLab.com/acme/app',
    'acme/app/extra?x',
    '-bad/app',
    'acme/ap p',
  ])('rejects %s', (input) => expect(() => parseRepoRef(input)).toThrow(/repository/i));
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

  it('removing a repo clears it from issues that used it', async () => {
    const repo = await addRepo(t.ctx, 'ENG', { repo: 'acme/clear-me' });
    const issue = await createIssue(t.ctx, 'ENG', { title: 'linked', repo: 'ACME/clear-me' });
    expect(issue.repo).toBe('acme/clear-me');
    await removeRepo(t.ctx, 'ENG', repo.id);
    const after = await getIssue(t.ctx, issue.key);
    expect(after.repo).toBeNull();
    expect(after.version).toBe(issue.version + 1);
    const events = await listIssueActivity(t.ctx, issue.key);
    const last = events.data.find((e) => e.type === 'issue.updated');
    expect(last?.data).toMatchObject({ changes: { repo: { from: 'acme/clear-me', to: null } } });
  });

  it('clears a removed repo from trashed issues too', async () => {
    const repo = await addRepo(t.ctx, 'ENG', { repo: 'acme/trashed' });
    const issue = await createIssue(t.ctx, 'ENG', { title: 'to trash', repo: repo.id });
    await deleteIssue(t.ctx, issue.key);
    await removeRepo(t.ctx, 'ENG', 'acme/trashed');
    const after = await getIssue(t.ctx, issue.key);
    expect(after.deletedAt).not.toBeNull();
    expect(after.repo).toBeNull();
  });

  it('filters by repo, rejects unlinked repos, and keeps the repo on a board move', async () => {
    await addRepo(t.ctx, 'ENG', { repo: 'acme/web' });
    await createIssue(t.ctx, 'ENG', { title: 'web bug', repo: 'acme/web' });
    const found = await listIssues(t.ctx, {
      project: 'ENG',
      filter: { conditions: [{ field: 'repo', op: 'eq', value: 'acme/web' }] },
    });
    expect(found.data.map((i) => i.title)).toEqual(['web bug']);
    await expect(
      createIssue(t.ctx, 'ENG', { title: 'bad', repo: 'other/repo' }),
    ).rejects.toMatchObject({ code: 'INVALID_RELATION' });
    // Issues cannot change projects (moveIssue only reorders/changes status), so the repo stays.
    const moved = await moveIssue(t.ctx, found.data[0]!.key, { position: 'bottom' });
    expect(moved.repo).toBe('acme/web');
    const none = await listIssues(t.ctx, {
      project: 'ENG',
      filter: { conditions: [{ field: 'repo', op: 'isNull', value: true }] },
    });
    expect(none.data.map((i) => i.title)).not.toContain('web bug');
  });

  it('names the project when a repo is not linked to it, on create and update', async () => {
    const message = '"other/repo" is not linked to project ENG';
    await expect(
      createIssue(t.ctx, 'ENG', { title: 'bad', repo: 'other/repo' }),
    ).rejects.toMatchObject({ code: 'INVALID_RELATION', message });
    const issue = await createIssue(t.ctx, 'ENG', { title: 'fine' });
    await expect(updateIssue(t.ctx, issue.key, { repo: 'other/repo' })).rejects.toMatchObject({
      code: 'INVALID_RELATION',
      message,
    });
  });
});
