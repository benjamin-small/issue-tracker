# Development

## Toolchain

- **Node 22.12+** (see `.nvmrc`) and **pnpm 10** (`corepack enable` picks up the version pinned in `package.json`).
- **TypeScript is pinned to 6.0.x.** TypeScript 7 exists, but SvelteKit and typescript-eslint don't support it yet.
- pnpm 10 blocks dependency install scripts by default. Native modules that need a build step (`better-sqlite3`, `esbuild`) are allowlisted in `pnpm-workspace.yaml` under `onlyBuiltDependencies`.

## Quality gates

`pnpm check` runs, in order:

1. `pnpm typecheck`: `tsc` per package
2. `pnpm lint`: ESLint flat config, zero warnings allowed
3. `pnpm format:check`: Prettier
4. `pnpm test`: Vitest across all workspace projects

CI (`.github/workflows/ci.yml`) runs the same gates and runs the tests twice, with `TEST_DB=sqlite` and with `TEST_DB=postgres` (a `postgres:16` service container).

## Databases

Development uses SQLite; production uses Postgres. The `TRACKER_DATABASE_URL` scheme selects the dialect (see `.env.example`).

### Local Postgres without Docker

`scripts/pg.sh` (also available as `pnpm pg …`) manages a throwaway cluster:

```sh
pnpm pg start    # initdb on first run, start, create database `tracker`, print the URL
pnpm pg status
pnpm pg reset    # wipe and recreate
pnpm pg stop
```

Details:

- Data lives in `/var/tmp/tracker-pg` and the cluster listens on `127.0.0.1:54329`. Override these with `TRACKER_PG_DIR` and `TRACKER_PG_PORT`.
- Auth is `trust` for the `tracker` user, and `fsync` is off. It's fast and **not durable**; it's for tests only.
- When run as root, the script uses `runuser -u postgres`, because `initdb` refuses to run as root.
- It finds the server binaries on `PATH` or under `/usr/lib/postgresql/*/bin`.

To run the suites against it:

```sh
TEST_DATABASE_URL=$(pnpm -s pg url) pnpm test:pg
```

## Claude Code on the web

`.claude/hooks/session-start.sh` runs when a cloud session starts. It installs dependencies and starts the local Postgres cluster, so agents can run `pnpm check` and `pnpm test:pg` immediately.
