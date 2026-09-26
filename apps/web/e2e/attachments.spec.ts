import { apiCreateIssue, expect, test } from './fixtures.ts';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

test('uploads files from the picker and shows image thumbnails', async ({ page }) => {
  const key = await apiCreateIssue(page.request, { title: 'Attachment picker' });
  await page.goto(`/i/${key}`);
  await page.getByTestId('attachment-input').setInputFiles([
    { name: 'dot.png', mimeType: 'image/png', buffer: PNG },
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') },
  ]);
  const files = page.getByTestId('attachment');
  await expect(files).toHaveCount(2);
  const image = page.locator('[data-testid="attachment"][data-filename="dot.png"] img');
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
  await expect(page.getByText('attached notes.txt')).toBeVisible();

  // Persisted, and deletable.
  await page.reload();
  await expect(files).toHaveCount(2);
  const notes = page.locator('[data-testid="attachment"][data-filename="notes.txt"]');
  await notes.hover();
  await notes.getByRole('button', { name: 'Delete notes.txt' }).click();
  await expect(files).toHaveCount(1);
});

test('pasting an image into the description uploads it and inserts markdown', async ({ page }) => {
  const key = await apiCreateIssue(page.request, { title: 'Attachment paste' });
  await page.goto(`/i/${key}`);
  await page.getByTestId('description').click();
  const input = page.getByTestId('description-input');
  await input.evaluate(
    (el, bytes) => {
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array(bytes)], 'shot.png', { type: 'image/png' }));
      el.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
    },
    [...PNG],
  );
  await expect(input).toHaveValue(/^!\[shot\.png\]\(\/api\/v1\/attachments\/att_\w+\/content\)$/);
  await page.getByTestId('description-save').click();
  await expect(page.getByTestId('description').locator('img[alt="shot.png"]')).toBeVisible();
  await expect(page.locator('[data-testid="attachment"][data-filename="shot.png"]')).toBeVisible();
});

test('active content is never served inline', async ({ page }) => {
  const key = await apiCreateIssue(page.request, { title: 'Attachment svg' });
  const upload = await page.request.post(`/api/v1/issues/${key}/attachments`, {
    multipart: {
      file: {
        name: 'x.svg',
        mimeType: 'image/svg+xml',
        buffer: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        ),
      },
    },
    headers: { origin: `http://127.0.0.1:${process.env.E2E_PORT ?? 3100}` },
  });
  expect(upload.status()).toBe(201);
  const { url } = (await upload.json()) as { url: string };
  const res = await page.request.get(url);
  expect(res.headers()['content-disposition']).toMatch(/^attachment;/);
  expect(res.headers()['x-content-type-options']).toBe('nosniff');
  expect(res.headers()['content-security-policy']).toContain('sandbox');
});
