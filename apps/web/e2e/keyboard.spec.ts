import { apiCreateIssue, expect, openList, test } from './fixtures.ts';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

test('the command menu navigates and finds issues', async ({ page }) => {
  const key = await apiCreateIssue(page.request, { title: 'Findable from the command menu' });
  await openList(page);
  await page.keyboard.press(`${mod}+k`);
  const menu = page.getByTestId('command-menu');
  await expect(menu).toBeVisible();
  await page.getByTestId('command-input').fill('Engineering board');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/p\/ENG\/board$/);

  await page.keyboard.press(`${mod}+k`);
  await page.getByTestId('command-input').fill('Findable from the command');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('peek-panel').getByTestId('issue-title')).toHaveValue(
    'Findable from the command menu',
  );
  await expect(page.getByTestId('peek-panel').getByTestId('issue-detail')).toHaveAttribute(
    'data-issue',
    key,
  );
});

test('j/k focus, x selects, and bulk status change applies to the selection', async ({ page }) => {
  const a = await apiCreateIssue(page.request, { title: 'Bulk A', priority: 1 });
  const b = await apiCreateIssue(page.request, { title: 'Bulk B', priority: 1 });
  await openList(page);
  await page.getByTestId('search').fill('Bulk ');
  await expect(page.getByTestId('issue-row')).toHaveCount(2);
  await page.locator('body').click({ position: { x: 5, y: 400 } });

  await page.keyboard.press('j');
  await expect(page.locator('[data-testid="issue-row"][data-focused="true"]')).toHaveCount(1);
  await page.keyboard.press('x');
  await page.keyboard.press('j');
  await page.keyboard.press('x');
  await expect(page.getByTestId('selection-count')).toHaveText('2 selected');

  await page.keyboard.press('s');
  await expect(page.getByTestId('command-menu')).toBeVisible();
  await page.getByTestId('command-input').fill('In Progress');
  await page.keyboard.press('Enter');
  for (const key of [a, b])
    await expect
      .poll(async () => {
        const res = await page.request.get(`/api/v1/issues/${key}`);
        return ((await res.json()) as { status: { name: string } }).status.name;
      })
      .toBe('In Progress');
  await expect(page.getByText('Status → In Progress on 2 issues')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('selection-bar')).toBeHidden();
});

test('number keys set priority and the mod+backspace delete can be undone', async ({ page }) => {
  const key = await apiCreateIssue(page.request, { title: 'Keyboard priority target' });
  await openList(page);
  await page.getByTestId('search').fill('Keyboard priority target');
  await expect(page.getByTestId('issue-row')).toHaveCount(1);
  await page.locator('body').click({ position: { x: 5, y: 400 } });
  await page.keyboard.press('j');
  await page.keyboard.press('2');
  await expect(page.getByText(`${key}: Priority → High`)).toBeVisible();

  await page.keyboard.press(`${mod}+Backspace`);
  await expect(page.getByText(`${key} moved to the trash`)).toBeVisible();
  await expect(page.getByTestId('issue-row')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('issue-row')).toHaveCount(1);
});

test('? shows shortcuts and Escape closes the peek panel', async ({ page }) => {
  await openList(page);
  await page.keyboard.press('?');
  await expect(page.getByTestId('shortcuts-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('shortcuts-dialog')).toBeHidden();

  await page.getByTestId('issue-row').first().click();
  await expect(page.getByTestId('peek-panel')).toBeVisible();
  await page.locator('body').click({ position: { x: 5, y: 400 } });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('peek-panel')).toBeHidden();
});

test('destructive settings actions ask in the app, not the browser', async ({ page }) => {
  const name = `temp-${Date.now() % 100000}`;
  await page.goto('/p/ENG/settings');
  await page.getByPlaceholder('New label').fill(name);
  await page.getByRole('button', { name: 'Add label' }).click();
  const labelRow = page.getByTestId('settings-labels').locator(`li[data-label="${name}"]`);
  await labelRow.getByRole('button', { name: /Delete/ }).click();
  await expect(page.getByTestId('confirm-dialog')).toContainText(`Delete the label “${name}”?`);
  await page.getByTestId('confirm-ok').click();
  await expect(labelRow).toHaveCount(0);
});
