import type { Locator, Page } from '@playwright/test';
import { apiCreateIssue, choose, expect, test } from './fixtures.ts';

function column(page: Page, name: string) {
  return page.locator(`[data-testid="board-column"][data-column="${name}"]`);
}
function card(page: Page, key: string) {
  return page.locator(`[data-testid="issue-card"][data-key="${key}"]`);
}

/** Pointer drag in small steps (svelte-dnd-action needs real pointer movement). */
async function drag(
  page: Page,
  source: Locator,
  target: Locator,
  where: 'top' | 'center' | 'bottom' = 'center',
) {
  await target.scrollIntoViewIfNeeded();
  await source.scrollIntoViewIfNeeded();
  const from = (await source.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + 12);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 5, from.y + 20, { steps: 5 });
  const y =
    where === 'top' ? to.y + 6 : where === 'bottom' ? to.y + to.height - 6 : to.y + to.height / 2;
  await page.mouse.move(to.x + to.width / 2, y, { steps: 20 });
  await page.waitForTimeout(150);
  await page.mouse.up();
}

async function statusOf(page: Page, key: string) {
  const res = await page.request.get(`/api/v1/issues/${key}`);
  return (await res.json()) as { status: { name: string }; priority: number };
}

test('drags a card to another column and it persists', async ({ page }) => {
  const key = await apiCreateIssue(page.request, { title: 'Drag me across', status: 'Backlog' });
  await page.goto('/p/ENG/board');
  await expect(card(page, key)).toBeVisible();
  const target = column(page, 'In Review');
  await drag(page, card(page, key), target.locator('[data-testid="issue-card"]').first(), 'top');
  await expect(target.locator(`[data-key="${key}"]`)).toBeVisible();
  await expect.poll(async () => (await statusOf(page, key)).status.name).toBe('In Review');
  await page.reload();
  await expect(column(page, 'In Review').locator(`[data-key="${key}"]`)).toBeVisible();
});

test('reorders cards within a column and the order holds', async ({ page }) => {
  // Three fresh issues in "Backlog" (new issues go on top: C, B, A).
  const a = await apiCreateIssue(page.request, { title: 'Order A', status: 'Backlog' });
  await apiCreateIssue(page.request, { title: 'Order B', status: 'Backlog' });
  const c = await apiCreateIssue(page.request, { title: 'Order C', status: 'Backlog' });
  await page.goto('/p/ENG/board');
  const col = column(page, 'Backlog');
  const order = () =>
    col
      .locator('[data-testid="issue-card"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-key')));
  await expect(card(page, a)).toBeVisible();
  await expect(card(page, c)).toBeVisible();
  const before = await order();
  expect(before.indexOf(c)).toBeLessThan(before.indexOf(a));
  // Move C below A.
  const moved = page.waitForResponse((r) => r.url().endsWith(`/issues/${c}/move`) && r.ok());
  await drag(page, card(page, c), card(page, a), 'bottom');
  await moved;
  await expect
    .poll(async () => {
      const now = await order();
      return now.indexOf(c) > now.indexOf(a);
    })
    .toBe(true);
  await page.reload();
  await expect(card(page, a)).toBeVisible();
  const after = await order();
  expect(after.indexOf(c)).toBeGreaterThan(after.indexOf(a));
});

test('groups the board by priority and drag changes priority', async ({ page }) => {
  const key = await apiCreateIssue(page.request, { title: 'Reprioritize me', priority: 4 });
  await page.goto('/p/ENG/board');
  await page.getByTestId('display-options').click();
  await choose(page, 'Group by', 'Priority');
  await page.keyboard.press('Escape');
  await expect(column(page, 'Urgent')).toBeVisible();
  await drag(
    page,
    card(page, key),
    column(page, 'Urgent').locator('[data-testid="issue-card"]').first(),
    'top',
  );
  await expect.poll(async () => (await statusOf(page, key)).priority).toBe(1);
});

test('customizes card fields, saves them as a view, and reproduces it by URL', async ({ page }) => {
  const key = await apiCreateIssue(page.request, {
    title: 'Estimated work',
    estimate: 8,
    dueDate: '2030-01-15',
  });
  await page.goto('/p/ENG/board');
  await expect(card(page, key)).toBeVisible();
  await expect(card(page, key).locator('[data-field="estimate"]')).toHaveCount(0);

  await page.getByTestId('display-options').click();
  const fields = page.getByTestId('display-fields');
  await fields.locator('input[data-field="estimate"]').check();
  await fields.locator('input[data-field="dueDate"]').check();
  await fields.locator('input[data-field="labels"]').uncheck();
  await page.keyboard.press('Escape');

  await expect(card(page, key).locator('[data-field="estimate"]')).toHaveText('8');
  await expect(card(page, key).locator('[data-field="dueDate"]')).toContainText('Jan');
  await expect(page.getByTestId('view-modified')).toBeVisible();

  // The unsaved config is shareable by URL.
  const shared = page.url();
  const other = await page.context().newPage();
  await other.goto(shared);
  await expect(
    other.locator(`[data-testid="issue-card"][data-key="${key}"] [data-field="estimate"]`),
  ).toHaveText('8');
  await other.close();

  // Save as a new personal view.
  await page.getByTestId('view-menu').click();
  await page.getByTestId('view-save-as').click();
  await page.getByTestId('view-name').fill('Estimates board');
  await page.getByTestId('view-create').click();
  await expect(page).toHaveURL(/\/p\/ENG\/v\/viw_/);
  await expect(page.getByTestId('view-menu')).toContainText('Estimates board');
  await expect(page.getByTestId('view-modified')).toHaveCount(0);
  await page.reload();
  await expect(card(page, key).locator('[data-field="estimate"]')).toHaveText('8');
  await expect(card(page, key).locator('[data-field="labels"]')).toHaveCount(0);

  // The default board is unchanged.
  await page.goto('/p/ENG/board');
  await expect(card(page, key).locator('[data-field="estimate"]')).toHaveCount(0);
});

test('a viewer can’t drag cards and has no settings link', async ({ page, browser }) => {
  const origin = `http://127.0.0.1:${process.env.E2E_PORT ?? 3100}`;
  const key = `VB${Date.now().toString(36).toUpperCase().slice(-6)}`;
  const seed = async (path: string, data: Record<string, unknown>) => {
    const res = await page.request.post(`/api/v1${path}`, { data, headers: { origin } });
    expect(res.ok(), await res.text()).toBe(true);
    return (await res.json()) as { key: string };
  };
  await seed('/projects', { key, name: 'Viewer board' });
  const issue = await seed(`/projects/${key}/issues`, { title: 'Stays put', status: 'Backlog' });
  await seed(`/projects/${key}/members`, { user: 'grace', role: 'viewer' });

  const ctx = await browser.newContext();
  const login = await ctx.request.post(`${origin}/api/v1/auth/dev-login`, {
    data: { user: 'grace' },
  });
  expect(login.ok()).toBe(true);
  const p = await ctx.newPage();
  const writes: string[] = [];
  p.on('request', (r) => {
    if (r.method() !== 'GET') writes.push(`${r.method()} ${r.url()}`);
  });
  await p.goto(`${origin}/p/${key}/board`);
  await expect(card(p, issue.key)).toBeVisible();
  await expect(p.getByRole('link', { name: 'Settings' })).toHaveCount(0);
  await expect(p.getByRole('button', { name: /^New issue in/ })).toHaveCount(0);

  await drag(p, card(p, issue.key), column(p, 'In Review'));
  await p.waitForTimeout(300);
  await expect(column(p, 'Backlog').locator(`[data-key="${issue.key}"]`)).toBeVisible();
  await expect(column(p, 'In Review').locator(`[data-key="${issue.key}"]`)).toHaveCount(0);
  expect(writes).toEqual([]);
  expect((await statusOf(page, issue.key)).status.name).toBe('Backlog');
  await ctx.close();
});
