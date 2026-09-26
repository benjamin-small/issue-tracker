# 0004. The events table is the bus and the outbox

- **Status:** Accepted
- **Date:** 2026-09-26

## Context

Several consumers need to learn about changes:

- the activity history in the UI
- live updates (SSE)
- webhooks
- agents polling for "what changed since X"

Writers are not limited to one process. The CLI in local mode writes straight to the SQLite file, and production may run several server replicas. An in-memory event emitter would miss every write it didn't see happen.

## Decision

- **Every mutation records an event in the same transaction.** The service calls `recordEvent(tx, ctx, type, …)` inside `withWriteTx`, appending a row to `events`. The event commits if and only if the change commits.
- **Consumers read events, not in-process notifications.** Their cursor is the event's `seq`:
  - the activity endpoint
  - `GET /events?after=`
  - the SSE tailer
  - the webhook dispatcher
- **In-process notifications are only wake-up hints.** `Db.onCommit` and, later, Postgres `NOTIFY` just tell a tailer to poll sooner.
- **Payloads are self-contained.** `data` holds the full resource snapshot after the change (for example the complete `Issue`), plus `changes: { field: { from, to } }` for updates, plus the originating `requestId`. Consumers never need to refetch, and the web client uses `requestId` to ignore echoes of its own writes.

## Consequences

- **Ordering relies on ADR 0003.** `seq` only increases in commit order; that is what makes `after=<seq>` cursors safe.
- **Link events are recorded once, against the source issue.** Activity queries also match the target issue's id inside the payload.
- **Snapshots make rows large.** At tracker scale that is fine. A retention or compaction policy can come later without changing consumers.
