import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    // Single-page app: every route renders client-side from index.html (served by the API server in production).
    adapter: adapter({ fallback: 'index.html', strict: false }),
    alias: { $components: 'src/lib/components' },
  },
};
