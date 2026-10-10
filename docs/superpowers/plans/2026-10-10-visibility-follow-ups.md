# Project visibility follow-ups: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the deferred findings from the project-visibility reviews (PR #18): one privacy gap, stream robustness, small correctness and performance fixes, missing tests, web polish and docs.

**Architecture:** No new design. Each task changes existing code in place, following [ADR 0021](../../adr/0021-project-visibility-and-roles.md) and the access model in `packages/core/src/access.ts`.

**Tech Stack:** TypeScript, Kysely (SQLite and Postgres), Hono, Commander, SvelteKit 5 with TanStack Query, Vitest, Playwright.

**Spec:** [docs/superpowers/specs/2026-10-08-project-visibility-and-repos-design.md](../specs/2026-10-08-project-visibility-and-repos-design.md), with ADR 0021 and its recorded deviations.

## Global Constraints

- Business logic lives in `packages/core`. `packages/schema` stays isomorphic.
- Portable SQL only. Every database test passes under `TEST_DB=sqlite` and `TEST_DB=postgres`.
- Timestamps come from the injected clock.
- After an API change, run `pnpm openapi:gen`; after a CLI change, run `pnpm vitest run --project cli -u`. Commit the regenerated files.
- Web links go through `$lib/nav.ts`.
- `pnpm check` passes before every commit.
- Levels: `none < read < write < manage`.
- Errors:
  - unreadable → `NOT_FOUND`;
  - readable but not enough level → `FORBIDDEN`;
  - anonymous write → `UNAUTHENTICATED`.
- Don't weaken existing assertions. If one must change, list it with old → new.

## Decided as won't-fix (rulings)

- An expired session shows "not found" on a private project instead of redirecting to sign-in. The silent SSO attempt and the Sign in button cover it.
- Event payloads stored before #18 lack `Project.repos`. Stored events are never re-validated.
- `remove` commands in the CLI echo the input as `id` in JSON. This matches `link rm`.
- Link events whose end issue was permanently deleted stay hidden from non-admins. Failing closed is intended.
- A retry on a failed `/auth/config` delays the first paint a little. The cost is bounded.

---

### Task 1: Core and server hardening

**Files:** `packages/core/src/services/{comments,issues,attachments,members,projects,users,events,repos}.ts`, `packages/core/src/{access,refs,permissions,issue-query}.ts`, `apps/server/src/routes/stream.ts`, `apps/server/src/middleware/auth.ts`, and their tests.

- [ ] **Deleted content is not public.**
  - Reading soft-deleted rows requires `write` on the project. This covers:
    - `includeDeleted` on comments, issue listings/search and attachments;
    - a direct lookup of a trashed issue.
  - Readers without write never see trashed issues or deleted comments, including anonymous visitors on public projects.
  - Tests: anonymous and viewer don't get deleted content; editor and manager do.
- [ ] **Live stream robustness** (`routes/stream.ts`):
  - Cap each connection's pending queue at 1,000 events. On overflow, send the existing `reset` event and close the stream, so the client reconnects and replays.
  - Close the stream when a `user.updated` event names the viewer, so a deactivation or role change takes effect at once. The client reconnects with its new identity or as anonymous.
  - Log an access-read error before the stream closes, with `requestId` (use the server logger available in deps).
  - Remove the redundant replay `refresh(replay.data)`.
  - Remove the shutdown-signal listener in the `finally` block.
  - Tests for the cap and for close-on-`user.updated`.
- [ ] **Members:**
  - `addMember` maps a unique violation to `CONFLICT`: catch outside `withWriteTx` with `isUniqueViolation`, as `addRepo` does.
  - `updateMember` with an unchanged role writes nothing and records no event.
- [ ] **Performance:**
  - `listProjects` for non-admins computes every project's level from one membership query, not one `projectLevel` call per row.
  - Comments and attachments compute the project level once per call.
  - Unscoped `listIssues` computes `readableProjectIds` once and passes it to `resolveFilterRefs`.
  - Give `whereReadable` a precomputed `readable` and use it in the three places that duplicate the `in (…)` / `1 = 0` logic.
  - `updateIssueInTx` doesn't reload the project just to build an error message.
- [ ] **Small correctness fixes:**
  - Anonymous requests to admin-only routes (webhooks, deliveries) get 401, not 403: `requireAdmin` throws `UNAUTHENTICATED` for anonymous actors.
  - A `user.updated` event whose only change was the email is dropped for viewers who would see `changes: {}` after redaction.
  - Reuse `isAdmin` instead of the inline admin checks in `users.ts` and `events.ts`.
  - `readableProjectIds` stops building a dead query.
  - `webhooks.ts` `testWebhook` no longer casts `actor.kind`: narrow it properly.
- [ ] **`parseRepoRef` moves to `refs.ts`**, removing the `issue-query → services/repos → services/issues → issue-query` import cycle.
  - It accepts the scheme and host in any case (`HTTPS://GitHub.com/a/b`).
  - Owner and name keep their case.
  - Tests for the case forms.
- [ ] Run `pnpm check` and `pnpm test:pg`, then commit in scoped commits.

### Task 2: Tests the reviews asked for

**Files:** test files only, plus a shared table-driven access test, `packages/core/src/access-matrix.test.ts`.

- [ ] **Access matrix.**
  - **Actors:** admin, manager, editor, viewer, signed-in non-member, anonymous, deactivated user (a context for a deactivated user resolves as anonymous at the HTTP layer; in core, test the anonymous actor and a member whose membership was removed).
  - **Projects:** public and private.
  - **Operations:** read project, list issues, read issue, create issue, update issue, create comment, delete someone else's comment, create label, delete custom field, change visibility, add member, add repo, delete link.
  - Each cell asserts the exact error code, or success.
- [ ] **Gaps from the per-task reviews:**
  - `requireLevel`, every branch;
  - viewer and manager on a public project;
  - members:
    - a non-manager calling update or remove → FORBIDDEN;
    - a non-member on a private project → NOT_FOUND;
    - `previousRole` is in the event;
    - `myAccess` read/write cases;
    - an editor renaming the project → FORBIDDEN;
  - `addRepo` and `removeRepo` levels;
  - `deleteLabel` and `deleteStatus` FORBIDDEN, and `deleteComment` by a manager;
  - the "even for managers" personal-view case;
  - `repos.test`:
    - an unscoped filter against a private repo;
    - a garbage ref;
    - a repo linked to another project;
    - `repo: null` on update;
    - the event when a trashed issue's repo is cleared;
  - a test that `project_repos_unique` is case-insensitive;
  - `createProject` persists `visibility`;
  - the migration backfill skips `kind = 'system'` users.
- [ ] **Server and CLI:**
  - DELETE on repos and members by a non-manager → 403;
  - `me` as the `{user}` path parameter over HTTP;
  - CLI exit code 5 for a non-manager `members add`.
- [ ] **Test hygiene:**
  - the link test no longer hard-codes `PUB-2`;
  - the second member test in `access.test.ts` sets up its own state;
  - the stream test "follows membership changes" waits on events rather than timing;
  - the attachments test cleans up its `mkdtemp` directory;
  - `api.test.ts` moves its `grant` after the 201 assertion;
  - the `cli.test` repos assertion is exact.
- [ ] Run `pnpm check` and `pnpm test:pg`, then commit.

### Task 3: Web polish

**Files:** `apps/web/src/**` and `apps/web/e2e/*.spec.ts`.

- [ ] **Repo filter chip:**
  - add a "No repository" choice that emits `isNull`, or null in `in`;
  - turn `null` values from saved views or the CLI into that choice instead of a bogus `"null"` item;
  - fix the stale `FilterBar` comments.
- [ ] **Live access changes:** the live stream invalidates the project, projects and members queries on `project.member_*` and `project.updated`, so controls update when the viewer's role changes.
- [ ] **Signed out:**
  - the assignee filter chip offers people from the issues' embedded `assignee` summaries;
  - user-type custom field values render from embedded data when the user directory is unavailable, or show the id with an "Unknown user" label;
  - `/login` gets a "Continue without signing in" link back to where the visitor came from.
- [ ] **Error states:**
  - a project load failure other than 404 shows an error with retry, instead of an endless skeleton or a blank settings page;
  - the project-not-found state hides the view header, filter bar and issue count.
- [ ] **Settings:**
  - the self-role confirmation fires only on demotion below manager;
  - the visibility radios are disabled while saving;
  - the signed-out settings title matches its body;
  - unlinking a repo also invalidates cached issue details.
- [ ] **Links:** the Remove button shows when the viewer can write either end, matching the core rule.
- [ ] **Code:** `useProjectData.loaded` doesn't short-circuit.
- [ ] **Tests:**
  - an e2e test for group-by-repo, including an issue whose repo is unlinked;
  - a viewer e2e test checking that board drag and the settings link are absent;
  - the repo-clear e2e test verifies persistence after a reload;
  - fix the `IssueProperties` import order.
- [ ] Run `pnpm check`, `pnpm e2e` and `pnpm build:demo && pnpm e2e:demo`, then commit.

### Task 4: Docs

**Files:** `docs/security.md`, `docs/adr/0021-project-visibility-and-roles.md`, `docs/agents.md`, `docs/deployment.md`, `apps/server/src/routes/members.ts` (description), `apps/cli/src/commands/issues.ts` (help).

- [ ] **`security.md`:**
  - admin-configured webhooks receive events from every project, private ones included;
  - a stale or absent session cookie makes a request anonymous, while an invalid bearer token returns 401;
  - deleted content needs write access to read (from Task 1);
  - an open anonymous live stream keeps the Cloudflare container awake.
- [ ] **ADR 0021:**
  - the migration's single `new Date()` timestamp;
  - `/link-types` is global and anonymously readable;
  - live streams close on `user.updated` (from Task 1).
- [ ] **`agents.md`:** CLI remote mode without a token reads as anonymous.
- [ ] **Help text:**
  - the `{user}` path-parameter description mentions `me`;
  - `--repo` help mentions `null`.
- [ ] Run `pnpm openapi:gen` and `pnpm vitest run --project cli -u`, then `pnpm check`, then commit.
