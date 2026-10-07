import { expect, test } from '@playwright/test';

const SSO = {
  name: 'Example',
  loginUrl: 'https://auth.example.test/login',
  refreshUrl: 'https://auth.example.test/me',
};

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/auth/config', (r) =>
    r.fulfill({ json: { devLogin: false, sso: SSO } }),
  );
  await page.route('https://auth.example.test/me', (r) => r.fulfill({ status: 200, json: {} }));
});

test('shows the pending screen when the account awaits approval', async ({ page }) => {
  await page.route('**/api/v1/auth/sso', (r) =>
    r.fulfill({
      status: 403,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        type: 'urn:tracker:error:PENDING_APPROVAL',
        title: 'Awaiting approval',
        status: 403,
        code: 'PENDING_APPROVAL',
        detail: '@pat is waiting for an admin to approve access',
      }),
    }),
  );
  await page.goto('/login');
  await expect(page.getByText('Waiting for approval')).toBeVisible();
  await expect(page.getByText('@pat is waiting')).toBeVisible();
});

test('sends a signed-out visitor to the SSO login with a redirect back', async ({ page }) => {
  await page.route('**/api/v1/auth/sso', (r) =>
    r.fulfill({
      status: 401,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        type: 'urn:tracker:error:UNAUTHENTICATED',
        title: 'Authentication required',
        status: 401,
        code: 'UNAUTHENTICATED',
      }),
    }),
  );
  await page.route('https://auth.example.test/login**', (r) =>
    r.fulfill({ status: 200, body: 'login page' }),
  );
  await page.goto('/login?next=%2Fp%2FENG');
  const button = page.getByRole('button', { name: 'Sign in with Example' });
  await expect(button).toBeVisible(); // the automatic attempt got a 401 and stayed put
  await button.click();
  await page.waitForURL(/auth\.example\.test\/login/);
  const redirect = new URL(page.url()).searchParams.get('redirect')!;
  expect(new URL(redirect).pathname).toBe('/login');
  expect(new URL(redirect).searchParams.get('next')).toBe('/p/ENG');
});

test('enters the app when SSO sign-in succeeds', async ({ page }) => {
  // Sign in for real via dev login, then let the mocked SSO call report success.
  const user = await (
    await page.request.post('/api/v1/auth/dev-login', { data: { user: 'ada' } })
  ).json();
  await page.route('**/api/v1/auth/sso', (r) => r.fulfill({ status: 200, json: user }));
  await page.goto('/login?next=%2Fp%2FENG');
  await page.waitForURL(/\/p\/ENG/);
});
