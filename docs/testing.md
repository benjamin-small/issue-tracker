# Testing

## Measured coverage

On October 1, 2026, code revision `785bc32` measured **82.82% line coverage**
(3,154 of 3,808 lines), **80.03% statement coverage**, **70.32% branch coverage**,
and **79.69% function coverage** using Node 22.23.3, Vitest 5.0.2, and
`@vitest/coverage-v8` 5.0.2 on macOS. All 16 test files passed: 124 tests passed
and one was skipped. This run used SQLite.

The measurement includes TypeScript source under `packages/*/src`,
`apps/server/src`, and `apps/cli/src`, including untested source files. It
excludes test files, `testing.ts` helpers, and generated code. It does not
measure the Svelte web app, browser demo, build scripts, Postgres-specific
execution, or browser end-to-end coverage. It is not a whole-product coverage
percentage.

The repository does not currently declare a coverage provider dependency.
For this measurement, the matching V8 provider was installed in a temporary
tooling directory and linked into the ignored `node_modules/@vitest` directory;
the manifests and lockfile were unchanged. With that provider available to
Vitest, reproduce the measurement using:

```sh
pnpm vitest run --coverage --coverage.provider=v8 \
  --coverage.reporter=text --coverage.reporter=json-summary \
  '--coverage.include=packages/*/src/**/*.ts' \
  '--coverage.include=apps/server/src/**/*.ts' \
  '--coverage.include=apps/cli/src/**/*.ts' \
  '--coverage.exclude=**/*.test.ts' \
  '--coverage.exclude=**/testing.ts' \
  '--coverage.exclude=**/generated/**'
```

## Test scope

The Vitest projects cover schema IDs and filters, database URL handling and
storage, domain services, filter parity, custom fields, attachments, webhooks,
event tailing, HTTP API behavior, server configuration, streaming, and CLI
behavior. Tests live beside the source as `*.test.ts`; the workspace project
selection is defined in `vitest.config.ts`.

Run the required pre-commit checks with `pnpm check`. This runs typechecking,
linting, formatting checks, and the SQLite test suite. Database changes also
need the Postgres suite (`pnpm pg start`, then `pnpm test:pg`).

The separate Playwright suites cover the real web app and browser demo.
See [development.md](development.md) for browser, Postgres, S3, and Docker
validation instructions. Those checks were not part of the coverage figure
above, and passing the SQLite suite does not establish their results.
