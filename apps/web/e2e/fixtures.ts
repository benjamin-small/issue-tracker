import { type APIRequestContext, test as base, expect, type Page } from '@playwright/test';

/** Signs the browser in as a seeded user (dev login) before each test. */
export const test = base.extend<{ user: string }>({
  user: ['ada', { option: true }],
  page: async ({ page, user }, use) => {
    const res = await page.request.post('/api/v1/auth/dev-login', { data: { user } });
    expect(res.ok()).toBe(true);
    await use(page);
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
