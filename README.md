# tracker

A custom issue tracker built for teams where **humans and AI agents work side by side**:

- **An extensible domain model.** Projects, issues, comments, typed links, sub-issues, labels, custom fields, attachments and saved views sit on top of an append-only event log.
- **A typesafe, documented API.** Zod schemas are the single source of truth, and the committed OpenAPI 3.1 contract is generated from them.
- **An agent-grade CLI (`tracker`).** It has stable JSON output, documented exit codes and never prompts, and it can describe its own commands (`tracker commands --json`).
- **SQLite for development, Postgres for production**, from one codebase. Every test suite runs against both.
- **A Svelte web UI** with a list view and a kanban board with customizable cards.

It also has live updates (SSE), webhooks, file attachments (local disk or S3), and a single Docker image for production.

> **Status:** v1 feature-complete. See the [roadmap](#roadmap).

## Quickstart

Requirements: Node 22.12+ and pnpm 10 (`corepack enable`).

```sh
pnpm install
pnpm check          # typecheck + lint + format check + tests (SQLite)
```

To run the test suites against Postgres as well:

```sh
pnpm pg start       # throwaway local cluster (no Docker), prints its URL
pnpm test:pg
```

Run the app (API server + web UI; SQLite, auto-migrated and seeded with demo users on first start):

```sh
pnpm dev            # web UI at http://127.0.0.1:5173 (sign in as a demo user), API docs at :3000/api/docs
pnpm e2e            # build the web app and run the Playwright suite against the real server
```

Use the CLI (local mode needs no server — it runs the API in-process on the same SQLite file):

```sh
pnpm tracker db migrate && pnpm tracker db seed
pnpm tracker issue list -P ENG
pnpm tracker commands --json      # the full command surface, for agents
```

Or build the self-contained browser demo, where the web app, API and SQLite all run in the page and any static host can serve it:

```sh
pnpm build:demo     # apps/web/build-demo/
```

Run it in production shape (Postgres + S3-compatible storage) with Docker:

```sh
docker compose up -d --build --wait tracker
docker compose exec tracker tracker db bootstrap --handle you --name "Your Name"   # prints an API token
```

## Documentation

| Topic                          | Guide                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| How the pieces fit             | [architecture.md](docs/architecture.md), [data-model.md](docs/data-model.md), [decision records](docs/adr/)   |
| HTTP API                       | [api.md](docs/api.md), with the full contract in [openapi.json](docs/openapi.json) (browsable at `/api/docs`) |
| CLI                            | [cli.md](docs/cli.md), [cli-reference.md](docs/cli-reference.md)                                              |
| Agents                         | [agents.md](docs/agents.md)                                                                                   |
| Events, live updates, webhooks | [events.md](docs/events.md)                                                                                   |
| Running it                     | [deployment.md](docs/deployment.md), [security.md](docs/security.md)                                          |
| Working on it                  | [development.md](docs/development.md), [extending.md](docs/extending.md), [AGENTS.md](AGENTS.md)              |

## Repository layout

| Path              | Purpose                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------- |
| `packages/schema` | Isomorphic Zod schemas and types shared by server, CLI and web                           |
| `packages/db`     | Kysely database layer: dialect factory (SQLite/Postgres), migrations, write transactions |
| `packages/core`   | Transport-agnostic domain services; all business rules live here                         |
| `packages/client` | Typed API client generated from the OpenAPI document                                     |
| `apps/server`     | Hono HTTP API (`/api/v1`), SSE, OpenAPI docs; serves the web app in production           |
| `apps/cli`        | The `tracker` CLI, which talks to a server or runs in-process against a local database   |
| `apps/web`        | SvelteKit single-page app (served by the API server in production)                       |
| `docs/`           | Architecture, API/CLI guides, and [architecture decision records](docs/adr/)             |

## Roadmap

| Milestone | Scope                                                                                        | Status  |
| --------- | -------------------------------------------------------------------------------------------- | ------- |
| M0        | Workspace scaffold, tooling, CI, local Postgres, docs skeleton                               | ✅ done |
| M1        | Database layer: dual-dialect factory, migrations, `withWriteTx`, test harness                | ✅ done |
| M2        | Domain schemas and core services: issues, comments, links, labels, statuses, events, filters | ✅ done |
| M3        | HTTP API, auth (actors + tokens), OpenAPI 3.1 contract, Scalar docs                          | ✅ done |
| M4        | Generated client and the `tracker` CLI                                                       | ✅ done |
| M5        | Web UI: shell, list view, issue detail, comments, links                                      | ✅ done |
| M6        | Kanban board, customizable cards, saved views                                                | ✅ done |
| M7        | Live updates (event tailer, SSE)                                                             | ✅ done |
| M8        | Custom fields                                                                                | ✅ done |
| M9        | File attachments (local disk or S3), paste/drop upload                                       | ✅ done |
| M10       | Webhooks: signed deliveries, retries, SSRF guard, CLI and web management                     | ✅ done |
| M11       | Production hardening: bundles, Docker/compose, logs, graceful shutdown, Postgres e2e, docs   | ✅ done |
