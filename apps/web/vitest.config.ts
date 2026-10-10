import { defineProject } from 'vitest/config';

// Unit tests for the web app's plain TypeScript modules (no SvelteKit runtime); the UI is covered by Playwright.
// `tsconfig.json` extends `.svelte-kit/tsconfig.json`, which only exists after `svelte-kit sync`; these modules need
// none of its settings, so the oxc transform must not look for it (a fresh checkout or CI runs tests before any sync).
export default defineProject({
  oxc: { tsconfig: false },
  test: { name: 'web', include: ['src/**/*.test.ts'] },
});
