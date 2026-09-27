# 0015. A self-contained browser demo built from the real code

- **Status:** Accepted
- **Date:** 2026-09-27

## Context

People want to try the tracker without running a server, for example from a link in chat. A mock API would drift from the real behaviour. The code is mostly portable already: Hono runs on web `fetch`, Kysely supports SQLite, and the core services depend on nothing Node-specific except a few helpers.

## Decision

- **The same code, in the page.** A demo build of the web app (`pnpm build:demo`) also bundles `createApp` from `@tracker/server`, the core services and the migrations, running on SQLite compiled to JavaScript (sql.js, asm.js build, so no WebAssembly policy is needed). A `better-sqlite3`-shaped shim lets the existing Kysely dialect run unchanged.
- **Node-only modules are aliased** in the demo build only (`apps/web/vite.config.ts`, `src/demo/shims/`):
  - `node:crypto` is implemented with `@noble/hashes` and Web Crypto.
  - `Buffer` comes from the `buffer` package.
  - Files, sockets and Postgres get stubs that throw if called.
- **Requests.** `fetch` and `EventSource` calls to `/api` are answered in-page. Pages can't set cookies on such requests, so each demo user gets an app in the existing trusted-actor auth mode, the same one the CLI's local mode uses.
- **Routing.** The demo uses SvelteKit's hash router, so it works from any URL. The web app builds every internal link through `$lib/nav.ts`, which serves both routers.

## Consequences

- The demo exercises the real API, validation, events, SSE and webhooks code. `pnpm e2e:demo` keeps it working in CI.
- New server code must stay browser-safe at module load: anything Node-only should run only inside functions, or be added to the demo aliases.
- The demo is not a deployment: its data lives in one browser's storage, and webhooks go to a pretend receiver.
