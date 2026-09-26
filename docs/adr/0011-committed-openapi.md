# 0011. The OpenAPI document is generated from code and committed

- **Status:** Accepted
- **Date:** 2026-09-26

## Context

The API must be well documented and typesafe for clients in any language. Hand-written specs drift from the code, and generated-only specs make contract changes invisible in review.

## Decision

- Routes are declared with `@hono/zod-openapi` using the isomorphic Zod schemas from `@tracker/schema`, where `.meta({ id })` names each component. Request validation and documentation come from the same object.
- `pnpm openapi:gen` writes `docs/openapi.json`, an OpenAPI 3.1 document, from the app factory without a database. `pnpm openapi:check` fails if the file is stale, and runs in CI.
- `@tracker/client` generates TypeScript types from the committed document, so the web app and CLI compile against exactly what the server serves.

## Consequences

- Every API change shows up as a diff to `docs/openapi.json` in review.
- **Known limitation:** Zod schemas with defaults are documented with their _input_ shape, where defaulted fields are optional, even when used in responses. Response objects always include those fields.
