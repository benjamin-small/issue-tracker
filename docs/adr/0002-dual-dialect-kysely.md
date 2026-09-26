# 0002. One Kysely codebase for SQLite and Postgres, with STRICT SQLite tables

- **Status:** Accepted
- **Date:** 2026-09-26

## Context

Development runs on SQLite, a zero-setup single file that the CLI can also open directly. Production runs on Postgres. ORMs that define schemas per dialect (Drizzle's `sqliteTable`/`pgTable`, Prisma's fixed `provider`) would force two schema definitions and two migration histories. The two engines also differ in ways that silently corrupt data if ignored:

- **Type affinity.** SQLite gives `timestamptz` or `jsonb` columns NUMERIC affinity, so the JSON text `"123"` is stored as the integer 123.
- **Driver parsing.** `pg` turns `date` into a local-midnight `Date`, truncates `timestamptz` to milliseconds through `Date`, and returns `int8` as a string.
- **Booleans.** better-sqlite3 cannot bind JavaScript booleans.
- **Collation.** Postgres sorts text with the locale collation, which breaks byte-ordered fractional-index ranks.
- **Case sensitivity.** `LIKE` is case-insensitive in SQLite (ASCII only) and case-sensitive in Postgres.
- **Transactional DDL.** Kysely's SQLite adapter reports no transactional DDL, so a failed migration would leave a half-applied schema.

## Decision

- **One schema and query layer.** Kysely 0.29 with a single `Database` type (`packages/db/src/types.ts`) and one migration history, written with the portable column helpers `columnTypes(dialect)`: `ts`, `json`, `bool`, `date`, `real`, `bytewiseText`. `createTable()` adds `STRICT` on SQLite so declared types are enforced.
- **Canonical value forms**, identical on both dialects:

  | Value      | Form                                                            |
  | ---------- | --------------------------------------------------------------- |
  | Timestamps | ISO-8601 UTC strings with ms precision (`timestamptz(3)` on PG) |
  | Dates      | `YYYY-MM-DD` strings                                            |
  | JSON       | text: written with `toJson`, parsed with `fromJson`             |
  | Booleans   | written as JS booleans; read back and normalized with `toBool`  |
  - Postgres connections set `TimeZone=UTC` and custom type parsers for timestamptz, date, json/jsonb and int8.
  - SQLite gets the `SqliteBooleanPlugin`, which rewrites boolean parameters to 1/0.

- **Application-generated timestamps.** Timestamps come from the application clock, never from database defaults.
- **Byte-wise rank ordering.** `rank` columns use `bytewiseText` (`COLLATE "C"` on Postgres).
- **Portable case-insensitive search.** Search uses `lower(col) like lower(?) escape '\'` together with `likeContains()`.
- **Transactional SQLite migrations.** A subclassed SQLite adapter declares transactional DDL, so migrations run in a transaction.
- **Per-connection SQLite pragmas:** `journal_mode=WAL`, `busy_timeout=5000`, `foreign_keys=ON`, `synchronous=NORMAL`.
- **Migrations registered in code** (`migrate.ts`), not discovered from disk, so they survive bundling.

## Consequences

- Every database test suite runs against both dialects (`TEST_DB=sqlite|postgres`). CI does this with a matrix.
- Dialect-specific features need a helper that branches on `db.dialect`, and a test on both dialects. This covers full-text search, `SKIP LOCKED` and `LISTEN/NOTIFY`.
- **Known limitation:** SQLite's `lower()` folds ASCII only, so case-insensitive search is ASCII-only on SQLite until full-text search is added.
- **Known limitation:** SQLite WAL mode does not work on network filesystems.
