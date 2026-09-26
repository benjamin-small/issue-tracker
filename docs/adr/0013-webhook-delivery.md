# 0013. Webhooks are delivered from the event log with durable, leased deliveries

- **Status:** Accepted
- **Date:** 2026-09-26

## Context

Webhooks must never miss an event, including events written by the CLI's local mode or other replicas. They must survive restarts, retry for hours, and must not hold database write locks while waiting on slow receivers. Receivers are arbitrary URLs, which makes the sender an SSRF risk.

## Decision

- **Fan-out.** A cursor in `system_state` walks the event log (ADR 0004). Under the write lock it creates one `webhook_deliveries` row per matching webhook and advances the cursor. There is no in-memory queue.
  - The unique `(webhook_id, event_seq)` constraint and the write lock make fan-out idempotent across replicas.
  - The cursor starts at the end of the log when the first webhook is registered, so history is never replayed.
- **Delivery.** Workers claim due rows with a short lease (`locked_until`) and send without a transaction, then record the outcome.
  - Claiming happens under `withWriteTx`, which already serializes writers on both dialects, so no `SKIP LOCKED` is needed.
  - Delivery is at least once. `webhook-id` (the delivery id) is stable for deduplication.
- **Retries.** After 1m, 5m, 30m, 2h and 12h the delivery is marked dead. Five consecutive dead deliveries disable the webhook.
- **Signing.** Signing follows Standard Webhooks (HMAC-SHA256, `whsec_` secrets), so receivers can use off-the-shelf verifiers. The OpenAPI 3.1 `webhooks` section documents the payload.
- **SSRF guard.** Outbound requests use `node:http(s)` with a custom DNS `lookup`. It rejects non-public addresses and pins the connection to the checked address. Redirects are not followed, and time and response size are capped. There is no new dependency.

## Consequences

- Webhook latency is the tailer's wake latency (usually well under a second), plus up to 5 seconds for retries.
- Ordering across deliveries is not guaranteed. Payloads carry `seq` for receivers that need it.
- The delivery log grows with traffic. Pruning old succeeded deliveries is a future maintenance task.
