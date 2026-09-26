import BetterSqlite3 from 'better-sqlite3';
import {
  type DatabaseConnection,
  type DialectAdapter,
  Kysely,
  PostgresDialect,
  SqliteAdapter,
  SqliteDialect,
} from 'kysely';
import pg from 'pg';
import { SqliteBooleanPlugin } from './plugins.ts';
import type { Database } from './types.ts';
import { type DatabaseConfig, parseDatabaseUrl } from './url.ts';

export type Dialect = 'sqlite' | 'postgres';

/**
 * A database handle: the Kysely instance plus the facts about it that portable code needs.
 * Create one per process with {@link createDb}; share it everywhere.
 */
export interface Db {
  readonly kysely: Kysely<Database>;
  readonly dialect: Dialect;
  /**
   * Register a listener fired after every successful {@link withWriteTx} commit in this process.
   * Used by the event tailer to wake immediately on local writes. Returns an unsubscribe function.
   */
  onCommit(listener: () => void): () => void;
  /** @internal called by withWriteTx */
  notifyCommit(): void;
  /**
   * Subscribes to a Postgres NOTIFY channel on a dedicated connection (cross-process wake-ups).
   * On SQLite this is a no-op: other processes' writes are found by polling. Returns an unsubscribe function.
   */
  listen(channel: string, onNotify: () => void): Promise<() => Promise<void>>;
  destroy(): Promise<void>;
}

export interface CreateDbOptions {
  /** Max pool size for Postgres. Default 10. */
  poolSize?: number;
}

/** Creates a {@link Db} from a `DATABASE_URL`-style string or a parsed config. */
export function createDb(url: string | DatabaseConfig, options: CreateDbOptions = {}): Db {
  const config = typeof url === 'string' ? parseDatabaseUrl(url) : url;
  const kysely =
    config.dialect === 'sqlite'
      ? new Kysely<Database>({
          dialect: new TransactionalSqliteDialect({ database: openSqlite(config.filename) }),
          plugins: [new SqliteBooleanPlugin()],
        })
      : new Kysely<Database>({
          dialect: new PostgresDialect({
            pool: new pg.Pool({
              connectionString: config.connectionString,
              max: options.poolSize ?? 10,
              types: { getTypeParser: getPgTypeParser as typeof pg.types.getTypeParser },
              // Keep timestamp text output in UTC so our parser only has to handle "+00".
              options: '-c TimeZone=UTC',
            }),
          }),
        });

  const listeners = new Set<() => void>();
  return {
    kysely,
    dialect: config.dialect,
    onCommit(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    notifyCommit() {
      for (const listener of listeners) {
        try {
          listener();
        } catch {
          // listeners must never break the writer
        }
      }
    },
    async listen(channel, onNotify) {
      if (config.dialect !== 'postgres') return async () => {};
      if (!/^[a-z_][a-z0-9_]*$/.test(channel)) throw new Error(`Invalid channel name "${channel}"`);
      const client = new pg.Client({ connectionString: config.connectionString });
      client.on('error', () => {}); // a dropped listener only delays wake-ups; polling still delivers
      await client.connect();
      client.on('notification', (msg) => {
        if (msg.channel === channel) onNotify();
      });
      await client.query(`LISTEN ${channel}`);
      return async () => {
        await client.end().catch(() => {});
      };
    },
    destroy: () => kysely.destroy(),
  };
}

/**
 * Opens a SQLite file with the pragmas every connection needs (ADR 0002):
 * WAL for concurrent readers, a busy timeout so writers from other processes (the CLI in local mode)
 * wait instead of failing, and foreign keys — which SQLite leaves OFF by default.
 */
function openSqlite(filename: string): BetterSqlite3.Database {
  const database = new BetterSqlite3(filename);
  if (filename !== ':memory:') database.pragma('journal_mode = WAL');
  database.pragma('busy_timeout = 5000');
  database.pragma('foreign_keys = ON');
  database.pragma('synchronous = NORMAL');
  return database;
}

/** SQLite supports transactional DDL; Kysely's adapter says otherwise, so migrations would run outside a transaction. */
class TransactionalSqliteAdapter extends SqliteAdapter {
  override get supportsTransactionalDdl(): boolean {
    return true;
  }
}

class TransactionalSqliteDialect extends SqliteDialect {
  override createAdapter(): DialectAdapter {
    return new TransactionalSqliteAdapter();
  }
}

// ---- Postgres type parsing: make values look exactly like what SQLite returns. ----

const PG_OID = {
  int8: 20,
  json: 114,
  date: 1082,
  timestamp: 1114,
  timestamptz: 1184,
  jsonb: 3802,
} as const;

const identity = (value: string) => value;

/** "2026-09-26 13:49:00.12+00" → "2026-09-26T13:49:00.120Z" (session TimeZone is UTC). */
export function pgTimestampToIso(value: string): string {
  let iso = value.replace(' ', 'T');
  if (/[+-]\d\d$/.test(iso)) iso += ':00';
  else if (!/(Z|[+-]\d\d:\d\d)$/.test(iso)) iso += 'Z';
  return new Date(iso).toISOString();
}

function getPgTypeParser(oid: number, format?: string): (value: string) => unknown {
  switch (oid) {
    case PG_OID.int8:
      return (value: string) => Number(value);
    case PG_OID.json:
    case PG_OID.jsonb:
    case PG_OID.date:
      return identity;
    case PG_OID.timestamp:
    case PG_OID.timestamptz:
      return pgTimestampToIso;
    default:
      return pg.types.getTypeParser(oid, format as 'text');
  }
}

export type { DatabaseConnection };
