# 0006. TypeID identifiers plus immutable human issue keys

- **Status:** Accepted
- **Date:** 2026-09-26

## Context

Agents and humans both handle identifiers. Bare UUIDs are easy to mix up across entity types, and humans want short references like `ENG-42`.

## Decision

- **Every entity id is a TypeID:** `<prefix>_<base32 UUIDv7>`, e.g. `iss_01h455vb4pex5vsknk084sn02q`.
  - Prefixes are fixed per entity in `packages/schema/src/ids.ts` and never change.
  - UUIDv7 makes ids time-ordered, which suits keyset pagination tie-breaks.
- **Issues also get a human key** `<PROJECT>-<number>`. Numbers come from a per-project counter incremented inside the write transaction. Project keys are **immutable**, so a key is valid forever.
- **Every API parameter, CLI argument and filter value accepts either form:**
  - issues: `iss_…` or `ENG-42`
  - projects: `prj_…` or `ENG`
  - users: `usr_…`, `handle`, `@handle` or `me`
  - statuses and labels (within a project): id or name

## Consequences

- Ids are self-describing in logs, JSON and agent transcripts.
- Renaming a project's key is not supported. If it is ever needed, it requires a key-alias table so old keys keep resolving.
