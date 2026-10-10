import { expect, type Page, test } from '@playwright/test';

// The demo seeds a public project (ENG) and a private one (OPS) with members at three roles.
const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Main' });
const signInAs = async (page: Page, name: string) => {
  await sidebar(page).getByRole('button', { name: 'Sign in' }).click();
  await page.getByText(name).click();
};

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
  await page.goto('index.html');
});

test('signed out, visitors see the public project and not the private one', async ({ page }) => {
  await expect(page.getByTestId('issue-row').first()).toBeVisible();
  await expect(sidebar(page).getByRole('link', { name: /ENG/ }).first()).toBeVisible();
  await expect(sidebar(page).getByRole('link', { name: /OPS/ })).toHaveCount(0);
});

test('the private project is visible to its manager', async ({ page }) => {
  await signInAs(page, 'Margaret Hamilton');
  await expect(sidebar(page).getByRole('link', { name: /OPS/ }).first()).toBeVisible();
  await sidebar(page).getByRole('link', { name: /OPS/ }).first().click();
  await expect(
    page.getByTestId('issue-row').filter({ hasText: 'Write the on-call runbook' }),
  ).toBeVisible();
});
