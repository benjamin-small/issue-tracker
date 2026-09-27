# 0014. One bundled process per deployment, structured logs, graceful shutdown

- **Status:** Accepted
- **Date:** 2026-09-26

## Context

Inside the monorepo, packages export TypeScript source and Node runs it directly (ADR 0001). Node refuses to strip types inside `node_modules`, so the source can't be deployed as-is. Operators want one artifact to run, logs a collector can parse, and restarts that don't drop requests or live connections.

## Decision

- **Bundling.** `pnpm build` bundles `apps/server/src/main.ts` and the CLI with **tsdown** into `dist/server.mjs` and `dist/tracker.mjs`. Every workspace package and pure-JS dependency is inlined. Only native or optional modules stay external (`better-sqlite3`, `pg-native`).
- **Image.** The Docker image runs one process: API, SPA and webhook worker. There are no separate worker images; any replica can deliver webhooks (ADR 0013). The CLI is included for admin tasks.
- **Logging.** Logs use **pino**: JSON in production, and a small built-in pretty printer for terminals (no `pino-pretty` dependency). Embedded apps (tests, CLI local mode) use a silent logger by default.
- **Health probes.** `/healthz` is liveness. `/readyz` checks the database and fails during shutdown.
- **Shutdown.** Graceful shutdown ends SSE streams with a `shutdown` event (clients reconnect with `Last-Event-ID`) and drains requests up to a timeout. It then stops the webhook worker and tailer and closes the database.
- **Example stack.** The compose file uses **SeaweedFS** as its S3-compatible store, because the MinIO images are no longer published on Docker Hub. Any S3 service works.

## Consequences

- The runtime image needs no package manager or build tools, and the bundles start fast.
- Stack traces in production point into the bundle. Source maps ship next to it, and the image enables them (`NODE_OPTIONS=--enable-source-maps`).
- Bundling requires care with dynamic `require`s. New dependencies should be checked with `pnpm build` and the Docker smoke test in CI.
