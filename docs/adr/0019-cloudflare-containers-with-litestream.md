# 0019. Cloudflare Containers with Litestream for issues.poietic.tech

- **Status:** Accepted
- **Date:** 2026-10-07

## Context

The tracker is hosted at issues.poietic.tech, a domain served entirely by Cloudflare Workers that OpenTofu creates
in benjamin-small/poietic-dot-tech. It is a long-running Node process with a native SQLite driver and SSE streams.
Containers have no persistent disk, Cloudflare offers no hosted Postgres, and D1 lacks interactive transactions.

## Decision

- Run the unchanged tracker image on Cloudflare Containers behind a Worker (`deploy/cloudflare`), as one instance
  (Durable Object id `main`, `max_instances: 1`).
- Keep the database as SQLite on the container disk, replicated by Litestream 0.5 to the R2 bucket
  `poietic-issues-db`. It is restored on a fresh disk and synced on SIGTERM. Attachments go to R2 over the S3 API.
- New dependencies: `wrangler`, `@cloudflare/containers` and `@cloudflare/workers-types` (deploy package only), and
  the Litestream binary pinned by version and SHA-256 in the image.
- Deploy from this repository's CI after CI passes on `main`.

## Consequences

- All infrastructure stays on Cloudflare, and the tracker code needs no changes.
- A crash (not a clean stop) can lose the last second or so of writes. A cold start restores before serving.
  Webhooks are delivered only while the container is awake.
- Exactly one writer: never raise `max_instances` or use more than one Durable Object id while on SQLite.
- Escape hatches: point `TRACKER_DATABASE_URL` at a Postgres (Neon etc.) and drop Litestream. Or port the server to
  Workers with Durable Object SQLite, which removes the container.
