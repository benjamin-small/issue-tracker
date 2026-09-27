# tracker

A custom issue tracker built for teams where **humans and AI agents work side by side**:

- **An extensible domain model.** Projects, issues, comments, typed links, sub-issues, labels, custom fields, attachments and saved views sit on top of an append-only event log.
- **A typesafe, documented API.** Zod schemas are the single source of truth, and the committed OpenAPI 3.1 contract is generated from them.
- **An agent-grade CLI (`tracker`).** It has stable JSON output, documented exit codes and never prompts, and it can describe its own commands (`tracker commands --json`).
- **SQLite for development, Postgres for production**, from one codebase. Every test suite runs against both.
- **A Svelte web UI** with a list view and a kanban board with customizable cards.

It also has live updates (SSE), webhooks, file attachments (local disk or S3), and a single Docker image for production.

> **Status:** v1 feature-complete. See the [roadmap](#roadmap).

## Run it locally

Tested on macOS and Linux.

### 1. Prerequisites

- **Node 22**, the version in `.nvmrc`. With nvm, run `nvm install && nvm use`. Newer Node majors may have no prebuilt `better-sqlite3` binary, and the install then fails unless it can compile one.
- **pnpm 10**. `corepack enable` picks up the version pinned in `package.json`.
- **Docker** (optional). You need it for the Postgres test run when Postgres isn't installed locally, and for the production-shaped stack.

```sh
pnpm install
```

### 2. Develop: API + web UI on SQLite

```sh
pnpm dev
```

- The web UI is at http://127.0.0.1:5173. Vite moves to the next free port if 5173 is taken and prints the URL it chose.
- The API is on `:3000`, with its reference at http://127.0.0.1:3000/api/docs.
- On first start the database (`data/dev.db`) is created, migrated and seeded with demo users (`ada` is an admin, `grace` a member, `claude` an agent) and an `ENG` project.
- Dev auth mode lets you sign in as any demo user with one click.
- To start over, stop the server and delete `data/`.
- Settings come from the environment, or from a `.env` file at the repo root (copy `.env.example`), which `pnpm dev` loads.

To develop against Postgres instead:

```sh
pnpm pg start                                        # throwaway local Postgres (local binaries, else Docker)
TRACKER_DATABASE_URL=$(pnpm -s pg url) pnpm dev
```

### 3. Use the CLI

Local mode needs no server. It runs the API in-process on the same `data/dev.db` that `pnpm dev` uses:

```sh
pnpm tracker db migrate && pnpm tracker db seed      # not needed if `pnpm dev` has already run
pnpm tracker issue list -P ENG
pnpm tracker commands --json                         # the full command surface, for agents
```

### 4. Test

```sh
pnpm check           # typecheck + lint + format check + tests on SQLite (run before every commit)
pnpm pg start && pnpm test:pg                        # the same tests on Postgres
pnpm --filter @tracker/web exec playwright install chromium   # once, for the browser tests
pnpm e2e             # build the web app, run Playwright against the real server (SQLite)
E2E_DATABASE_URL=$(pnpm -s pg url) pnpm e2e          # ...and on Postgres
pnpm pg stop
```

CI runs all of this on every pull request, plus the S3 attachment tests and a Docker smoke test.

### 5. Run the production-shaped stack

This runs Postgres, S3-compatible storage (SeaweedFS) and the tracker image, built from this checkout, on http://localhost:3000:

```sh
docker compose up -d --build --wait tracker
docker compose exec tracker tracker db bootstrap --handle you --name "Your Name"   # prints an API token
```

Sign in at http://localhost:3000 with the printed token. Production auth has no demo users. Stop the stack with `docker compose down`, or add `-v` to delete its data too. See [deployment.md](docs/deployment.md) for configuration.

### Browser demo

```sh
pnpm build:demo      # apps/web/build-demo/: web app, API and SQLite all run in the page; any static host serves it
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
