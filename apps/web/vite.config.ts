import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

const api = process.env.TRACKER_API_URL ?? 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    port: 5173,
    // Same-origin in development: the browser talks to Vite, which forwards API calls (and SSE) to the server.
    proxy: { '/api': { target: api, changeOrigin: false } },
  },
  test: { name: 'web', include: ['src/**/*.test.ts'], passWithNoTests: true },
});
