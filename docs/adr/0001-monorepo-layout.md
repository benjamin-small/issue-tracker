# 0001. pnpm monorepo with source-exported internal packages

- **Status:** Accepted
- **Date:** 2026-09-26

## Context

The tracker has three consumers of one domain: an HTTP API, an agent-facing CLI and a Svelte web app. They must share types end to end, and the API must stay the single place business rules run. Build orchestration (project references, per-package `dist/` builds, watch modes) adds friction that a small team does not need yet.

## Decision

- **One TypeScript pnpm workspace** with `packages/*` (libraries) and `apps/*` (deployables):
  - `schema` holds isomorphic Zod schemas.
  - `db` holds the Kysely dialect layer.
  - `core` holds the domain services.
  - `client` holds the generated API client.
  - `server`, `cli` and `web` are the deployables.
- **Internal packages export their TypeScript sources** (`"exports": { ".": "./src/index.ts" }`) and are not built. Consumers compile them: Vite for the web app, tsx or Node type stripping for the server and CLI, and tsdown for production bundles.
- **Relative imports use explicit `.ts` extensions** (`allowImportingTsExtensions`), and code uses only erasable TypeScript syntax (`erasableSyntaxOnly`), so the sources also run under Node's native type stripping.
- **The dependency direction is fixed:** `schema` ← `db` ← `core` ← `server` ← `cli`, and `schema` ← `client` ← `cli` / `web`. The web app must never depend on `db`, `core` or `server`.

## Consequences

- There's no build step or stale `dist/` during development, and go-to-definition lands in source.
- Every package is type-checked by its own `tsc -p .`. Vitest runs each package as a project from the root config.
- Publishing a package to npm later would need a build step for that package. That's acceptable, since all packages are private today.
