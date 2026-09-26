# 0003. All writes go through `withWriteTx`: SQLite `BEGIN IMMEDIATE`, Postgres advisory lock

- **Status:** Accepted
- **Date:** 2026-09-26

## Context

Two problems need a single answer.

1. **Several processes write to one SQLite file.** The server and the CLI in local mode can both write to the same file. A deferred SQLite transaction that reads first and then writes fails immediately with `SQLITE_BUSY` if another connection wrote in the meantime, and `busy_timeout` does not help in that case.
2. **Event sequence numbers must commit in order.** The `events` table is the event bus (ADR 0004), and consumers read `WHERE seq > cursor`. On Postgres, identity values are assigned at insert time, not commit time. So seq 11 can commit before seq 10, and a consumer that has seen 11 would skip 10 forever.

## Decision

`withWriteTx(db, fn)` in `packages/db/src/tx.ts` is the only way application code writes:

- **SQLite:** `BEGIN IMMEDIATE`, which takes the write lock up front. A writer in another process waits up to `busy_timeout` instead of failing.
- **Postgres:** a normal transaction that first calls `pg_advisory_xact_lock(WRITE_LOCK_KEY)`, serializing all writers. Commit order then equals `seq` order.
- **After commit,** `Db.onCommit` listeners fire, so in-process consumers wake immediately.
- **No network or blob I/O inside the transaction.** It would hold the global write lock.

## Consequences

- **Throughput.** Writes are serialized on both dialects. An issue tracker's write volume (tens per second at the very most) is far below the point where this matters.
- **Verified by tests.** `packages/db/src/db.test.ts` checks multi-process correctness, including a negative control: the multi-process test fails with a plain `BEGIN`.
- **Escape hatch.** If Postgres write throughput ever matters, drop the global lock and gate event consumers on the transaction snapshot instead: only read events with `xid < pg_snapshot_xmin(pg_current_snapshot())`, storing `pg_current_xact_id()` on each event row.
