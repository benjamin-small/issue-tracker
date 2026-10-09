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
