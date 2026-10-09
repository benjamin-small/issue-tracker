# 0021. Project visibility and roles

- **Status:** Accepted
- **Date:** 2026-10-08

## Context

[ADR 0009](0009-auth-v1.md) left "every member can act on every project" and had no way to read the tracker without signing in. issues.poietic.tech needs two things: public projects that anyone can read, including visitors who are not signed in, and private projects visible only to the people who work on them. Agents are ordinary users, so they fall under the same rules.

## Decision

### Access levels and roles

Each actor has one level per project: `none < read < write < manage`. A member's role sets the level: `viewer` is `read`, `editor` is `write`, `manager` is `manage`.

| Actor                                  | Private project | Public project |
| -------------------------------------- | --------------- | -------------- |
| Global admin, `system` actor           | manage          | manage         |
| `manager` member                       | manage          | manage         |
| `editor` member                        | write           | write          |
| `viewer` member                        | read            | read           |
| Signed-in non-member                   | none            | read           |
| Anonymous, pending or deactivated user | none            | read           |

- `read` covers everything inside the project, including attachments, activity and the live stream.
- `write` covers the member actions that exist today. The ownership rules for comments and attachments stay.
- `manage` adds project settings (name, description, visibility), repo links and members.
- Managers also edit shared views and delete custom fields, and they moderate comments and attachments. Deleting a project's last shared view stays admin-only.
- Creating and archiving projects, permanent deletes, users, webhooks and other users' tokens stay with global admins.
- Admins always have `manage`, so there is no last-manager guard.
- New projects are `private`.

### Unreadable means not found

A project, issue or other resource the actor cannot read is reported as `NOT_FOUND` (404), with the same message as one that does not exist, so no project id leaks. A readable project without enough level returns `FORBIDDEN` (403). An anonymous write returns `UNAUTHENTICATED` (401).

### Enforcement lives in core

- The shared lookups in `packages/core` (`getProjectRow`, `getIssueRow`/`findIssue`) take a required level, so every call site states what it needs. Lookups by id (attachments, fields, labels, statuses, views, comments) resolve their project and check it the same way.
- Cross-project reads (issue search, `listProjects`, filter-name resolution, `GET /events`) are restricted to the projects the actor can read.
- Server routes, the CLI's local mode and the demo all call the same services, so none of them re-implements the rule.

### The anonymous actor

- `ANONYMOUS_ACTOR` has `kind: 'anonymous'` and keeps `role: 'member'`, so existing `role` checks stay sound. The stored user `kind` does not change.
- With no credentials the server builds its context with this actor, not `SYSTEM_ACTOR`.
- Anonymous requests are `GET` and `HEAD` only. Everything else needs sign-in and returns 401.
- `GET /me` returns `{ anonymous: true }` when signed out.
- `/users`, `/users/{user}` and the token endpoints need sign-in, and answer 401 before any lookup.
- Other users' emails are visible only to admins and to the user themself, including in `user.*` events.
- Link events, and links into projects the actor cannot read, are hidden. `/link-types` is global configuration and is readable anonymously.
- `GET /events/stream` applies the same per-viewer filtering as `GET /events`, and re-reads the actor's access when memberships or projects change. A connection's actor is fixed when it connects, so a demoted admin or deactivated user keeps their access on an already open stream until it reconnects.

### Migration 0004

- Adds `projects.visibility` (default `private`), `project_members`, `project_repos` and `issues.repo_id`.
- Backfills one `editor` membership for every existing project and every active, non-admin, non-`system` user, so nobody loses access on upgrade.
- Migrations have no injected clock, so the backfill stamps all its rows with one `new Date()` computed in `up`.

### Deviations from the design spec

1. **No per-request access cache.** `ServiceContext` objects are reused across calls (tests, the CLI, the demo), so a cache on the context would go stale when memberships change. Each check is one primary-key lookup, and cross-project reads use one subquery.
2. **`project_members` has a composite primary key `(project_id, user_id)` and no `pmb_` id.** `packages/db` does not depend on `packages/schema`, so a migration cannot generate TypeIDs, and the backfill must insert rows. The `pmb` prefix is dropped. `project_repos` keeps `rpo_` ids.
3. **The anonymous actor keeps `role: 'member'`** and gets `kind: 'anonymous'`. `requireActor` is narrowed rather than removed: anonymous requests are allowed only for `GET` and `HEAD`, and core decides visibility.
4. **Links into unreadable projects are omitted** from link lists and activity history, instead of being shown as an "inaccessible" marker. This leaks nothing and needs no change to `IssueLink`.
5. **`myAccess` is on a separate response schema, `ProjectWithAccess`** (`Project` plus `myAccess`). `Project` is also embedded in event payloads, which are not per viewer.

## Consequences

- Agent users need a membership on each private project they work in. Users created after the upgrade start with none, so an admin or manager adds them.
- Admins see and manage everything. Nobody else sees a private project, and a bad id and a hidden project look the same.
- The CLI in remote mode without a token reads as anonymous: private projects return not found, and `poietic-issues auth status` reports "Not signed in".
- The demo seed runs as the admin `ada` and adds memberships with the ordinary member service. `grace` and the `claude` agent edit the public `ENG` project, as the migration's backfill would make them. In the private `OPS` project, `margaret` manages, `grace` edits and `claude` only views, so every role can be tried.
- Permissions are checked per call with an extra lookup. If that shows up in profiles, add a cache that is invalidated by membership events, not one held on the context.
- Roles are per project and fixed to three. Teams, groups or finer permissions would need a new ADR.
