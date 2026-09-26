// Starts the API server with the built web app on a fresh database for end-to-end tests.
// E2E_DATABASE_URL (e.g. a Postgres URL) overrides the default throwaway SQLite file.
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig, startServer } from '../../server/src/index.ts';

const dbFile = fileURLToPath(new URL('../test-results/e2e.db', import.meta.url));
const url = process.env.E2E_DATABASE_URL ?? `sqlite:${dbFile}`;
if (url.startsWith('sqlite:'))
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${dbFile}${suffix}`, { force: true });

const server = await startServer(
  loadConfig({
    TRACKER_DATABASE_URL: url,
    TRACKER_PORT: process.env.E2E_PORT ?? '3100',
    TRACKER_WEB_DIR: fileURLToPath(new URL('../build', import.meta.url)),
    TRACKER_AUTH_MODE: 'dev',
    TRACKER_SEED: '1',
  }),
);
console.log(`e2e server on ${server.url}`);
