import { type Kysely, sql } from 'kysely';
import type { Db } from './dialect.ts';
import type { Database } from './types.ts';

/** A query executor bound to a write transaction. Same API as `Kysely<Database>`. */
export type Tx = Kysely<Database>;

/**
 * Arbitrary constant identifying the tracker's global write lock on Postgres
 * (`pg_advisory_xact_lock` key space is shared per database).
 */
export const WRITE_LOCK_KEY = 7_424_242;

/**
 * Runs `fn` inside a write transaction — the **only** way application code may write (ADR 0003).
 *
 * - **SQLite:** `BEGIN IMMEDIATE`, taking the write lock up front. A deferred transaction that later
 *   upgrades to a write fails with `SQLITE_BUSY` *without* honouring `busy_timeout` when another
 *   process (e.g. the CLI in local mode) wrote in between; an immediate transaction waits instead.
 * - **Postgres:** a regular transaction that first takes a transaction-scoped advisory lock, serializing
 *   writers. That makes `events.seq` values commit in order, so consumers reading `seq > cursor` never
 *   skip a row that commits late. Tracker write volume makes this cheap; see ADR 0003 for the escape hatch.
 *
 * After commit, {@link Db.onCommit} listeners fire. Never perform network or blob I/O inside `fn`.
 */
export async function withWriteTx<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const result =
    db.dialect === 'sqlite'
      ? await db.kysely.connection().execute(async (conn) => {
          await sql`begin immediate`.execute(conn);
          try {
            const value = await fn(conn);
            await sql`commit`.execute(conn);
            return value;
          } catch (error) {
            await sql`rollback`.execute(conn);
            throw error;
          }
        })
      : await db.kysely.transaction().execute(async (trx) => {
          await sql`select pg_advisory_xact_lock(${WRITE_LOCK_KEY})`.execute(trx);
          return fn(trx);
        });
  db.notifyCommit();
  return result;
}
