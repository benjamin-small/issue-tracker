# tracker

A custom issue tracker built for teams where **humans and AI agents work side by side**:

- **An extensible domain model.** Projects, issues, comments, typed links, sub-issues, labels, custom fields, attachments and saved views sit on top of an append-only event log.
- **A typesafe, documented API.** Zod schemas are the single source of truth, and the committed OpenAPI 3.1 contract is generated from them.
- **An agent-grade CLI (`tracker`).** It has stable JSON output, documented exit codes and never prompts, and it can describe its own commands (`tracker commands --json`).
- **SQLite for development, Postgres for production**, from one codebase. Every test suite runs against both.
- **A Svelte web UI** with a list view and a kanban board with customizable cards.

> **Status:** early bootstrap. See the [roadmap](#roadmap) for what exists today.

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

Run the API server (SQLite, auto-migrated, seeded with demo data and tokens on first start):

```sh
pnpm dev:server     # http://127.0.0.1:3000 — API reference at /api/docs
```

Use the CLI (local mode needs no server — it runs the API in-process on the same SQLite file):

```sh
pnpm tracker db migrate && pnpm tracker db seed
pnpm tracker issue list -P ENG
pnpm tracker commands --json      # the full command surface, for agents
```

See [docs/cli.md](docs/cli.md) and [docs/agents.md](docs/agents.md) for the CLI, [docs/development.md](docs/development.md) for details, [docs/api.md](docs/api.md) for API conventions
and [docs/architecture.md](docs/architecture.md) for how the pieces fit.

## Repository layout

| Path              | Purpose                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------- |
| `packages/schema` | Isomorphic Zod schemas and types shared by server, CLI and web                           |
| `packages/db`     | Kysely database layer: dialect factory (SQLite/Postgres), migrations, write transactions |
| `packages/core`   | Transport-agnostic domain services; all business rules live here                         |
| `packages/client` | Typed API client generated from the OpenAPI document                                     |
| `apps/server`     | Hono HTTP API (`/api/v1`), SSE, OpenAPI docs; serves the web app in production           |
| `apps/cli`        | The `tracker` CLI, which talks to a server or runs in-process against a local database   |
| `apps/web`        | SvelteKit single-page app (added in M5)                                                  |
| `docs/`           | Architecture, API/CLI guides, and [architecture decision records](docs/adr/)             |

## Roadmap

| Milestone | Scope                                                                                        | Status  |
| --------- | -------------------------------------------------------------------------------------------- | ------- |
| M0        | Workspace scaffold, tooling, CI, local Postgres, docs skeleton                               | ✅ done |
| M1        | Database layer: dual-dialect factory, migrations, `withWriteTx`, test harness                | ✅ done |
| M2        | Domain schemas and core services: issues, comments, links, labels, statuses, events, filters | ✅ done |
| M3        | HTTP API, auth (actors + tokens), OpenAPI 3.1 contract, Scalar docs                          | planned |
| M4        | Generated client and the `tracker` CLI                                                       | ✅ done |
| M5        | Web UI: shell, list view, issue detail, comments, links                                      | planned |
| M6        | Kanban board, customizable cards, saved views                                                | planned |
| M7        | Live updates (event tailer, SSE)                                                             | planned |
| M8–M10    | Custom fields, attachments, webhooks                                                         | planned |
| M11       | Production hardening: Docker, Postgres end-to-end, docs                                      | planned |
