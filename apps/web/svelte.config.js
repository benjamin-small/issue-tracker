import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/**
 * POIETIC_ISSUES_DEMO=1 builds the self-contained browser demo (see src/demo/): hash routing, so it works from any
 * URL a static host gives it, and one JS and one CSS file.
 */
const demo = process.env.POIETIC_ISSUES_DEMO === '1';

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    // Single-page app: every route renders client-side from index.html (served by the API server in production).
    adapter: adapter(
      demo
        ? { pages: 'build-demo', assets: 'build-demo', fallback: 'index.html', strict: false }
        : { fallback: 'index.html', strict: false },
    ),
    alias: { $components: 'src/lib/components' },
    ...(demo && {
      router: { type: 'hash' },
      // Some static hosts reserve names starting with `_`.
      appDir: 'app',
      output: { bundleStrategy: 'single' },
      // A copy of src/routes without +layout.ts, whose page options hash routing rejects (scripts/build-demo.ts).
      files: { routes: 'src/.demo-routes' },
    }),
  },
};
