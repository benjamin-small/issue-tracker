import { defineProject } from 'vitest/config';

// Unit tests for the web app's plain TypeScript modules (no SvelteKit runtime); the UI is covered by Playwright.
export default defineProject({
  test: { name: 'web', include: ['src/**/*.test.ts'] },
});
