# Project visibility, roles and GitHub repo links — design

- **Date:** 2026-10-08
- **Status:** Draft, awaiting review

## Goal

- A project can link to one or more GitHub repositories, and an issue can name one of its project's repositories.
- A project is either **public** or **private**.
  - Anyone can read a public project, including visitors who are not signed in.
  - A private project is visible only to its members and to global admins.
- Per-project roles (`viewer`, `editor`, `manager`) control who can read, write and manage each project, public or private.

## Decisions

| Question                          | Decision                                                                                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What a repo link does             | **Links only.** The tracker stores `owner/name`, displays it, links to GitHub and lets issues filter by it. It never calls GitHub.                                                          |
| Repos per issue                   | At most one, chosen from the issue's project's repos.                                                                                                                                       |
| Project roles                     | `viewer` (read), `editor` (write), `manager` (write plus project settings, repos, members, moderation).                                                                                     |
| Global admins                     | Implicitly `manage` every project. They have no membership rows.                                                                                                                            |
| Writing to public projects        | Needs `editor` or above, as on private projects. Being public only adds read access for everyone else.                                                                                      |
| Hiding private projects           | A project the actor cannot read is reported as **404 Not Found**, the same as an unknown project.                                                                                           |
| Defaults                          | New projects are `private`. The migration keeps existing projects `private` and makes every active non-admin user an `editor` of every existing project, so nobody loses access on upgrade. |
| Where access is enforced          | **In `packages/core`**, at the shared reference lookups and in cross-project queries. Not in HTTP routes and not in the database.                                                           |
| Who creates and archives projects | Global admins only, as today.                                                                                                                                                               |

Rejected:

- **Route-level checks in the server:** breaks the rule that business logic lives in core, skips the CLI's local mode, and spreads one rule across about 40 handlers.
- **Postgres row-level security:** SQLite has no equivalent, which breaks the portable-SQL rule.
- **A GitHub App or webhooks:** valuable later, but it needs secrets, webhook delivery and its own ADR. Repo links are the foundation it would build on.

## 1. Data model

Migration `0004_project_access.ts` in `packages/db/src/migrations/`, registered in `migrate.ts`, written with the `columnTypes` and `createTable` helpers. It works on both dialects.

- **`projects.visibility`:** text, not null, default `'private'`. Allowed values are `public` and `private`, validated in `packages/schema`.
- **`project_members`:**
  - Columns: `id` (`pmb_…`), `project_id`, `user_id`, `role` (`viewer | editor | manager`), `created_at`, `updated_at`.
  - Unique on `(project_id, user_id)`, with an index on `user_id`.
- **`project_repos`:**
  - Columns: `id` (`rpo_…`), `project_id`, `owner`, `name`, `created_at`.
  - Unique on `(project_id, lower(owner), lower(name))`; GitHub names are case-insensitive. The column stores the case as entered.
- **`issues.repo_id`:** nullable, referencing `project_repos.id`.
- **Backfill** (the `up` function): one `project_members` row with role `editor` for every pair of existing project and user who is active, non-admin and not a `system` user. Migrations take no injected clock, so the backfill uses one timestamp computed once in `up` for all rows; it is never a database default. The `down` function drops what `up` added, in reverse order.

New TypeID prefixes in `packages/schema/src/ids.ts`: `projectMember: 'pmb'`, `projectRepo: 'rpo'`. Existing prefixes don't change.

Events, written through the existing event log (ADR 0004):

- `project.member_added`, `project.member_changed`, `project.member_removed`, carrying `user_id` and `role`.
- `project.repo_added`, `project.repo_removed`.
- Visibility changes appear in the existing `project.updated` diff.
- Changes to `repo` appear in the existing `issue.updated` diff.

## 2. Access model

### Effective access

Each actor has one of four access levels per project: `none < read < write < manage`.

| Actor                                  | Private project | Public project |
| -------------------------------------- | --------------- | -------------- |
| Global admin                           | manage          | manage         |
| `manager` member                       | manage          | manage         |
| `editor` member                        | write           | write          |
| `viewer` member                        | read            | read           |
| Signed-in non-member                   | none (404)      | read           |
| Anonymous, pending or deactivated user | none (404)      | read           |

- Agents are ordinary users and need memberships like humans do.
- The `system` actor (trusted mode, internal jobs) is unrestricted.

### What each level allows

- **read:**
  - Everything about the project: the project itself, issues, comments, attachments (listing and downloading), activity, statuses, labels, custom fields, views, the issue input schema, and the live stream.
  - Signed-in readers can also create personal views.
- **write:** all of today's member actions inside the project:
  - create and edit issues, including soft delete;
  - comment and upload;
  - create and remove links (write on one of the two issues, read on the other; whichever end the link is stored from);
  - create and edit labels, statuses and custom fields;
  - set `repo`.
  - Existing ownership rules still apply: you can edit or delete only your own comments and attachments.
- **manage:**
  - Rename the project, edit its description, change its visibility.
  - Add and remove repos.
  - Manage members.
  - Delete custom fields and edit shared views (both admin-only today).
  - Edit or delete anyone's comments and attachments in the project.

**Stays with global admins:** creating projects, archiving and unarchiving them, permanently deleting issues, managing users, webhooks, and managing other users' tokens. Webhooks keep delivering every matching event, because only an admin can configure one.

### Enforcement

- **Anonymous actor.**
  - `packages/core/src/context.ts` gains `ANONYMOUS_ACTOR`. The in-memory `Actor` type widens `kind` with `'anonymous'` (no role); the stored user `kind` enum does not change.
  - With no credentials, `apps/server/src/middleware/auth.ts` builds the context with `ANONYMOUS_ACTOR`. Today it falls back to `SYSTEM_ACTOR`, which is an admin.
  - `requireActor` is replaced by per-service checks, so reads of public projects can run anonymously.
  - Write services still reject an anonymous actor with 401 `UNAUTHENTICATED`.
- **Access on the context.**
  - `ServiceContext` gains a lazily loaded `access`. It loads the actor's memberships once per request (one query) and is cached on the context.
  - It answers two questions: `levelFor(project)`, and `readableProjectIds()`, which is the set of public projects plus the actor's memberships, or all projects for an admin or the system actor.
  - It lives in `packages/core/src/access.ts`, next to `permissions.ts`, which gains `requireProjectLevel(ctx, project, level)`.
- **Shared lookups.**
  - `getProjectRow` and `getIssueRow`/`findIssue` in `refs.ts` take a required `level` argument.
  - Below `read` they throw `notFound`. If the actor can read but the call needs more, they throw `forbidden`.
  - Every call site states the level it needs, so the type checker finds any call that doesn't.
- **Lookups by id** (`/attachments/{id}`, `/fields/{id}`, `/field-options/{id}`, `/labels/{id}`, `/statuses/{id}`, `/views/{id}`, `/comments/{id}`): resolve the parent project and check it the same way.
- **Cross-project reads:**
  - `queryIssues`/`listIssues` with no project: add `project_id IN readableProjectIds()`.
  - `resolveFilterRefs`: resolve names only within readable projects, so an error never confirms that a name exists somewhere private.
  - `listProjects`: readable projects only.
  - `GET /events` and the event replay in the stream: same predicate. `user.*` events (no project) are shown only to signed-in users.
  - `GET /events/stream`: the per-connection `matches` function also checks `readableProjectIds()`, refreshed whenever a `project.member_*` or `project.updated` event arrives for this actor or project.
  - Issue links and link history: a target in an unreadable project is returned as `{ id, inaccessible: true }` with no key, title or status.
- **Users and identity.**
  - `GET /users` and `GET /users/{id}` need a signed-in user; emails are shown only to admins and to the user themself.
  - Anonymous readers see handles and names only where they are embedded in resources they can read: authors, assignees, activity.
  - `GET /me` returns `{ anonymous: true }` instead of 401 when there are no credentials.
  - `/auth/config` keeps listing users only in dev-login mode, which production refuses.

## 3. Repo links

- **Input:** `owner/name`, or any `https://github.com/owner/name[/…]` URL, which is reduced to `owner/name`. Owner and name are validated against GitHub's allowed characters.
- **Output:** `{ id, owner, name, fullName: "owner/name", url: "https://github.com/owner/name" }`.
- **Issue field:**
  - `issues.repo_id` is exposed as `repo` (`owner/name` or null).
  - It is set on issue create and update, and rejected unless the repo belongs to the issue's project.
  - It is registered in `CORE_FIELDS` with `=`, `!=` and `in`, and empty checks, so it works in filters, sorting and views (ADR 0010).
- **Removing a repo** from a project sets `repo` to null on that project's issues in the same transaction (`withWriteTx`), recording an `issue.updated` event for each.
- **Moving an issue to another project** clears `repo` (the target project has different repos).

## 4. Interfaces

### API

Committed in `docs/openapi.json` (regenerated with `pnpm openapi:gen`).

- `Project` gains `visibility` and `repos`. `CreateProjectInput` and `UpdateProjectInput` accept `visibility`. Changing it needs `manage`.
- Project endpoints also return the caller's access level, `myAccess` (`read | write | manage`), so clients can hide controls they can't use.
- Members:
  - `GET /projects/{project}/members` (read).
  - `POST /projects/{project}/members` `{user, role}` (manage).
  - `PATCH /projects/{project}/members/{user}` `{role}` (manage).
  - `DELETE /projects/{project}/members/{user}` (manage).
- Repos:
  - `POST /projects/{project}/repos` `{repo}` (manage).
  - `DELETE /projects/{project}/repos/{id}` (manage).
- `Issue` gains `repo`. `CreateIssueInput` and `UpdateIssueInput` accept `repo`.
- `Me` becomes a union: the existing user shape, or `{ anonymous: true }`.
- Errors:
  - An unknown or unreadable project or issue returns 404 `NOT_FOUND`.
  - A readable project without the needed level returns 403 `FORBIDDEN`.
  - Anonymous writes return 401 `UNAUTHENTICATED`.

### CLI

Goldens and `docs/cli-reference.md` are refreshed with `pnpm vitest run --project cli -u`.

- `poietic-issues project create|edit … --visibility public|private`
- `poietic-issues project members list <project>` and `poietic-issues project members add|set <project> <user> --role viewer|editor|manager`, plus `poietic-issues project members remove <project> <user>`
- `poietic-issues project repo list|add|remove <project> [owner/name|url|id]`
- `poietic-issues issue create|edit … --repo owner/name` (`--repo ''` clears it)

### Web

All internal links go through `$lib/nav.ts`.

- **Project settings:** a visibility switch with a short explanation, a repo list (add and remove), and a members table with role pickers. Only shown with `manage`.
- **Issues:** a `repo` property (a picker from the project's repos) that links to GitHub, plus a `repo` filter.
- **Anonymous browsing:**
  - `/me` returning `{ anonymous: true }` doesn't redirect.
  - Public projects open read-only, with a "Sign in" button in the header.
  - The 401 handler still redirects to `/login` for actions that need sign-in.
  - The live stream connects anonymously for public projects.
- Write controls are hidden unless `myAccess` allows them. The server stays the authority.

### Demo

`seedDemoData` creates one public and one private project with members in different roles, so the demo shows every case. Everything stays browser-safe at module load.

## 5. Testing

Every database test runs under both `TEST_DB=sqlite` and `TEST_DB=postgres`.

- **Access matrix (core):** a table-driven test. For each actor (admin, manager, editor, viewer, non-member, anonymous, deactivated) on a public and a private project, every service operation either succeeds or fails with the expected error.
- **Non-leak tests:** search without a project, filter-name resolution, `listProjects`, `GET /events`, stream replay and live delivery, links and link history, every lookup by id, and `/users`.
- **Server:** with no credentials, the context actor is `ANONYMOUS_ACTOR` and never an admin. Anonymous writes get 401. Error codes are 404 and 403 as specified.
- **Migration:** existing active non-admin users become editors on existing projects. Admins, deactivated users and system users don't.
- **Repos:** parsing (`owner/name` and URL forms, invalid input), case-insensitive uniqueness, removing a repo clears issues, moving an issue clears `repo`, and the `repo` filter.
- **End-to-end (Playwright):** an anonymous visitor reads a public project without being redirected and without write controls; a private project URL shows not found; a manager makes a project public and adds a member.

## 6. Docs

- **ADR 0021, "Project visibility and roles":** supersedes ADR 0009's sentence that every member can act on every project. It records the levels, the 404-for-private rule and enforcement in core.
- `docs/agents.md`: agents need project memberships.
- `docs/deployment.md`: public projects are readable without signing in, and what the upgrade migration does.

## 7. Delivery

One implementation plan. Each PR keeps `pnpm check` green:

1. **Access core:** migration, `ANONYMOUS_ACTOR`, access resolution, levels on the shared lookups and every call site, cross-project filtering, the stream, and ADR 0021.
2. **Repo links:** table, services, the `repo` issue field and filter.
3. **API and CLI:** endpoints, OpenAPI, CLI commands and goldens.
4. **Web and demo:** settings UI, anonymous browsing, repo field, demo seed, end-to-end tests.

**Rollout on issues.poietic.tech:** after deploying, every project is still private and every current member is an editor, so nothing visible changes until someone makes a project public or changes roles. Users created after the upgrade, including agent users such as `claude`, start with no memberships and must be added to each private project they work in.
