import {
  type APIRequestContext,
  test as base,
  expect,
  type Locator,
  type Page,
} from '@playwright/test';

/** Signs the browser in as a seeded user (dev login) before each test, and fails it on uncaught page errors. */
export const test = base.extend<{ user: string }>({
  user: ['ada', { option: true }],
  page: async ({ page, user }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const res = await page.request.post('/api/v1/auth/dev-login', { data: { user } });
    expect(res.ok()).toBe(true);
    await use(page);
    expect(errors, 'uncaught errors in the page').toEqual([]);
  },
});

export { expect };

let counter = 0;
/** Creates an issue through the API (fast setup) and returns its key. */
export async function apiCreateIssue(
  request: APIRequestContext,
  body: Record<string, unknown> & { title?: string },
): Promise<string> {
  const res = await request.post('/api/v1/projects/ENG/issues', {
    data: { title: `E2E issue ${Date.now()}-${counter++}`, ...body },
    headers: { origin: `http://127.0.0.1:${process.env.E2E_PORT ?? 3100}` },
  });
  expect(res.ok(), await res.text()).toBe(true);
  return ((await res.json()) as { key: string }).key;
}

export async function openList(page: Page) {
  await page.goto('/p/ENG');
  await expect(page.getByTestId('issue-row').first()).toBeVisible();
}

export function row(page: Page, key: string) {
  return page.locator(`[data-testid="issue-row"][data-key="${key}"]`);
}

/** Picks an option in one of the app's Select dropdowns (they replace native selects). */
export async function choose(scope: Page | Locator, label: string, option: string | RegExp) {
  await scope.getByLabel(label, { exact: true }).click();
  const page = 'page' in scope ? scope.page() : scope;
  await page.getByRole('option', { name: option }).click();
}
