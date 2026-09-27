import type { Page } from '@playwright/test';
import { apiCreateIssue, choose, expect, openList, row, test } from './fixtures.ts';

async function issueJson(page: Page, key: string) {
  const res = await page.request.get(`/api/v1/issues/${key}`);
  return (await res.json()) as {
    dueDate: string | null;
    description: string;
    status: { name: string };
  };
}

test('due dates are set from a calendar with quick picks, and cleared', async ({ page }) => {
  const key = await apiCreateIssue(page.request, { title: 'Date picker target' });
  await page.goto(`/i/${key}`);
  const due = page.getByTestId('due-date');
  await expect(due).toHaveText('Set due date');
  await due.click();
  await page.getByRole('button', { name: 'Tomorrow' }).click();
  const tomorrow = new Date(Date.now() + 86_400_000);
  const iso = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  await expect(due).toHaveAttribute('data-value', iso);
  await expect.poll(async () => (await issueJson(page, key)).dueDate).toBe(iso);

  await due.click();
  await page.getByTestId('date-clear').click();
  await expect(due).toHaveText('Set due date');
  await expect.poll(async () => (await issueJson(page, key)).dueDate).toBeNull();
});

test('filter chips show their values and switch between is and is not', async ({ page }) => {
  const todo = await apiCreateIssue(page.request, { title: 'Chip filter todo' });
  await openList(page);
  await page.getByTestId('search').fill('Chip filter');
  await expect(row(page, todo)).toBeVisible();

  await page.getByTestId('filter-status').click();
  await page.getByRole('option', { name: 'Todo' }).click();
  await page.keyboard.press('Escape');
  const chip = page.getByTestId('filter-status-active');
  await expect(chip).toContainText('Status');
  await expect(chip).toContainText('is');
  await expect(chip).toContainText('Todo');
  await expect(row(page, todo)).toBeVisible();

  await page.getByTestId('filter-status-op').click();
  await expect(chip).toContainText('is not');
  await expect(row(page, todo)).toHaveCount(0);

  await chip.getByRole('button', { name: 'Remove status filter' }).click();
  await expect(chip).toHaveCount(0);
  await expect(row(page, todo)).toBeVisible();
});

test('task list checkboxes in descriptions can be ticked', async ({ page }) => {
  const key = await apiCreateIssue(page.request, {
    title: 'Checklist',
    description: '```\n- [ ] not a task\n```\n\n- [ ] first\n- [ ] second',
  });
  await page.goto(`/i/${key}`);
  const boxes = page.getByTestId('description').getByRole('checkbox');
  await expect(boxes).toHaveCount(2);
  await boxes.nth(1).check();
  await expect
    .poll(async () => (await issueJson(page, key)).description)
    .toBe('```\n- [ ] not a task\n```\n\n- [ ] first\n- [x] second');
  // Ticking a box doesn't open the editor.
  await expect(page.getByTestId('description-input')).toHaveCount(0);
});

test('workflow statuses reorder by dragging and delete through a dialog', async ({ page }) => {
  await page.goto('/p/ENG/settings');
  const statuses = page.getByTestId('settings-statuses');
  await statuses.getByPlaceholder('New status').fill('Parked');
  await choose(statuses, 'New status category', /Backlog/);
  await statuses.getByRole('button', { name: 'Add status' }).click();
  const names = statuses.getByLabel('Status name', { exact: true });
  await expect(names.last()).toHaveValue('Parked');

  // Keyboard drag: focus the grip, pick up, move up one, drop.
  const handle = statuses.getByLabel('Reorder Parked');
  await handle.focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Space');
  await expect(page.getByText('Workflow order saved')).toBeVisible();
  const count = await names.count();
  await expect(names.nth(count - 2)).toHaveValue('Parked');

  await statuses.getByRole('button', { name: 'Delete status Parked' }).click();
  const dialog = page.getByTestId('delete-status-dialog');
  await expect(dialog).toContainText('Move issues to');
  await dialog.getByRole('button', { name: 'Delete status' }).click();
  await expect(page.getByText('Deleted “Parked”')).toBeVisible();
  await expect(names).toHaveCount(count - 1);
});

test('label colours come from the palette', async ({ page }) => {
  await page.goto('/p/ENG/settings');
  const name = `colour-${Date.now() % 100000}`;
  await page.getByPlaceholder('New label').fill(name);
  await page.getByRole('button', { name: 'Add label' }).click();
  const labelRow = page.getByTestId('settings-labels').locator(`li[data-label="${name}"]`);
  await labelRow.getByLabel(`Colour of ${name}`).click();
  await page.getByRole('button', { name: '#22c55e' }).click();
  await expect(page.getByText(`Saved “${name}”`)).toBeVisible();
  const res = await page.request.get('/api/v1/projects/ENG/labels');
  const labels = ((await res.json()) as { data: { name: string; color: string }[] }).data;
  expect(labels.find((l) => l.name === name)?.color).toBe('#22c55e');
});

test('list columns reorder by dragging in the Display panel', async ({ page }) => {
  await openList(page);
  await page.getByTestId('display-options').click();
  const handles = page.getByTestId('display-fields').getByTestId('drag-handle');
  const before = await handles.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  expect(before.length).toBeGreaterThan(1);
  await handles.nth(1).focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Space');
  await expect
    .poll(() => handles.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label'))))
    .toEqual([before[1], before[0], ...before.slice(2)]);
  await expect(page).toHaveURL(/[?&]v=/);
});
