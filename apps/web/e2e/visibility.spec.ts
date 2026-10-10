import type { APIRequestContext } from '@playwright/test';
import { choose, expect, test } from './fixtures.ts';

const origin = `http://127.0.0.1:${process.env.E2E_PORT ?? 3100}`;
/** Project keys unique per run, so retries and repeats don't collide with projects made earlier. */
const unique = (prefix: string) => `${prefix}${Date.now().toString(36).toUpperCase().slice(-6)}`;

async function post(request: APIRequestContext, path: string, data: Record<string, unknown>) {
  const res = await request.post(`/api/v1${path}`, { data, headers: { origin } });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as { key: string };
}

test('anonymous visitors can read a public project but not a private one', async ({
  page,
  browser,
}) => {
  // `page` is signed in as an admin; its request context seeds the data.
  const open = unique('OP');
  const shut = unique('SH');
  await post(page.request, '/projects', { key: open, name: 'Open', visibility: 'public' });
  const { key } = await post(page.request, `/projects/${open}/issues`, {
    title: 'Readable by anyone',
  });
  await post(page.request, '/projects', { key: shut, name: 'Shut' });

  const anon = await browser.newContext(); // no session cookie
  const p = await anon.newPage();
  const errors: string[] = [];
  p.on('pageerror', (error) => errors.push(error.message));

  await p.goto(`/p/${open}`);
  await expect(p.getByText('Readable by anyone')).toBeVisible();
  await expect(p).not.toHaveURL(/\/login/);
  await expect(p.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expect(p.getByRole('button', { name: /new issue/i })).toHaveCount(0);
  await expect(p.getByRole('link', { name: 'Settings' })).toHaveCount(0);
  await expect(p.getByTestId('live-indicator')).toHaveAttribute('data-connected', 'true');

  // Write shortcuts do nothing: no create dialog, no command sub-menu.
  await p.keyboard.press('c');
  await expect(p.getByTestId('create-issue-dialog')).toHaveCount(0);

  // The issue reads, but its editing controls are gone.
  await p.goto(`/i/${key}`);
  const detail = p.getByTestId('issue-detail');
  await expect(detail).toBeVisible();
  await expect(p.getByTestId('issue-title')).toHaveAttribute('readonly', '');
  await expect(p.getByRole('button', { name: 'Change status' })).toHaveCount(0);
  await expect(p.getByTestId('delete-issue')).toHaveCount(0);
  await expect(p.getByTestId('comment-input')).toHaveCount(0);
  await expect(p.getByTestId('add-attachment')).toHaveCount(0);
  await expect(p.getByTestId('add-link')).toHaveCount(0);
  await expect(p.getByTestId('add-sub-issue')).toHaveCount(0);

  // A private project looks like one that does not exist, with a way to sign in.
  await p.goto(`/p/${shut}`);
  await expect(p.getByText(/not found/i)).toBeVisible();

  // Signing in from the header comes back to the same page.
  await p.goto(`/p/${open}`);
  await p.getByRole('button', { name: 'Sign in' }).click();
  await expect(p).toHaveURL(new RegExp(`/login\\?next=%2Fp%2F${open}$`));
  expect(errors, 'uncaught errors in the page').toEqual([]);
  await anon.close();
});

test('read-only members see issues without editing controls', async ({ page, browser }) => {
  const viewed = unique('VW');
  await post(page.request, '/projects', { key: viewed, name: 'Viewed' });
  const { key } = await post(page.request, `/projects/${viewed}/issues`, {
    title: 'Look, no hands',
  });
  await post(page.request, `/projects/${viewed}/members`, { user: 'grace', role: 'viewer' });

  const ctx = await browser.newContext();
  const login = await ctx.request.post(`${origin}/api/v1/auth/dev-login`, {
    data: { user: 'grace' },
  });
  expect(login.ok()).toBe(true);
  const p = await ctx.newPage();
  await p.goto(`${origin}/p/${viewed}`);
  await expect(p.getByText('Look, no hands')).toBeVisible();
  await expect(p.getByRole('button', { name: 'Sign in' })).toHaveCount(0);
  await expect(p.getByRole('button', { name: /new issue/i })).toHaveCount(0);
  await expect(p.getByRole('button', { name: 'Change status' })).toHaveCount(0);

  await p.goto(`${origin}/i/${key}`);
  await expect(p.getByTestId('issue-detail')).toBeVisible();
  await expect(p.getByTestId('comment-input')).toHaveCount(0);
  await expect(p.getByTestId('delete-issue')).toHaveCount(0);
  await ctx.close();
});

test('a link can be removed by someone who can write either end', async ({ page, browser }) => {
  const read = unique('LR');
  const write = unique('LW');
  const other = unique('LO');
  for (const [key, role] of [
    [read, 'viewer'],
    [write, 'editor'],
    [other, 'viewer'],
  ] as const) {
    await post(page.request, '/projects', { key, name: key });
    await post(page.request, `/projects/${key}/members`, { user: 'grace', role });
  }
  const here = await post(page.request, `/projects/${read}/issues`, { title: 'Read-only end' });
  const mine = await post(page.request, `/projects/${write}/issues`, { title: 'Writable end' });
  const theirs = await post(page.request, `/projects/${other}/issues`, { title: 'Read-only too' });
  await post(page.request, `/issues/${here.key}/links`, { type: 'blocks', target: mine.key });
  await post(page.request, `/issues/${here.key}/links`, { type: 'relates', target: theirs.key });

  const ctx = await browser.newContext();
  const login = await ctx.request.post(`${origin}/api/v1/auth/dev-login`, {
    data: { user: 'grace' },
  });
  expect(login.ok()).toBe(true);
  const p = await ctx.newPage();
  await p.goto(`${origin}/i/${here.key}`);
  const links = p.getByTestId('links');
  const item = (key: string) => links.locator('li').filter({ hasText: key });
  await expect(item(mine.key)).toBeVisible();
  await expect(item(theirs.key)).toBeVisible();
  // Grace can't write this issue's project, but she can write the other end's: she may remove that link.
  await expect(item(theirs.key).getByRole('button', { name: 'Remove link' })).toHaveCount(0);
  await expect(links.getByTestId('add-link')).toHaveCount(0);
  await item(mine.key).hover();
  await item(mine.key).getByRole('button', { name: 'Remove link' }).click();
  await expect(item(mine.key)).toHaveCount(0);
  await expect(item(theirs.key)).toBeVisible();
  await ctx.close();
});

test('signed out, grouping by a person field keeps every issue on the board', async ({
  page,
  browser,
}) => {
  const key = unique('PF');
  await post(page.request, '/projects', { key, name: 'People', visibility: 'public' });
  await post(page.request, `/projects/${key}/fields`, {
    key: 'owner',
    name: 'Owner',
    type: 'user',
  });
  const owned = await post(page.request, `/projects/${key}/issues`, {
    title: 'Owned by Grace',
    customFields: { owner: 'grace' },
  });
  const unowned = await post(page.request, `/projects/${key}/issues`, { title: 'Owned by nobody' });

  const anon = await browser.newContext();
  const p = await anon.newPage();
  await p.goto(`/p/${key}/board`);
  await p.getByTestId('display-options').click();
  await choose(p, 'Group by', 'Owner');
  await p.keyboard.press('Escape');
  // Signed out, the user directory is unavailable, so Grace is an unnamed column; nothing drops out.
  const column = (name: RegExp | string) =>
    p.locator('[data-testid="board-column"]').filter({ has: p.getByText(name) });
  await expect(column(/Unknown user/).locator(`[data-key="${owned.key}"]`)).toBeVisible();
  await expect(column('No Owner').locator(`[data-key="${unowned.key}"]`)).toBeVisible();
  await anon.close();
});

test('signed out, people come from the issues, and the sign-in page leads back', async ({
  page,
  browser,
}) => {
  const key = unique('PO');
  await post(page.request, '/projects', { key, name: 'People out', visibility: 'public' });
  await post(page.request, `/projects/${key}/fields`, {
    key: 'owner',
    name: 'Owner',
    type: 'user',
  });
  const graces = await post(page.request, `/projects/${key}/issues`, {
    title: 'Grace owns it',
    assignee: 'grace',
    customFields: { owner: 'grace' },
  });
  const mias = await post(page.request, `/projects/${key}/issues`, {
    title: 'Mia owns it',
    customFields: { owner: 'member' },
  });

  const anon = await browser.newContext();
  const p = await anon.newPage();
  const errors: string[] = [];
  p.on('pageerror', (error) => errors.push(error.message));
  await p.goto(`${origin}/p/${key}`);
  await expect(p.getByTestId('issue-row')).toHaveCount(2);

  // The user directory needs sign-in; the assignee filter offers the people the issues name.
  await p.getByTestId('filter-assignee').click();
  await p.getByRole('option', { name: 'Grace Hopper' }).click();
  await p.keyboard.press('Escape');
  await expect(p.getByTestId('issue-row')).toHaveCount(1);
  await expect(p.getByTestId('issue-row')).toContainText('Grace owns it');
  await expect(p.getByTestId('filter-assignee-active')).toContainText('Grace Hopper');

  // A person field names whoever the issue embeds, else says the user is unknown (with the id).
  await p.goto(`${origin}/i/${graces.key}`);
  await expect(p.locator('[data-cf="owner"]')).toContainText('Grace Hopper');
  await p.goto(`${origin}/i/${mias.key}`);
  await expect(p.locator('[data-cf="owner"]')).toContainText('Unknown user');
  await expect(p.locator('[data-cf="owner"]')).toHaveAttribute('title', /Owner: usr_/);

  // The sign-in page has a way back for visitors who only want to read.
  await p.goto(`${origin}/p/${key}`);
  await p.getByRole('button', { name: 'Sign in' }).click();
  await expect(p).toHaveURL(/\/login\?next=/);
  await p.getByRole('link', { name: 'Continue without signing in' }).click();
  await expect(p).toHaveURL(new RegExp(`/p/${key}$`));
  await expect(p.getByTestId('issue-row')).toHaveCount(2);
  expect(errors, 'uncaught errors in the page').toEqual([]);
  await anon.close();
});

test('the sign-in page only leads back to this origin', async ({ browser }) => {
  const anon = await browser.newContext();
  const p = await anon.newPage();
  const back = p.getByRole('link', { name: 'Continue without signing in' });
  for (const next of ['/\\evil.com', '/\t/evil.com', '//evil.com', 'https://evil.com']) {
    await p.goto(`${origin}/login?next=${encodeURIComponent(next)}`);
    const target = new URL((await back.getAttribute('href'))!, p.url());
    expect(target.origin, next).toBe(origin);
    expect(target.pathname, next).toBe('/');
  }
  await p.goto(`${origin}/login?next=${encodeURIComponent('/p/ENG?x=1')}`);
  await expect(back).toHaveAttribute('href', '/p/ENG?x=1');
  await back.click();
  await expect(p).toHaveURL(`${origin}/p/ENG?x=1`);
  await anon.close();
});

test('a role change reaches the member live: controls and the member list update', async ({
  page,
  browser,
}) => {
  const key = unique('LV');
  await post(page.request, '/projects', { key, name: 'Live roles' });
  await post(page.request, `/projects/${key}/issues`, { title: 'Watched live' });
  await post(page.request, `/projects/${key}/members`, { user: 'grace', role: 'viewer' });

  const ctx = await browser.newContext();
  const login = await ctx.request.post(`${origin}/api/v1/auth/dev-login`, {
    data: { user: 'grace' },
  });
  expect(login.ok()).toBe(true);
  const p = await ctx.newPage();
  await p.goto(`${origin}/p/${key}`);
  await expect(p.getByText('Watched live')).toBeVisible();
  await expect(p.getByTestId('live-indicator')).toHaveAttribute('data-connected', 'true');
  await expect(p.getByRole('link', { name: 'Settings' })).toHaveCount(0);
  await expect(p.getByRole('button', { name: /new issue/i })).toHaveCount(0);

  // A manager promotes Grace: her page gains the editing controls without a reload.
  const promoted = await page.request.patch(`/api/v1/projects/${key}/members/grace`, {
    data: { role: 'editor' },
    headers: { origin },
  });
  expect(promoted.ok(), await promoted.text()).toBe(true);
  await expect(p.getByRole('link', { name: 'Settings' })).toBeVisible();
  await expect(p.getByRole('button', { name: /new issue/i }).first()).toBeVisible();

  // On the settings page, a member added elsewhere shows up live.
  await p.getByRole('link', { name: 'Settings' }).click();
  await expect(p.getByTestId('settings-editor-note')).toBeVisible();
  await expect(p.getByTestId('live-indicator')).toHaveAttribute('data-connected', 'true');
  await post(page.request, `/projects/${key}/members`, { user: 'member', role: 'viewer' });
  await expect(p.getByTestId('settings-access').getByText('@member')).toBeVisible();
  await ctx.close();
});

test('a manager makes a project public, adds a repo and a member', async ({ page }) => {
  const key = unique('CF');
  await post(page.request, '/projects', { key, name: 'Config' });
  await page.goto(`/p/${key}/settings`);
  await page
    .getByTestId('settings-access')
    .getByRole('radio', { name: /Public/ })
    .check();
  await expect(page.getByText('Saved')).toBeVisible();
  await page
    .getByTestId('settings-repos')
    .getByPlaceholder('owner/name or GitHub URL')
    .fill('acme/app');
  await page.getByTestId('settings-repos').getByRole('button', { name: 'Link repository' }).click();
  await expect(
    page.getByTestId('settings-repos').getByRole('link', { name: 'acme/app' }),
  ).toHaveAttribute('href', 'https://github.com/acme/app');
  await page.getByTestId('settings-access').getByPlaceholder('@handle').fill('@member');
  await page.getByTestId('settings-access').getByRole('button', { name: 'Add member' }).click();
  await expect(page.getByTestId('settings-access').getByText('@member')).toBeVisible();
});

test('a manager changes a role, then removes a member', async ({ page }) => {
  const key = unique('RL');
  await post(page.request, '/projects', { key, name: 'Roles' });
  await post(page.request, `/projects/${key}/members`, { user: 'member', role: 'viewer' });
  await page.goto(`/p/${key}/settings`);
  const access = page.getByTestId('settings-access');
  const row = access.locator('[data-member="member"]');
  await expect(row).toBeVisible();
  await choose(row, 'Role of @member', 'Editor');
  await expect(page.getByText('@member is now editor')).toBeVisible();
  await expect(row.getByLabel('Role of @member')).toContainText('Editor');
  await row.getByRole('button', { name: 'Remove @member' }).click();
  await page.getByTestId('confirm-ok').click();
  await expect(row).toHaveCount(0);
});

test('a manager who demotes themselves drops to read-only settings after confirming', async ({
  page,
  browser,
}) => {
  const key = unique('SD');
  await post(page.request, '/projects', { key, name: 'Self' });
  await post(page.request, `/projects/${key}/members`, { user: 'grace', role: 'manager' });
  const ctx = await browser.newContext();
  const login = await ctx.request.post(`${origin}/api/v1/auth/dev-login`, {
    data: { user: 'grace' },
  });
  expect(login.ok()).toBe(true);
  const p = await ctx.newPage();
  await p.goto(`${origin}/p/${key}/settings`);
  const row = p.getByTestId('settings-access').locator('[data-member="grace"]');
  await choose(row, 'Role of @grace', 'Viewer');
  await p.getByTestId('confirm-ok').click();
  await expect(p.getByTestId('settings-readonly')).toBeVisible();
  await expect(p.getByTestId('settings-repos')).toHaveCount(0);
  await ctx.close();
});

test('viewers see the members read-only and signed-out visitors cannot open settings', async ({
  page,
  browser,
}) => {
  const key = unique('RO');
  await post(page.request, '/projects', { key, name: 'Readonly', visibility: 'public' });
  await post(page.request, `/projects/${key}/members`, { user: 'grace', role: 'viewer' });

  const ctx = await browser.newContext();
  const login = await ctx.request.post(`${origin}/api/v1/auth/dev-login`, {
    data: { user: 'grace' },
  });
  expect(login.ok()).toBe(true);
  const p = await ctx.newPage();
  await p.goto(`${origin}/p/${key}/settings`);
  await expect(
    p.getByText('Only project editors and managers can change these settings.'),
  ).toBeVisible();
  await expect(p.getByTestId('settings-access').getByText('@grace')).toBeVisible();
  await expect(p.getByRole('button', { name: 'Add member' })).toHaveCount(0);
  await expect(p.getByRole('radio')).toHaveCount(0);
  await expect(p.getByTestId('settings-statuses')).toHaveCount(0);
  await ctx.close();

  const anon = await browser.newContext();
  const a = await anon.newPage();
  await a.goto(`${origin}/p/${key}/settings`);
  await expect(a.getByTestId('settings-forbidden')).toBeVisible();
  await expect(a.getByTestId('settings-access')).toHaveCount(0);
  // The title says what the body does: signing in is the way in.
  await expect(
    a.getByRole('heading', { name: 'Sign in to see this project’s settings' }),
  ).toBeVisible();
  await a.getByTestId('settings-forbidden').getByRole('button', { name: 'Sign in' }).click();
  await expect(a).toHaveURL(new RegExp(`/login\\?next=%2Fp%2F${key}%2Fsettings$`));
  await anon.close();
});

test('changing your own role asks first only when it drops you below manager', async ({ page }) => {
  // Ada is an admin: she manages any project, whatever her own membership says.
  const key = unique('SR');
  await post(page.request, '/projects', { key, name: 'Self role' });
  await post(page.request, `/projects/${key}/members`, { user: 'ada', role: 'viewer' });
  await page.goto(`/p/${key}/settings`);
  const row = page.getByTestId('settings-access').locator('[data-member="ada"]');
  await choose(row, 'Role of @ada', 'Editor');
  await expect(page.getByText('@ada is now editor')).toBeVisible();
  await expect(page.getByTestId('confirm-ok')).toHaveCount(0);
  await choose(row, 'Role of @ada', 'Manager');
  await expect(page.getByText('@ada is now manager')).toBeVisible();
  // Manager to editor is a demotion below manager: that one asks.
  await choose(row, 'Role of @ada', 'Viewer');
  await expect(page.getByTestId('confirm-ok')).toBeVisible();
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByText('@ada is now viewer')).toBeVisible();
});

test('the visibility radios wait for the save', async ({ page }) => {
  const key = unique('VS');
  await post(page.request, '/projects', { key, name: 'Visibility save' });
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(new RegExp(`/api/v1/projects/${key}$`), async (route) => {
    if (route.request().method() === 'PATCH') await held;
    await route.fallback();
  });
  await page.goto(`/p/${key}/settings`);
  await expect(page.getByRole('radio', { name: /Private/ })).toBeEnabled();
  await page.getByRole('radio', { name: /Public/ }).check();
  await expect(page.getByRole('radio', { name: /Private/ })).toBeDisabled();
  await expect(page.getByRole('radio', { name: /Public/ })).toBeDisabled();
  release();
  await expect(page.getByText('Saved')).toBeVisible();
  await expect(page.getByRole('radio', { name: /Private/ })).toBeEnabled();
  await expect(page.getByRole('radio', { name: /Public/ })).toBeChecked();
});

test('unlinking a repo clears it from an issue page already loaded', async ({ page }) => {
  const key = unique('UL');
  await post(page.request, '/projects', { key, name: 'Unlink' });
  await post(page.request, `/projects/${key}/repos`, { repo: 'acme/app' });
  const issue = await post(page.request, `/projects/${key}/issues`, {
    title: 'Linked to app',
    repo: 'acme/app',
  });
  // No live events: the settings page itself must refresh what it changed.
  await page.route(/\/api\/v1\/events\/stream/, (route) => route.abort());
  await page.goto(`/i/${issue.key}`);
  await expect(
    page.getByTestId('issue-detail').getByRole('link', { name: 'acme/app' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Settings' }).click();
  const repos = page.getByTestId('settings-repos');
  await repos.getByRole('button', { name: 'Unlink acme/app' }).click();
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByText('Unlinked acme/app')).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId('issue-title')).toHaveValue('Linked to app');
  await expect(
    page.getByTestId('issue-detail').getByRole('link', { name: 'acme/app' }),
  ).toHaveCount(0);
});

test('editors change the workflow, labels and fields, and see access read-only', async ({
  page,
  browser,
}) => {
  const key = unique('ED');
  await post(page.request, '/projects', { key, name: 'Edited' });
  await post(page.request, `/projects/${key}/members`, { user: 'grace', role: 'editor' });

  const ctx = await browser.newContext();
  const login = await ctx.request.post(`${origin}/api/v1/auth/dev-login`, {
    data: { user: 'grace' },
  });
  expect(login.ok()).toBe(true);
  const p = await ctx.newPage();
  const errors: string[] = [];
  p.on('pageerror', (error) => errors.push(error.message));
  await p.goto(`${origin}/p/${key}`);
  await p.getByRole('link', { name: 'Settings' }).click();
  await expect(p).toHaveURL(new RegExp(`/p/${key}/settings$`));

  // Manager-only sections are absent or read-only.
  await expect(p.getByTestId('settings-editor-note')).toBeVisible();
  await expect(p.getByTestId('settings-access').getByText('@grace')).toBeVisible();
  await expect(p.getByRole('button', { name: 'Add member' })).toHaveCount(0);
  await expect(p.getByRole('radio')).toHaveCount(0);
  await expect(p.getByTestId('settings-repos')).toHaveCount(0);
  await expect(p.getByTestId('settings-general')).toHaveCount(0);

  // Workflow, labels and custom fields are editable.
  const statuses = p.getByTestId('settings-statuses');
  await statuses.getByLabel('New status name').fill('Editor review');
  await statuses.getByRole('button', { name: 'Add status' }).click();
  await expect(statuses.getByLabel('Status name', { exact: true }).last()).toHaveValue(
    'Editor review',
  );
  await p.getByPlaceholder('New label').fill('editor-label');
  await p.getByRole('button', { name: 'Add label' }).click();
  await expect(
    p.getByTestId('settings-labels').locator('li[data-label="editor-label"]'),
  ).toBeVisible();
  await expect(p.getByTestId('settings-fields')).toBeVisible();
  await expect(p.getByTestId('new-field')).toBeVisible();
  expect(errors, 'uncaught errors in the page').toEqual([]);
  await ctx.close();
});

test('an issue can be linked to one of the project repos and filtered by it', async ({ page }) => {
  const key = unique('RP');
  await post(page.request, '/projects', { key, name: 'Repos' });
  await post(page.request, `/projects/${key}/repos`, { repo: 'acme/app' });
  await post(page.request, `/projects/${key}/repos`, { repo: 'acme/docs' });
  await post(page.request, `/projects/${key}/issues`, { title: 'Needs a repo' });
  await post(page.request, `/projects/${key}/issues`, { title: 'Other issue' });

  await page.goto(`/i/${key}-1`);
  await page.getByRole('button', { name: 'Repository' }).click();
  await page.getByRole('option', { name: 'acme/app' }).click();
  await expect(page.getByRole('link', { name: 'acme/app' })).toHaveAttribute(
    'href',
    'https://github.com/acme/app',
  );
  await expect(page.getByRole('link', { name: 'acme/app' })).toHaveAttribute('target', '_blank');

  // Filter the list by repository, then clear the link again.
  await page.goto(`/p/${key}`);
  await expect(page.getByTestId('issue-row')).toHaveCount(2);
  await page.getByTestId('filter-repo').click();
  await page.getByRole('option', { name: 'acme/app' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('issue-row')).toHaveCount(1);
  await expect(page.getByTestId('issue-row')).toContainText('Needs a repo');

  await page.goto(`/i/${key}-1`);
  await page.getByRole('button', { name: 'Repository' }).click();
  await page.getByRole('option', { name: 'No repository' }).click();
  await expect(page.getByRole('link', { name: 'acme/app' })).toHaveCount(0);
  // The cleared link is saved, not just gone from the page.
  await expect
    .poll(
      async () =>
        ((await (await page.request.get(`/api/v1/issues/${key}-1`)).json()) as { repo: unknown })
          .repo,
    )
    .toBeNull();
  await page.reload();
  await expect(page.getByTestId('issue-title')).toHaveValue('Needs a repo');
  await expect(page.getByRole('button', { name: 'Repository' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'acme/app' })).toHaveCount(0);
});

test('the list groups by repository, and an unlinked repo’s issues move to "No repository"', async ({
  page,
}) => {
  const key = unique('GR');
  await post(page.request, '/projects', { key, name: 'Group repos' });
  await post(page.request, `/projects/${key}/repos`, { repo: 'acme/app' });
  await post(page.request, `/projects/${key}/repos`, { repo: 'acme/docs' });
  const app = await post(page.request, `/projects/${key}/issues`, {
    title: 'In app',
    repo: 'acme/app',
  });
  const docs = await post(page.request, `/projects/${key}/issues`, {
    title: 'In docs',
    repo: 'acme/docs',
  });
  const none = await post(page.request, `/projects/${key}/issues`, { title: 'In no repo' });

  await page.goto(`/p/${key}`);
  await expect(page.getByTestId('issue-row')).toHaveCount(3);
  await page.getByTestId('display-options').click();
  await choose(page, 'Group by', 'Repository');
  await page.keyboard.press('Escape');
  /** Issue keys under each group header, in page order. */
  const groups = () =>
    page.locator('[data-testid="list-group"], [data-testid="issue-row"]').evaluateAll((els) => {
      const out: Record<string, string[]> = {};
      let current = '';
      for (const el of els as HTMLElement[]) {
        if (el.dataset.testid === 'list-group') out[(current = el.dataset.group ?? '')] = [];
        else out[current]?.push(el.dataset.key ?? '');
      }
      return out;
    });
  await expect
    .poll(groups)
    .toEqual({ 'No repository': [none.key], 'acme/app': [app.key], 'acme/docs': [docs.key] });
  await expect(page.getByTestId('live-indicator')).toHaveAttribute('data-connected', 'true');

  // Unlinked elsewhere: its issue loses the repo (live), and the group goes with it.
  const unlinked = await page.request.delete(
    `/api/v1/projects/${key}/repos/${encodeURIComponent('acme/docs')}`,
    { headers: { origin } },
  );
  expect(unlinked.ok(), await unlinked.text()).toBe(true);
  const after = { 'No repository': [docs.key, none.key].sort(), 'acme/app': [app.key] };
  const sorted = async () =>
    Object.fromEntries(Object.entries(await groups()).map(([g, k]) => [g, k.sort()]));
  await expect.poll(sorted).toEqual(after);
  await page.reload();
  await expect(page.getByTestId('issue-row')).toHaveCount(3);
  await expect.poll(sorted).toEqual(after);
});

test('the repo filter offers "No repository", and nulls from saved views read as it', async ({
  page,
}) => {
  const key = unique('RN');
  await post(page.request, '/projects', { key, name: 'Repo nulls' });
  await post(page.request, `/projects/${key}/repos`, { repo: 'acme/app' });
  await post(page.request, `/projects/${key}/issues`, { title: 'Has a repo', repo: 'acme/app' });
  await post(page.request, `/projects/${key}/issues`, { title: 'Has no repo' });

  await page.goto(`/p/${key}`);
  await expect(page.getByTestId('issue-row')).toHaveCount(2);
  await page.getByTestId('filter-repo').click();
  await page.getByRole('option', { name: 'No repository' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('issue-row')).toHaveCount(1);
  await expect(page.getByTestId('issue-row')).toContainText('Has no repo');
  await expect(page.getByTestId('filter-repo-active')).toContainText('No repository');

  // A saved view (or the CLI) stores "no repository" as null in an `in` list: it reads as the same choice.
  const view = (await post(page.request, `/projects/${key}/views`, {
    name: 'Unlinked or app',
    layout: 'list',
    shared: true,
    config: { filter: { conditions: [{ field: 'repo', op: 'in', value: [null, 'acme/app'] }] } },
  })) as unknown as { id: string };
  await page.goto(`/p/${key}/v/${view.id}`);
  await expect(page.getByTestId('issue-row')).toHaveCount(2);
  await expect(page.getByTestId('filter-repo-active')).toContainText('No repository, acme/app');
  await page.getByTestId('filter-repo').click();
  await expect(page.getByRole('option', { name: 'No repository' })).toBeVisible();
  await expect(page.getByRole('option', { name: 'null' })).toHaveCount(0);
});

test('the create dialog offers the project repos and projects without repos hide the row', async ({
  page,
}) => {
  const key = unique('RC');
  const bare = unique('RB');
  await post(page.request, '/projects', { key, name: 'With repos' });
  await post(page.request, `/projects/${key}/repos`, { repo: 'acme/app' });
  await post(page.request, '/projects', { key: bare, name: 'No repos' });
  await post(page.request, `/projects/${bare}/issues`, { title: 'Plain' });

  await page.goto(`/i/${bare}-1`);
  await expect(page.getByTestId('issue-properties')).toBeVisible();
  await expect(page.getByText('Repository', { exact: true })).toHaveCount(0);

  await page.goto(`/p/${key}`);
  await expect(page.getByTestId('filter-bar')).toBeVisible();
  await page.keyboard.press('c');
  await expect(page.getByTestId('create-issue-dialog')).toBeVisible();
  await page.getByTestId('create-title').fill('Born with a repo');
  await page
    .getByTestId('create-issue-dialog')
    .getByRole('button', { name: 'Repository', exact: true })
    .click();
  await page.getByRole('option', { name: 'acme/app' }).click();
  await page.getByTestId('create-submit').click();
  await page.goto(`/i/${key}-1`);
  await expect(page.getByRole('link', { name: 'acme/app' })).toBeVisible();
});

test("a change to the viewer's own account reaches their open page live", async ({
  page,
  browser,
}) => {
  const key = unique('AC');
  const handle = `acct${Date.now().toString(36)}`;
  await post(page.request, '/projects', { key, name: 'Account', visibility: 'public' });
  await post(page.request, `/projects/${key}/issues`, { title: 'Seen by a member' });
  await post(page.request, '/users', { handle, name: 'Account Holder', kind: 'human' });
  const setRole = async (role: 'admin' | 'member') => {
    const res = await page.request.patch(`/api/v1/users/${handle}`, {
      data: { role },
      headers: { origin },
    });
    expect(res.ok(), await res.text()).toBe(true);
  };

  const ctx = await browser.newContext();
  const login = await ctx.request.post(`${origin}/api/v1/auth/dev-login`, {
    data: { user: handle },
  });
  expect(login.ok()).toBe(true);
  const p = await ctx.newPage();
  const errors: string[] = [];
  p.on('pageerror', (error) => errors.push(error.message));
  let streams = 0;
  p.on('request', (r) => {
    if (r.url().includes('/events/stream')) streams++;
  });
  await p.goto(`${origin}/p/${key}`);
  await expect(p.getByText('Seen by a member')).toBeVisible();
  await expect(p.getByTestId('live-indicator')).toHaveAttribute('data-connected', 'true');
  await expect(p.getByTestId('new-project')).toHaveCount(0);
  const before = streams;

  // Made an admin: the admin-only controls appear without a reload, and the project stream ends and reconnects as
  // who they are now.
  await setRole('admin');
  await expect(p.getByTestId('new-project')).toBeVisible();
  await expect(p.getByTestId('nav-webhooks')).toBeVisible();
  await expect.poll(() => streams, { timeout: 10_000 }).toBeGreaterThan(before);
  await expect(p.getByTestId('live-indicator')).toHaveAttribute('data-connected', 'true', {
    timeout: 10_000,
  });

  // And back: they go again.
  await setRole('member');
  await expect(p.getByTestId('new-project')).toHaveCount(0);
  await expect(p.getByTestId('nav-webhooks')).toHaveCount(0);
  await expect(p.getByText('Seen by a member')).toBeVisible();
  expect(errors, 'uncaught errors in the page').toEqual([]);
  await ctx.close();
});

test("a demoted writer's open trashed issue refetches live and is gone", async ({
  page,
  browser,
}) => {
  const key = unique('DM');
  await post(page.request, '/projects', { key, name: 'Demoted' });
  await post(page.request, `/projects/${key}/issues`, { title: 'Trashed while open' });
  await post(page.request, `/projects/${key}/members`, { user: 'grace', role: 'editor' });
  const trashed = await page.request.delete(`/api/v1/issues/${key}-1`, { headers: { origin } });
  expect(trashed.ok(), await trashed.text()).toBe(true);

  const ctx = await browser.newContext();
  const login = await ctx.request.post(`${origin}/api/v1/auth/dev-login`, {
    data: { user: 'grace' },
  });
  expect(login.ok()).toBe(true);
  const p = await ctx.newPage();
  await p.goto(`${origin}/i/${key}-1`);
  await expect(p.getByTestId('deleted-banner')).toBeVisible();
  await expect(p.getByTestId('restore-issue')).toBeVisible();
  await expect(p.getByTestId('live-indicator')).toHaveAttribute('data-connected', 'true');

  // Demoted to viewer, Grace can no longer see the trash: the open issue refetches and is not found.
  const demoted = await page.request.patch(`/api/v1/projects/${key}/members/grace`, {
    data: { role: 'viewer' },
    headers: { origin },
  });
  expect(demoted.ok(), await demoted.text()).toBe(true);
  await expect(p.getByTestId('issue-error')).toBeVisible();
  await expect(p.getByTestId('deleted-banner')).toHaveCount(0);
  await ctx.close();
});
