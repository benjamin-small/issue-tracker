import { fileURLToPath } from 'node:url';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

const api = process.env.TRACKER_API_URL ?? 'http://127.0.0.1:3000';
const demo = process.env.TRACKER_DEMO === '1';
const shim = (file: string) => fileURLToPath(new URL(`./src/demo/shims/${file}`, import.meta.url));

/** Node-only modules the server code imports, mapped to browser stand-ins for the demo build. */
const demoAliases = [
  { find: /^node:crypto$/, replacement: shim('node-crypto.ts') },
  { find: 'better-sqlite3', replacement: shim('better-sqlite3.ts') },
  { find: /^pino$/, replacement: shim('pino.ts') },
  {
    find: /^(node:(fs|fs\/promises|path|os|url|util|http|https|dns|net|stream)|pg|@hono\/node-server(\/serve-static)?)$/,
    replacement: shim('node-stubs.ts'),
  },
];

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  resolve: demo ? { alias: demoAliases } : {},
  define: { 'import.meta.env.TRACKER_DEMO': JSON.stringify(demo) },
  server: {
    // Bind IPv4 like the API; `localhost` resolves to ::1 only on macOS, so 127.0.0.1 links would miss Vite.
    host: '127.0.0.1',
    port: 5173,
    // Same-origin in development: the browser talks to Vite, which forwards API calls (and SSE) to the server.
    proxy: { '/api': { target: api, changeOrigin: false } },
  },
  test: { name: 'web', include: ['src/**/*.test.ts'], passWithNoTests: true },
});
