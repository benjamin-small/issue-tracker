import type { Page } from '@playwright/test';
import { apiCreateIssue, expect, test } from './fixtures.ts';

async function drag(
  page: Page,
  source: ReturnType<Page['locator']>,
  target: ReturnType<Page['locator']>,
) {
  await target.scrollIntoViewIfNeeded();
  await source.scrollIntoViewIfNeeded();
  const from = (await source.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + 12);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 5, from.y + 20, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + 30, { steps: 20 });
  await page.waitForTimeout(150);
  await page.mouse.up();
}

test('defines a select field, sets it, groups the board by it and drags between options', async ({
  page,
}) => {
  // Define the field in project settings.
  await page.goto('/p/ENG/settings');
  const form = page.getByTestId('new-field');
  await form.getByLabel('Field key').fill('team');
  await form.getByLabel('Field name').fill('Team');
  await form.getByLabel('Field type').selectOption('select');
  await form.getByLabel('Field options').fill('frontend, backend, infra');
  await form.getByRole('button', { name: 'Add field' }).click();
  await expect(page.locator('[data-field-key="team"]')).toContainText('frontend');

  // Set it on an issue from the properties sidebar.
  const key = await apiCreateIssue(page.request, { title: 'Needs a team' });
  await page.goto(`/i/${key}`);
  await page.getByTestId('cf-team').click();
  await page.getByRole('option', { name: 'backend' }).click();
  await expect(page.getByTestId('cf-team')).toContainText('backend');
  await expect
    .poll(async () => (await (await page.request.get(`/api/v1/issues/${key}`)).json()).customFields)
    .toEqual({
      team: 'backend',
    });

  // Group the board by the field; the card sits in the "backend" column.
  await page.goto('/p/ENG/board');
  await page.getByTestId('display-options').click();
  await page.getByLabel('Group by').selectOption('cf:team');
  await page.getByTestId('display-fields').locator('input[data-field="cf:team"]').check();
  await page.keyboard.press('Escape');
  const column = (name: string) =>
    page.locator(`[data-testid="board-column"][data-column="${name}"]`);
  const card = page.locator(`[data-testid="issue-card"][data-key="${key}"]`);
  await expect(column('backend').locator(`[data-key="${key}"]`)).toBeVisible();
  await expect(card.locator('[data-cf="team"]')).toContainText('backend');

  // Drag it to "infra": the field value changes.
  const moved = page.waitForResponse(
    (r) => r.url().endsWith(`/issues/${key}`) && r.request().method() === 'PATCH' && r.ok(),
  );
  await drag(page, card, column('infra').locator('div').last());
  await moved;
  await expect(column('infra').locator(`[data-key="${key}"]`)).toBeVisible();
  expect((await (await page.request.get(`/api/v1/issues/${key}`)).json()).customFields).toEqual({
    team: 'infra',
  });
});
