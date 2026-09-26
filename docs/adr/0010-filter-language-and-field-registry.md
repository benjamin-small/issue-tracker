# 0010. `IssueFilter` and the field registry are the extension spine

- **Status:** Accepted
- **Date:** 2026-09-26

## Context

The same questions ("which issues?", "which fields, in what order?") are asked everywhere:

- saved views
- list query parameters
- `POST /issues/search`
- the CLI
- board cards and list columns
- client-side live updates, which must decide whether a changed issue still belongs in a cached list

Implementing each separately guarantees drift.

## Decision

- **The field registry.** `packages/schema/src/fields.ts` holds one isomorphic descriptor per field: key, label, type, sortable, groupable, allowed filter operators, displayable, and a value accessor. Custom fields register as `cf:<key>`. The UI, CLI and API all read from it.
- **`IssueFilter`.** `packages/schema/src/filter.ts` defines it: an AND of `{ field, op, value }` conditions, where `in` gives OR within a field.
  - `normalizeFilter` validates conditions and coerces values.
  - `matchesFilter` evaluates in JavaScript.
  - `compileFilter` (core) emits portable SQL with _identical_ null and set semantics.
- **Sort keys.** `sortKey` / `compareIssues` define sort order, and the SQL `sortExpression` must match them. Nulls sort last, and "no priority" sorts after "low".
- **Parity is tested.** A property test (`filter-parity.test.ts`) runs hundreds of random filters and sorts against both dialects and asserts SQL equals JavaScript.

## Consequences

- A new core field is added once in the registry, its SQL column is mapped in `compileFilter`/`sortExpression`, and the parity test covers it.
- v1 has no OR across fields. The AST can grow `{ or: [...] }` later without breaking stored views.
- Text matching is ASCII case-insensitive on both sides, to match SQLite's `lower()`.
