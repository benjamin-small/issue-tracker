// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/',
      '**/dist/',
      '**/build/',
      '**/.svelte-kit/',
      '**/coverage/',
      'packages/client/src/generated/',
      'apps/web/test-results/',
      'apps/web/playwright-report/',
      'apps/web/build-demo/',
      '**/.demo-routes/',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  ...svelte.configs.recommended,
  {
    files: ['**/*.svelte', '**/*.svelte.ts', 'apps/web/src/lib/nav.ts'],
    rules: {
      // Internal links and navigation go through $lib/nav.ts, which resolves paths for both the path router
      // (the served app) and the hash router (the demo build) — resolve() alone can't produce hash links.
      'svelte/no-navigation-without-resolve': 'off',
    },
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        projectService: true,
        extraFileExtensions: ['.svelte'],
        parser: tseslint.parser,
      },
    },
  },
  {
    files: ['apps/web/**/*.ts'],
    languageOptions: { globals: { ...globals.browser } },
  },
  prettier,
  ...svelte.configs.prettier,
);
