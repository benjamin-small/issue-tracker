import { type CreateTableBuilder, type Kysely, type RawBuilder, sql } from 'kysely';
import type { Dialect } from '../dialect.ts';

/**
 * Portable column types (ADR 0002). Always use these in migrations instead of raw type names:
 * a type like `timestamptz` or `jsonb` on SQLite gets NUMERIC affinity and silently coerces values.
 */
export function columnTypes(dialect: Dialect) {
  const pg = dialect === 'postgres';
  return {
    id: 'text',
    text: 'text',
    int: 'integer',
    /** ISO-8601 UTC timestamp with millisecond precision. */
    ts: pg ? sql`timestamptz(3)` : 'text',
    /** JSON document. */
    json: pg ? 'jsonb' : 'text',
    bool: pg ? 'boolean' : 'integer',
    /** Calendar date `YYYY-MM-DD`. */
    date: pg ? 'date' : 'text',
    real: pg ? 'double precision' : 'real',
    /** Text compared byte-wise (fractional-index ranks). SQLite's default BINARY collation already is. */
    bytewiseText: pg ? sql`text collate "C"` : 'text',
  } as const satisfies Record<string, string | RawBuilder<unknown>>;
}

export type ColumnTypes = ReturnType<typeof columnTypes>;

/** Starts a CREATE TABLE that is STRICT on SQLite, so declared column types are enforced. */
export function createTable<T extends string>(
  db: Kysely<unknown>,
  dialect: Dialect,
  name: T,
): CreateTableBuilder<T, never> {
  const builder = db.schema.createTable(name);
  return dialect === 'sqlite' ? builder.modifyEnd(sql`strict`) : builder;
}
