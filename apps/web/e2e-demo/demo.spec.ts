import { expect, type Page, test } from '@playwright/test';

// The whole app (web UI, API, SQLite) runs inside the page; these check it works from a static sub-path.
const rows = (page: Page) => page.getByTestId('issue-row');

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
  await page.goto('index.html');
  // Signed out, visitors browse the public project; sign-in lives in the sidebar (ADR 0021).
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: 'Sign in' })
    .click();
  await page.getByText('Ada Lovelace').click();
  await expect(rows(page).first()).toBeVisible();
  expect(page.url()).toContain('index.html#/p/ENG');
});

test('creates, comments and keeps data across reloads', async ({ page }) => {
  await page.getByTestId('new-issue').click();
  await page.getByTestId('create-title').fill('Made in the demo');
  await page.getByTestId('create-submit').click();
  const row = rows(page).filter({ hasText: 'Made in the demo' });
  await row.click();
  await expect(page).toHaveURL(/index\.html#\/p\/ENG/); // peek keeps the hash route
  await page.getByTestId('comment-input').fill('Hello **from the browser**');
  await page.keyboard.press('Control+Enter');
  await expect(page.getByText('from the browser')).toBeVisible();

  await page.reload();
  await expect(rows(page).filter({ hasText: 'Made in the demo' })).toBeVisible();
  const key = await rows(page).filter({ hasText: 'Made in the demo' }).getAttribute('data-key');
  // A deep link opened fresh, as a shared URL would be (changing only the hash of a loaded page makes
  // SvelteKit's hash router reload by itself, which would race an explicit reload here).
  const shared = await page.context().newPage();
  await shared.goto(`index.html#/i/${key}`);
  await expect(shared.getByText('from the browser')).toBeVisible();
});

test('filters live in the hash and survive a reload', async ({ page }) => {
  await page.getByTestId('search').fill('Kanban');
  await expect(rows(page)).toHaveCount(1);
  await expect(page).toHaveURL(/#\/p\/ENG\?v=/);
  await page.reload();
  await expect(rows(page)).toHaveCount(1);
});

test('moves a card on the board', async ({ page }) => {
  await page.getByTestId('nav-board').click();
  const column = (name: string) =>
    page.locator(`[data-testid="board-column"][data-column="${name}"]`);
  const card = column('Backlog').getByTestId('issue-card').first();
  await expect(card).toBeVisible();
  const before = await column('Todo').getByTestId('issue-card').count();
  const from = (await card.boundingBox())!;
  const to = (await column('Todo').boundingBox())!;
  await page.mouse.move(from.x + 20, from.y + 10);
  await page.mouse.down();
  await page.mouse.move(to.x + 60, to.y + 200, { steps: 15 });
  await page.mouse.up();
  await expect(column('Todo').getByTestId('issue-card')).toHaveCount(before + 1);
});

test('uploads an attachment and shows it', async ({ page }) => {
  await rows(page).first().click();
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
  );
  await page
    .getByTestId('attachment-input')
    .setInputFiles([{ name: 'dot.png', mimeType: 'image/png', buffer: png }]);
  const img = page.locator('[data-testid="attachment"][data-filename="dot.png"] img');
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(1);
});

test('signs out and resets', async ({ page }) => {
  await page.getByTestId('logout').click();
  await expect(page.getByText('Explore as')).toBeVisible();
  await page.getByTestId('demo-badge').getByRole('button', { name: 'Reset data' }).click();
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: 'Sign in' })
    .click();
  await expect(page.getByText('Grace Hopper')).toBeVisible();
});

test('the sign-in page only leads back within the demo', async ({ page }) => {
  // Fresh pages: changing only the hash of a loaded page makes the hash router reload by itself.
  const login = async (next: string) => {
    const p = await page.context().newPage();
    await p.goto(`index.html#/login?next=${encodeURIComponent(next)}`);
    return { p, link: p.getByRole('link', { name: 'Continue without signing in' }) };
  };
  const evil = await login('/\\evil.com');
  await expect(evil.link).toHaveAttribute('href', '#/');
  const ok = await login('/p/ENG');
  await expect(ok.link).toHaveAttribute('href', '#/p/ENG');
  await ok.link.click();
  await expect(ok.p).toHaveURL(/index\.html#\/p\/ENG$/);
});
