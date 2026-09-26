import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { createDb, type Db } from './dialect.ts';
import { migrateToLatest, migrationsFingerprint } from './migrate.ts';

/** Which dialect the shared test suites run against (`TEST_DB=sqlite|postgres`, default sqlite). */
export function testDialect(): 'sqlite' | 'postgres' {
  const value = process.env.TEST_DB ?? 'sqlite';
  if (value !== 'sqlite' && value !== 'postgres') throw new Error(`Invalid TEST_DB "${value}"`);
  return value;
}

export const DEFAULT_TEST_DATABASE_URL = 'postgres://tracker@127.0.0.1:54329/tracker';

export interface TestDbOptions {
  /** SQLite only: use a real file (WAL, multi-process) instead of `:memory:`. */
  file?: boolean;
  /** Skip running migrations. */
  migrate?: boolean;
}

export interface TestDb extends Db {
  /** Connection URL of this isolated database (e.g. to hand to a child process). */
  readonly url: string;
}

/**
 * Creates an isolated, migrated database for one test file, on the dialect selected by `TEST_DB`.
 *
 * - SQLite: a fresh in-memory (or temp-file) database, migrated.
 * - Postgres: `CREATE DATABASE … TEMPLATE` from a template migrated once per migration fingerprint —
 *   tens of milliseconds per database. `destroy()` drops it.
 */
export async function createTestDb(options: TestDbOptions = {}): Promise<TestDb> {
  const migrate = options.migrate ?? true;
  if (testDialect() === 'sqlite') {
    let url = 'sqlite::memory:';
    let dir: string | undefined;
    if (options.file) {
      dir = mkdtempSync(join(tmpdir(), 'tracker-test-'));
      url = `sqlite:${join(dir, 'test.db')}`;
    }
    const db = createDb(url);
    if (migrate) await migrateToLatest(db);
    return {
      ...db,
      url,
      async destroy() {
        await db.destroy();
        if (dir) rmSync(dir, { recursive: true, force: true });
      },
    };
  }
  return createPostgresTestDb(migrate);
}

const LOCK_KEY = 7_424_243;

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

async function createPostgresTestDb(migrate: boolean): Promise<TestDb> {
  const adminUrl = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
  const template = `tracker_tpl_${migrationsFingerprint()}`;
  const name = `tracker_t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    // Serialize template creation and cloning across parallel test workers.
    await admin.query('select pg_advisory_lock($1)', [LOCK_KEY]);
    if (migrate) {
      const exists = await admin.query('select 1 from pg_database where datname = $1', [template]);
      if (exists.rowCount === 0) {
        const stale = await admin.query<{ datname: string }>(
          "select datname from pg_database where datname like 'tracker_tpl_%'",
        );
        for (const row of stale.rows) {
          await admin
            .query(`drop database if exists "${row.datname}" with (force)`)
            .catch(() => {});
        }
        await admin.query(`create database "${template}"`);
        const templateDb = createDb(withDatabase(adminUrl, template), { poolSize: 1 });
        try {
          await migrateToLatest(templateDb);
        } finally {
          await templateDb.destroy();
        }
      }
      await admin.query(`create database "${name}" template "${template}"`);
    } else {
      await admin.query(`create database "${name}"`);
    }
  } finally {
    await admin.query('select pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    await admin.end();
  }

  const url = withDatabase(adminUrl, name);
  const db = createDb(url, { poolSize: 5 });
  return {
    ...db,
    url,
    async destroy() {
      await db.destroy();
      const cleanup = new pg.Client({ connectionString: adminUrl });
      await cleanup.connect();
      try {
        await cleanup.query(`drop database if exists "${name}" with (force)`);
      } finally {
        await cleanup.end();
      }
    },
  };
}
