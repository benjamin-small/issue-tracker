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
- Single writer during rollouts: a deploy must stop the old container (and let Litestream's final sync finish)
  before the new one restores. Verified live on 2026-10-07 (plan Task 6, Step 5a): Deploy run 37681019282
  (`workflow_dispatch`, same commit 1d4737a) built a new image digest, because builds aren't reproducible, so
  Wrangler rolled the container application from v1 to v2 (rollout 33ae8f42…, `rolling`, `full_auto`). The old
  instance's Litestream logged `litestream shut down` at 20:20:37.672Z. The new instance started (`VMStarted`) at
  20:20:41.148Z, logged `attempting restore before replication` at 20:20:41.886Z and `restore completed` at
  20:20:46.555Z, and caught up to the latest replica txid (0x0a). The order is stop-then-start, so no lease guard
  is needed. Re-check this if `max_instances`, the rollout policy or the scheduling policy changes. If it ever stops
  holding, the fallback is the spec's lease guard: the Worker holds a lease in Durable Object storage that the
  entrypoint checks before restoring.
- Sleep and wake restore from the replica: on 2026-10-07 the container slept at 18:57:04Z (`litestream shut down`)
  and woke at 19:49:22Z with `restore completed` and no migrations to run.
- Restore fails closed: if the replica cannot be read (bad credentials, endpoint down), the container exits instead
  of starting an empty database. Only a reachable, empty replica counts as a first boot.
- Escape hatches: point `TRACKER_DATABASE_URL` at a Postgres (Neon etc.) and drop Litestream. Or port the server to
  Workers with Durable Object SQLite, which removes the container.
