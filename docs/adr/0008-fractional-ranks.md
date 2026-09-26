# 0008. Fractional-index ranks with server-computed moves

- **Status:** Accepted
- **Date:** 2026-09-26

## Context

Kanban columns need a manual order that survives concurrent edits, without renumbering whole columns on every drag.

## Decision

- **Ranks.** Issues carry a `rank` string from the `fractional-indexing` library. Ranks compare byte-wise: the column is `COLLATE "C"` on Postgres, and SQLite uses the default BINARY collation. Ties are broken by `id`.
- **Clients never compute ranks.** `POST /issues/{id}/move` takes `afterId` / `beforeId` / `position` (plus an optional target status), and the server generates a key between the neighbours. That keeps agents and UIs simple and keeps the ranking scheme private.
- **Rebalancing.** If two neighbours ever share a rank, the column is rebalanced inside the same write transaction.
- **New issues go to the top** of their status column.

## Consequences

- A move touches one row, occasionally a whole column.
- The web client may compute a _provisional_ rank for an optimistic UI update. The server's value wins when the event arrives.
