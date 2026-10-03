import { apiCreateIssue, expect, openList, test } from './fixtures.ts';

test.describe('phone layout', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('opens the navigation drawer and shows issue titles', async ({ page }) => {
    const key = await apiCreateIssue(page.request, { title: 'Visible on a phone' });
    await page.goto('/p/ENG');
    const row = page.locator(`[data-testid="issue-row"][data-key="${key}"]`);
    await expect(row.getByText('Visible on a phone')).toBeVisible();

    await expect(page.getByTestId('nav-board')).not.toBeInViewport();
    await page.getByTestId('open-menu').click();
    await expect(page.getByTestId('nav-board')).toBeInViewport();
    await page.getByTestId('nav-board').click();
    await expect(page).toHaveURL(/\/p\/ENG\/board$/);
    await expect(page.getByTestId('nav-board')).not.toBeInViewport(); // drawer closes on navigation
  });

  test('stacks issue properties under the title', async ({ page }) => {
    const key = await apiCreateIssue(page.request, { title: 'Stacked properties' });
    await page.goto(`/i/${key}`);
    const title = await page.getByTestId('issue-title').boundingBox();
    const props = await page.getByTestId('issue-properties').boundingBox();
    expect(props!.y).toBeGreaterThan(title!.y + title!.height - 1);
    expect(props!.x + props!.width).toBeLessThanOrEqual(390);
  });
});

test('wraps long titles in the peek panel', async ({ page }) => {
  const title =
    'A deliberately long issue title that would never fit on a single line of the side panel';
  const key = await apiCreateIssue(page.request, { title });
  await openList(page);
  await page.locator(`[data-testid="issue-row"][data-key="${key}"]`).getByText(title).click();
  const field = page.getByTestId('peek-panel').getByTestId('issue-title');
  await expect(field).toHaveValue(title);
  const clipped = await field.evaluate((el) => el.scrollHeight > el.clientHeight + 1);
  expect(clipped).toBe(false);
});

test('explains empty results and offers a way out', async ({ page }) => {
  await openList(page);
  await page.getByTestId('search').fill('no issue has this title zzz');
  await expect(page.getByTestId('empty-list')).toContainText('No issues match these filters');
  await page.getByRole('button', { name: 'Reset view' }).click();
  await expect(page.getByTestId('issue-row').first()).toBeVisible();
});

test('shows helpful pages for missing issues and unknown URLs', async ({ page }) => {
  await page.goto('/i/ENG-99999');
  await expect(page.getByTestId('issue-error')).toContainText('ENG-99999 doesn’t exist');
  await page.getByRole('link', { name: 'Back to ENG issues' }).click();
  await expect(page).toHaveURL(/\/p\/ENG/);

  await page.goto('/definitely/not/a/page');
  await expect(page.getByTestId('error-page')).toContainText('This page doesn’t exist');
});

test('creates a project, then renames it', async ({ page }) => {
  await openList(page);
  const name = `Launch ${Date.now() % 100000}`;
  await page.getByTestId('new-project').click();
  await page.getByTestId('project-name').fill(name);
  const key = await page.getByTestId('project-key').inputValue();
  expect(key).toMatch(/^L[A-Z0-9]+$/);
  await page.getByTestId('project-key').fill(`L${Date.now() % 100000}`);
  const finalKey = await page.getByTestId('project-key').inputValue();
  await page.getByTestId('create-project-submit').click();
  await expect(page).toHaveURL(new RegExp(`/p/${finalKey}$`));
  await expect(page.getByTestId('empty-list')).toContainText('No issues yet');

  await page.goto(`/p/${finalKey}/settings`);
  const input = page.getByLabel('Project name');
  await input.fill(`${name} (renamed)`);
  await input.press('Tab');
  await expect(page.getByRole('navigation', { name: 'Main' })).toContainText(`${name} (renamed)`);
});

test('board columns collapse, remember it, and scroll into view', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto('/p/ENG/board');
  const backlog = page.locator('[data-testid="board-column"][data-column="Backlog"]');
  await backlog.locator('header').hover();
  await page.getByRole('button', { name: 'Collapse Backlog' }).click();
  await expect(
    page.locator('[data-testid="board-column-collapsed"][data-column="Backlog"]'),
  ).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Expand Backlog' }).click();
  await expect(backlog).toBeVisible();

  const canceled = page.locator('[data-testid="board-column"][data-column="Canceled"]');
  await expect(canceled).not.toBeInViewport();
  await expect(async () => {
    if (await page.getByTestId('board-scroll-right').isVisible())
      await page.getByTestId('board-scroll-right').click();
    await expect(canceled).toBeInViewport({ ratio: 0.9, timeout: 800 });
  }).toPass({ timeout: 8000 });
  await expect(page.getByTestId('board-scroll-right')).toBeHidden();
});

test('issue sections explain what is empty and show sub-issue progress', async ({ page }) => {
  const parent = await apiCreateIssue(page.request, { title: 'Parent with progress' });
  await page.goto(`/i/${parent}`);
  await expect(page.getByTestId('sub-issues')).toContainText('No sub-issues');
  await expect(page.getByTestId('links')).toContainText('No linked issues');
  await apiCreateIssue(page.request, { title: 'Child one', parent });
  await page.reload();
  await expect(page.getByRole('progressbar', { name: 'Sub-issues done' })).toHaveAttribute(
    'aria-valuemax',
    '1',
  );
});

test('never asks the API for project data without a project key', async ({ page }) => {
  const keyless: string[] = [];
  page.on('request', (r) => {
    if (/\/api\/v1\/projects\/\//.test(r.url())) keyless.push(r.url());
  });
  await page.goto('/'); // redirects to the first project
  await expect(page).toHaveURL(/\/p\/ENG$/);
  await expect(page.getByTestId('issue-row').first()).toBeVisible();
  await page.goto('/p/ENG/board');
  await expect(page.getByTestId('nav-board')).toBeVisible();
  expect(keyless).toEqual([]);
});
