import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { apiCreateIssue, expect, test } from './fixtures.ts';

let receiver: Server;
let url: string;
const bodies: string[] = [];

test.beforeAll(async () => {
  receiver = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      bodies.push(body);
      res.writeHead(200).end('ok');
    });
  });
  await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/e2e`;
});
test.afterAll(() => {
  receiver.close();
});

test('an admin registers a webhook, tests it and watches deliveries arrive', async ({ page }) => {
  await page.goto('/p/ENG');
  await page.getByTestId('nav-webhooks').click();
  await expect(page).toHaveURL(/\/settings\/webhooks$/);

  const form = page.getByTestId('new-webhook');
  await form.getByLabel('Webhook URL').fill(url);
  await form.getByLabel('Event types').fill('issue.created');
  await form.getByLabel('Project').selectOption('ENG');
  await form.getByRole('button', { name: 'Add webhook' }).click();
  await expect(page.getByTestId('webhook-secret')).toContainText('whsec_');

  const hook = page.locator(`[data-testid="webhook"][data-url="${url}"]`);
  await hook.getByTestId('webhook-test').click();
  await expect(page.getByText(/Ping delivered: HTTP 200/)).toBeVisible();
  expect(JSON.parse(bodies.at(-1)!).type).toBe('webhook.ping');

  const key = await apiCreateIssue(page.request, { title: 'Hooked' });
  await hook.getByRole('button', { name: 'Show deliveries' }).click();
  await expect(hook.locator('[data-testid="delivery"][data-status="succeeded"]')).toHaveCount(1, {
    timeout: 15_000,
  });
  expect(
    bodies.map((b) => JSON.parse(b)).find((e) => e.type === 'issue.created')?.data.issue.key,
  ).toBe(key);
});
