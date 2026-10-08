// Starts the API server with the built web app on a fresh database for end-to-end tests.
// E2E_DATABASE_URL (e.g. a Postgres URL) overrides the default throwaway SQLite file.
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig, startServer } from '../../server/src/index.ts';

const dbFile = fileURLToPath(new URL('../test-results/e2e.db', import.meta.url));
const blobDir = fileURLToPath(new URL('../test-results/e2e-blobs', import.meta.url));
rmSync(blobDir, { recursive: true, force: true });
const url = process.env.E2E_DATABASE_URL || `sqlite:${dbFile}`; // empty (as CI sets it) = SQLite
if (url.startsWith('sqlite:'))
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${dbFile}${suffix}`, { force: true });

const server = await startServer(
  loadConfig({
    POIETIC_ISSUES_DATABASE_URL: url,
    POIETIC_ISSUES_PORT: process.env.E2E_PORT ?? '3100',
    POIETIC_ISSUES_WEB_DIR: fileURLToPath(new URL('../build', import.meta.url)),
    POIETIC_ISSUES_AUTH_MODE: 'dev',
    POIETIC_ISSUES_SEED: '1',
    POIETIC_ISSUES_BLOB_DIR: blobDir,
    POIETIC_ISSUES_LOG_LEVEL: process.env.POIETIC_ISSUES_LOG_LEVEL ?? 'warn',
  }),
);
console.log(`e2e server on ${server.url}`);
