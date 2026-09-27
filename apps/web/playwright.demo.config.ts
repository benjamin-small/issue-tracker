import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// The self-contained browser demo (`pnpm build:demo` first), served as static files from a sub-path.
const PORT = Number(process.env.DEMO_PORT ?? 3200);
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_PATH ??
  (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

export default defineConfig({
  testDir: './e2e-demo',
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}/some/path/`,
    ...devices['Desktop Chrome'],
    viewport: { width: 1400, height: 900 },
    ...(executablePath && { launchOptions: { executablePath } }),
  },
  webServer: {
    command: 'node e2e-demo/serve.ts',
    url: `http://127.0.0.1:${PORT}/some/path/index.html`,
    reuseExistingServer: false,
    env: { DEMO_PORT: String(PORT) },
  },
});
