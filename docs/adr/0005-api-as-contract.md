# 0005. The HTTP API is the contract; the CLI runs it in-process for local mode

- **Status:** Accepted
- **Date:** 2026-09-26

## Context

Three clients (web, CLI, agents) must behave identically. A CLI that talked to the database directly would duplicate validation, permissions and error mapping, and would drift from the API.

## Decision

- `createApp(deps)` builds the whole HTTP app without side effects, so opening a database is deferred.
- The CLI always speaks HTTP through `@tracker/client`:
  - **Remote mode:** real HTTP to `TRACKER_SERVER`, with a bearer token.
  - **Local mode:** the CLI builds the same app against `TRACKER_DATABASE_URL` and injects `fetch = app.fetch`. No socket is opened, and requests authenticate as a configured user through the `trusted` auth mode. That mode is only ever constructed in-process and is never mounted on a listening server.
- OpenAPI generation uses the same factory without a database.

## Consequences

- One code path serves every client, including error codes, ETags and idempotency.
- Local mode requires the database file to be migrated. The CLI refuses to run against an outdated schema.
- Events written in local mode reach live clients once a server tailing the same database picks them up (ADR 0004).
