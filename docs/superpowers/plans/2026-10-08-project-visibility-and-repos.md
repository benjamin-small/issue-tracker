# Project visibility, roles and GitHub repo links: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Projects become public or private with per-project roles (viewer/editor/manager), anonymous visitors can read public projects, and projects can link GitHub repositories that issues can reference.

**Architecture:** Access is decided in `packages/core`:

- a new `access.ts` computes the actor's level (`none < read < write < manage`) for one project, and the set of project ids the actor can read;
- the shared lookups in `refs.ts` take the level they need, and cross-project queries filter by the readable set;
- the HTTP layer swaps today's admin `SYSTEM_ACTOR` fallback for an `ANONYMOUS_ACTOR`, and lets anonymous requests through only for `GET`/`HEAD`.

Repo links are a new `project_repos` table plus a nullable `issues.repo_id`, exposed as the `repo` core field.

**Tech Stack:** TypeScript (strict ESM), Kysely on SQLite and Postgres, Zod schemas with `@hono/zod-openapi`, Hono, Commander (CLI), SvelteKit 5 with TanStack Query (web), Vitest, Playwright.

**Spec:** [docs/superpowers/specs/2026-10-08-project-visibility-and-repos-design.md](../specs/2026-10-08-project-visibility-and-repos-design.md)

## Global Constraints

- Business logic lives in `packages/core`, not in routes, the CLI or the web app (AGENTS.md).
- `packages/schema` stays isomorphic: no Node, Hono or database imports.
- Portable SQL only. Write through `withWriteTx`. Every database test passes under `TEST_DB=sqlite` and `TEST_DB=postgres` (`pnpm test`, `pnpm test:pg`).
- Timestamps come from the injected clock (`nowIso(ctx)`), never from database defaults.
- Never change an existing id prefix. The new prefix is `projectRepo: 'rpo'`.
- The API contract is committed. After any route or schema change, run `pnpm openapi:gen` and commit `docs/openapi.json` and `packages/client/src/generated/openapi.d.ts`.
- After any CLI change, run `pnpm vitest run --project cli -u` and commit the goldens and `docs/cli-reference.md`.
- Web links go through `$lib/nav.ts`.
- `pnpm check` passes before every commit. Commits stay scoped to one concern.
- Names: product "poietic-issues", CLI `poietic-issues`, environment `POIETIC_ISSUES_*`, ADR for this work: **0021**.
- Levels: `none < read < write < manage`. Roles: `viewer → read`, `editor → write`, `manager → manage`. Global admins and the `system` actor always get `manage`. Public projects give everyone at least `read`.
- Errors:
  - an unknown or unreadable project or issue returns `NOT_FOUND` (404);
  - a readable project without enough level returns `FORBIDDEN` (403);
  - anonymous writes return `UNAUTHENTICATED` (401).

## Deviations from the spec (decided while planning)

1. **No per-request access cache.** `ServiceContext` objects are reused across calls (tests, the CLI, the demo), so a cache on the context goes stale when memberships change. Each check is a single primary-key lookup instead, and cross-project reads use one subquery.
2. **`project_members` has a composite primary key `(project_id, user_id)` and no `pmb_` id.** Migrations cannot generate TypeIDs, because `packages/db` does not depend on `packages/schema`, and the backfill must insert rows. The spec's `pmb` prefix is dropped.
3. **Anonymous actor.** It keeps `role: 'member'`, so existing `role` checks stay sound, and gets `kind: 'anonymous'`. Route-level `requireActor` is narrowed rather than removed: anonymous requests are allowed only for `GET`/`HEAD`, and core decides visibility.
4. **Links into unreadable projects are omitted** from link lists and activity history, rather than shown as an "inaccessible" marker. This leaks nothing and needs no schema change to `IssueLink`.
5. **`myAccess` is on a separate response schema, `ProjectWithAccess`** (`Project` plus `myAccess`). `Project` itself is also embedded in event payloads, which are not per-viewer.

## File structure

**Created:**

| File                                                       | Purpose                                                                                        |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `packages/db/src/migrations/0004_project_access.ts`        | `projects.visibility`, `project_members`, `project_repos`, `issues.repo_id`, editor backfill   |
| `packages/core/src/access.ts`                              | Access levels, `ANONYMOUS_ACTOR` helpers, `projectLevel`, `requireLevel`, `readableProjectIds` |
| `packages/core/src/access.test.ts`                         | The access matrix                                                                              |
| `packages/core/src/services/members.ts` (+ `.test.ts`)     | Membership services                                                                            |
| `packages/core/src/services/repos.ts` (+ `.test.ts`)       | Repo-link services and `parseRepoRef`                                                          |
| `packages/core/src/visibility.test.ts`                     | Non-leak tests for cross-project reads                                                         |
| `apps/server/src/routes/members.ts`                        | Member and repo routes                                                                         |
| `apps/server/src/access.test.ts`                           | HTTP-level access tests                                                                        |
| `apps/cli/src/commands/members.ts`                         | `project members` and `project repo` commands                                                  |
| `apps/web/src/lib/components/ProjectAccessSettings.svelte` | Visibility switch and members table                                                            |
| `apps/web/src/lib/components/ProjectReposSettings.svelte`  | Repo list                                                                                      |
| `apps/web/src/lib/components/RepoPicker.svelte`            | Issue repo picker                                                                              |
| `apps/web/e2e/visibility.spec.ts`                          | End-to-end tests                                                                               |
| `docs/adr/0021-project-visibility-and-roles.md`            | ADR                                                                                            |

**Modified:**

| Area     | Files                                                                                                                                                                                                       |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema   | `packages/schema/src/ids.ts`, `entities.ts`, `events.ts`, `fields.ts`                                                                                                                                       |
| Database | `packages/db/src/migrate.ts`, `types.ts`, `db.test.ts`                                                                                                                                                      |
| Core     | `packages/core/src/context.ts`, `refs.ts`, `permissions.ts`, `mappers.ts`, `issue-query.ts`, `services/*.ts` (every lookup call site), `testing.ts`, `index.ts`                                             |
| Server   | `apps/server/src/app.ts`, `middleware/auth.ts`, `routes/auth.ts`, `routes/projects.ts`, `routes/stream.ts`, `routes/collaboration.ts`, `routes/issues.ts`                                                   |
| CLI      | `apps/cli/src/main.ts`, `commands/admin.ts`, `commands/issues.ts`, `output.ts`                                                                                                                              |
| Web      | `apps/web/src/lib/api.ts`, `queries.ts`, `live.svelte.ts`, `routes/+layout.svelte`, `routes/(app)/+layout.svelte`, `routes/(app)/p/[key]/settings/+page.svelte`, `Sidebar.svelte`, `IssueProperties.svelte` |
| Demo     | `packages/core/src/services/seed.ts`                                                                                                                                                                        |
| Docs     | `docs/agents.md`, `docs/deployment.md`, `docs/security.md`, `docs/adr/0009-auth-v1.md` (status line), `docs/adr/README.md`                                                                                  |

---

# PR 1: Access core

### Task 1: Schema for visibility, roles and members

**Files:**

- Modify: `packages/schema/src/ids.ts`, `packages/schema/src/entities.ts`, `packages/schema/src/events.ts`
- Test: `packages/schema/src/ids.test.ts`

**Interfaces:**

- Produces:
  - `ID_PREFIXES.projectRepo = 'rpo'`
  - `ProjectVisibilitySchema` (`'public' | 'private'`)
  - `ProjectRoleSchema` (`'viewer' | 'editor' | 'manager'`)
  - `ProjectAccessSchema` (`'read' | 'write' | 'manage'`)
  - `Project.visibility`
  - `ProjectWithAccessSchema` / `ProjectWithAccess`
  - `ProjectMemberSchema` / `ProjectMember`
  - `AddProjectMemberInputSchema`, `UpdateProjectMemberInputSchema`
  - `CreateProjectInput.visibility` (default `'private'`), `UpdateProjectInput.visibility`
  - event types `project.member_added`, `project.member_changed`, `project.member_removed`

- [ ] **Step 1: Write the failing test.** Append to `packages/schema/src/ids.test.ts`:

```ts
it('has a prefix for project repos', () => {
  expect(ID_PREFIXES.projectRepo).toBe('rpo');
  expect(newId('projectRepo')).toMatch(/^rpo_/);
});
```

- [ ] **Step 2: Run it to make sure it fails.** Run `pnpm vitest run --project schema src/ids.test.ts`. Expected: FAIL, because `projectRepo` is not a key of `ID_PREFIXES`.

- [ ] **Step 3: Add the prefix.** In `packages/schema/src/ids.ts`, add `projectRepo: 'rpo',` after `webhookDelivery: 'whd',`.

- [ ] **Step 4: Add the schemas.** In `packages/schema/src/entities.ts`, replace `ProjectSchema`, `CreateProjectInputSchema` and `UpdateProjectInputSchema` with:

```ts
export const ProjectVisibilitySchema = z.enum(['public', 'private']).meta({
  id: 'ProjectVisibility',
  description: '`public`: anyone can read, even signed out. `private`: members and admins only.',
});
export type ProjectVisibility = z.infer<typeof ProjectVisibilitySchema>;

export const ProjectRoleSchema = z.enum(['viewer', 'editor', 'manager']).meta({
  id: 'ProjectRole',
  description:
    '`viewer` reads, `editor` also writes, `manager` also manages settings, repos and members.',
});
export type ProjectRole = z.infer<typeof ProjectRoleSchema>;

export const ProjectAccessSchema = z
  .enum(['read', 'write', 'manage'])
  .meta({ id: 'ProjectAccess' });
export type ProjectAccess = z.infer<typeof ProjectAccessSchema>;

export const ProjectSchema = z
  .object({
    id: z.string(),
    key: z.string().meta({ description: 'Immutable issue-key prefix.', example: 'ENG' }),
    name: z.string(),
    description: z.string(),
    visibility: ProjectVisibilitySchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    archivedAt: TimestampSchema.nullable(),
  })
  .meta({ id: 'Project' });
export type Project = z.infer<typeof ProjectSchema>;

export const ProjectWithAccessSchema = ProjectSchema.extend({
  myAccess: ProjectAccessSchema.meta({ description: "The caller's access to this project." }),
}).meta({ id: 'ProjectWithAccess' });
export type ProjectWithAccess = z.infer<typeof ProjectWithAccessSchema>;

export const CreateProjectInputSchema = z
  .object({
    key: ProjectKeySchema,
    name: z.string().min(1).max(100),
    description: z.string().max(10_000).default(''),
    visibility: ProjectVisibilitySchema.default('private'),
  })
  .meta({ id: 'CreateProjectInput' });
export type CreateProjectInput = z.input<typeof CreateProjectInputSchema>;

export const UpdateProjectInputSchema = z
  .object({
    name: z.string().min(1).max(100),
    description: z.string().max(10_000),
    archived: z.boolean(),
    visibility: ProjectVisibilitySchema,
  })
  .partial()
  .meta({ id: 'UpdateProjectInput' });
export type UpdateProjectInput = z.input<typeof UpdateProjectInputSchema>;
```

Then, after `UserSummarySchema` (which must be declared first), add:

```ts
export const ProjectMemberSchema = z
  .object({
    user: UserSummarySchema,
    role: ProjectRoleSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .meta({ id: 'ProjectMember' });
export type ProjectMember = z.infer<typeof ProjectMemberSchema>;

export const AddProjectMemberInputSchema = z
  .object({
    user: z.string().meta({ description: 'User id, handle or `me`.', example: '@ada' }),
    role: ProjectRoleSchema,
  })
  .meta({ id: 'AddProjectMemberInput' });
export type AddProjectMemberInput = z.input<typeof AddProjectMemberInputSchema>;

export const UpdateProjectMemberInputSchema = z
  .object({ role: ProjectRoleSchema })
  .meta({ id: 'UpdateProjectMemberInput' });
export type UpdateProjectMemberInput = z.input<typeof UpdateProjectMemberInputSchema>;
```

- [ ] **Step 5: Add the event types.** In `packages/schema/src/events.ts`:
  - Add `'project.member_added'`, `'project.member_changed'` and `'project.member_removed'` to `EVENT_TYPES`, after `'project.updated'`.
  - Add this schema:

```ts
export const ProjectMemberEventDataSchema = z
  .object({ ...base, member: ProjectMemberSchema, previousRole: ProjectRoleSchema.optional() })
  .meta({ id: 'ProjectMemberEventData' });
```

- Map all three new types to it in the event-data record, next to `'project.updated': ProjectEventDataSchema`.
- Import `ProjectMemberSchema` and `ProjectRoleSchema` from `./entities.ts`.

- [ ] **Step 6: Typecheck.** Run `pnpm vitest run --project schema` (expected: PASS), then `pnpm typecheck`. Expected: errors only in `packages/core/src/mappers.ts` (`visibility` is missing from `toProject`) and code that builds `Project`. Task 2 fixes them; don't commit yet.

### Task 2: Migration 0004 and database types

**Files:**

- Create: `packages/db/src/migrations/0004_project_access.ts`
- Modify: `packages/db/src/migrate.ts`, `packages/db/src/types.ts`, `packages/db/src/db.test.ts`, `packages/core/src/mappers.ts`

**Interfaces:**

- Consumes: none (the migration must not import `@poietic-tech/issues-schema`).
- Produces:
  - Kysely tables `project_members` `{ project_id, user_id, role, created_at, updated_at }` and `project_repos` `{ id, project_id, owner, name, created_at }`
  - `ProjectsTable.visibility: 'public' | 'private'`
  - `IssuesTable.repo_id: string | null`
  - migration name `'0004_project_access'`

- [ ] **Step 1: Write the failing tests.** In `packages/db/src/db.test.ts`, inside `describe(\`migrations (${dialect})\`…)`:
  - Change the first assertion to `expect(await migrateDown(db)).toEqual(['0004_project_access']);`, followed by `await expect(sql\`select count(*) from project_members\`.execute(db.kysely)).rejects.toThrow();`. Then keep the existing `0003`→`0001` steps.
  - Add `'0004_project_access'` to both arrays at the end.
  - Add a new test:

```ts
it('0004 makes active non-admin users editors of existing projects', async () => {
  const db = await createTestDb();
  try {
    await migrateDown(db); // back to 0003
    const ts = '2026-01-01T00:00:00.000Z';
    const user = (
      id: string,
      handle: string,
      role: string,
      kind: string,
      deactivated: string | null,
    ) =>
      sql`insert into users (id, handle, name, email, kind, role, avatar_url, created_at, updated_at, deactivated_at)
          values (${id}, ${handle}, ${handle}, null, ${kind}, ${role}, null, ${ts}, ${ts}, ${deactivated})`.execute(
        db.kysely,
      );
    await user('usr_m', 'm', 'member', 'human', null);
    await user('usr_bot', 'bot', 'member', 'agent', null);
    await user('usr_a', 'a', 'admin', 'human', null);
    await user('usr_gone', 'gone', 'member', 'human', ts);
    await sql`insert into projects (id, key, name, description, next_issue_number, created_at, updated_at, archived_at)
              values ('prj_1', 'ENG', 'Eng', '', 1, ${ts}, ${ts}, null)`.execute(db.kysely);
    await migrateToLatest(db);
    const rows = await sql<{ user_id: string; role: string }>`
      select user_id, role from project_members where project_id = 'prj_1' order by user_id`.execute(
      db.kysely,
    );
    expect(rows.rows).toEqual([
      { user_id: 'usr_bot', role: 'editor' },
      { user_id: 'usr_m', role: 'editor' },
    ]);
    const vis = await sql<{ visibility: string }>`select visibility from projects`.execute(
      db.kysely,
    );
    expect(vis.rows).toEqual([{ visibility: 'private' }]);
  } finally {
    await db.destroy();
  }
});
```

- [ ] **Step 2: Run the tests to make sure they fail.** Run `pnpm vitest run --project db src/db.test.ts`. Expected: FAIL (no migration `0004_project_access`).

- [ ] **Step 3: Write the migration.** Create `packages/db/src/migrations/0004_project_access.ts`:

```ts
import { type Kysely, sql } from 'kysely';
import type { Dialect } from '../dialect.ts';
import { columnTypes, createTable } from './helpers.ts';

/**
 * Project visibility and roles (ADR 0021) plus GitHub repo links. Existing projects stay private,
 * and every active non-admin user becomes an editor of every existing project, so nobody loses access.
 */
export function migration0004(dialect: Dialect) {
  const t = columnTypes(dialect);
  return {
    async up(db: Kysely<unknown>): Promise<void> {
      // A constant default is needed to add a NOT NULL column to existing rows; services always set it.
      await db.schema
        .alterTable('projects')
        .addColumn('visibility', t.text, (c) => c.notNull().defaultTo('private'))
        .execute();

      await createTable(db, dialect, 'project_members')
        .addColumn('project_id', t.id, (c) =>
          c.notNull().references('projects.id').onDelete('cascade'),
        )
        .addColumn('user_id', t.id, (c) => c.notNull().references('users.id').onDelete('cascade'))
        .addColumn('role', t.text, (c) => c.notNull())
        .addColumn('created_at', t.ts, (c) => c.notNull())
        .addColumn('updated_at', t.ts, (c) => c.notNull())
        .addPrimaryKeyConstraint('project_members_pk', ['project_id', 'user_id'])
        .execute();
      await db.schema
        .createIndex('project_members_user_idx')
        .on('project_members')
        .column('user_id')
        .execute();

      await createTable(db, dialect, 'project_repos')
        .addColumn('id', t.id, (c) => c.primaryKey())
        .addColumn('project_id', t.id, (c) =>
          c.notNull().references('projects.id').onDelete('cascade'),
        )
        .addColumn('owner', t.text, (c) => c.notNull())
        .addColumn('name', t.text, (c) => c.notNull())
        .addColumn('created_at', t.ts, (c) => c.notNull())
        .execute();
      await db.schema
        .createIndex('project_repos_unique')
        .on('project_repos')
        .unique()
        .columns(['project_id', sql`lower(owner)` as never, sql`lower(name)` as never])
        .execute();

      await db.schema
        .alterTable('issues')
        .addColumn('repo_id', t.id, (c) => c.references('project_repos.id').onDelete('set null'))
        .execute();

      // Migrations have no injected clock; one timestamp for every backfilled row.
      const now = new Date().toISOString();
      await sql`
        insert into project_members (project_id, user_id, role, created_at, updated_at)
        select p.id, u.id, 'editor', ${now}, ${now}
        from projects p cross join users u
        where u.role = 'member' and u.kind <> 'system' and u.deactivated_at is null`.execute(db);
    },
    async down(db: Kysely<unknown>): Promise<void> {
      await db.schema.alterTable('issues').dropColumn('repo_id').execute();
      await db.schema.dropTable('project_repos').execute();
      await db.schema.dropTable('project_members').execute();
      await db.schema.alterTable('projects').dropColumn('visibility').execute();
    },
  };
}
```

> On Postgres, `${now}` binds as text into a `timestamptz(3)` column. If Postgres rejects the implicit cast, use `cast(${now} as timestamptz)` when `dialect === 'postgres'`, behind a small ternary in this file. Check this under `pnpm test:pg` in Step 6.
> SQLite may refuse `dropColumn('repo_id')` on a column with a foreign key. If the down migration fails on SQLite, drop the `references(...)` from `repo_id` (the service clears it explicitly in Task 11) and keep the column a plain `t.id`.

- [ ] **Step 4: Register the migration and the types.**
  - In `packages/db/src/migrate.ts`, import `migration0004` and add `'0004_project_access': migration0004(dialect),` as the last entry of `allMigrations`.
  - In `packages/db/src/types.ts`:
    - add `visibility: 'public' | 'private';` to `ProjectsTable` after `description`;
    - add `repo_id: string | null;` to `IssuesTable` after `parent_id`;
    - add the new tables and register them in `Database` as `project_members: ProjectMembersTable; project_repos: ProjectReposTable;`:

```ts
export interface ProjectMembersTable {
  project_id: string;
  user_id: string;
  role: 'viewer' | 'editor' | 'manager';
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ProjectReposTable {
  id: string;
  project_id: string;
  owner: string;
  name: string;
  created_at: Timestamp;
}
```

- [ ] **Step 5: Map `visibility`.** In `packages/core/src/mappers.ts`, add `visibility: r.visibility,` to `toProject` after `description`. In `packages/core/src/services/projects.ts` `createProject`, add `visibility: data.visibility,` to the `insertInto('projects').values({...})` object.

- [ ] **Step 6: Run the tests.** Run `pnpm vitest run --project db` and `TEST_DB=postgres pnpm vitest run --project db` (start Postgres first with `pnpm pg start`). Expected: PASS. Then run `pnpm typecheck`. Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add packages/schema packages/db packages/core/src/mappers.ts packages/core/src/services/projects.ts
git commit -m "feat(db): project visibility, members and repos tables (migration 0004)"
```

### Task 3: The access module

**Files:**

- Create: `packages/core/src/access.ts`, `packages/core/src/access.test.ts`
- Modify: `packages/core/src/context.ts`, `packages/core/src/index.ts`, `packages/core/src/testing.ts`

**Interfaces:**

- Consumes: the `project_members` table and `projects.visibility` (Task 2).
- Produces:

```ts
// context.ts
export interface Actor {
  id: string;
  handle: string;
  name: string;
  kind: 'human' | 'agent' | 'system' | 'anonymous';
  role: 'admin' | 'member';
}
export const ANONYMOUS_ACTOR: Actor; // { id: 'usr_anonymous', handle: 'anonymous', name: 'Anonymous', kind: 'anonymous', role: 'member' }
export function isAnonymous(ctx: Pick<ServiceContext, 'actor'>): boolean;
// access.ts
export type AccessLevel = 'none' | 'read' | 'write' | 'manage';
export function atLeast(have: AccessLevel, need: AccessLevel): boolean;
export async function projectLevel(
  ctx: ServiceContext,
  db: Exec,
  project: { id: string; visibility: 'public' | 'private' },
): Promise<AccessLevel>;
export function requireLevel(
  ctx: ServiceContext,
  have: AccessLevel,
  need: Exclude<AccessLevel, 'none'>,
  what: string,
  ref: string,
): void;
export async function readableProjectIds(ctx: ServiceContext, db: Exec): Promise<'all' | string[]>;
// testing.ts
export async function grant(
  t: TestContext,
  projectRef: string,
  who: ServiceContext,
  role: 'viewer' | 'editor' | 'manager',
): Promise<void>;
```

- [ ] **Step 1: Write the failing test.** Create `packages/core/src/access.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ANONYMOUS_ACTOR, SYSTEM_ACTOR, withActor } from './context.ts';
import { projectLevel, readableProjectIds } from './access.ts';
import { createProject } from './services/projects.ts';
import { createTestContext, grant, type TestContext } from './testing.ts';
import { testDialect } from '@poietic-tech/issues-db/testing';

describe(`access (${testDialect()})`, () => {
  let t: TestContext;
  let pub: { id: string; visibility: 'public' | 'private' };
  let priv: { id: string; visibility: 'public' | 'private' };
  beforeAll(async () => {
    t = await createTestContext();
    pub = await createProject(t.ctx, { key: 'PUB', name: 'Public', visibility: 'public' });
    priv = await createProject(t.ctx, { key: 'PRV', name: 'Private' });
  });
  afterAll(() => t.destroy());

  const level = (ctx: Parameters<typeof projectLevel>[0], p: typeof pub) =>
    projectLevel(ctx, t.db.kysely, p);

  it('gives admins and the system actor manage everywhere', async () => {
    expect(await level(t.ctx, priv)).toBe('manage');
    expect(await level(withActor(t.ctx, SYSTEM_ACTOR), priv)).toBe('manage');
  });

  it('maps roles to levels and public to read', async () => {
    expect(await level(t.member, priv)).toBe('none');
    expect(await level(t.member, pub)).toBe('read');
    await grant(t, 'PRV', t.member, 'viewer');
    expect(await level(t.member, priv)).toBe('read');
    await grant(t, 'PRV', t.member, 'editor');
    expect(await level(t.member, priv)).toBe('write');
    await grant(t, 'PRV', t.member, 'manager');
    expect(await level(t.member, priv)).toBe('manage');
  });

  it('gives anonymous read on public projects only', async () => {
    const anon = withActor(t.ctx, ANONYMOUS_ACTOR);
    expect(await level(anon, pub)).toBe('read');
    expect(await level(anon, priv)).toBe('none');
    expect(await readableProjectIds(anon, t.db.kysely)).toEqual([pub.id]);
  });

  it('lists public plus member projects, or all for admins', async () => {
    expect(await readableProjectIds(t.ctx, t.db.kysely)).toBe('all');
    expect(new Set(await readableProjectIds(t.agent, t.db.kysely))).toEqual(new Set([pub.id]));
    await grant(t, 'PRV', t.agent, 'viewer');
    expect(new Set(await readableProjectIds(t.agent, t.db.kysely))).toEqual(
      new Set([pub.id, priv.id]),
    );
  });
});
```

- [ ] **Step 2: Run it to make sure it fails.** Run `pnpm vitest run --project core src/access.test.ts`. Expected: FAIL, because `./access.ts`, `ANONYMOUS_ACTOR` and `grant` do not exist.

- [ ] **Step 3: Add the anonymous actor.** In `packages/core/src/context.ts`:
  - Widen `Actor.kind` to `'human' | 'agent' | 'system' | 'anonymous'`.
  - Add:

```ts
/**
 * The actor for requests without credentials (or with a pending or deactivated user's). It can read
 * public projects and nothing else (ADR 0021). `role: 'member'` keeps every existing admin check closed.
 */
export const ANONYMOUS_ACTOR: Actor = {
  id: 'usr_anonymous',
  handle: 'anonymous',
  name: 'Anonymous',
  kind: 'anonymous',
  role: 'member',
};

export function isAnonymous(ctx: Pick<ServiceContext, 'actor'>): boolean {
  return ctx.actor.kind === 'anonymous';
}
```

Then fix any exhaustive `switch (actor.kind)` that `pnpm typecheck` reports. `toActor` in `services/users.ts` maps stored users, which never have the kind `anonymous`, so it needs no change.

- [ ] **Step 4: Write `access.ts`.**

```ts
import type { Database, Kysely } from '@poietic-tech/issues-db';
import type { ServiceContext } from './context.ts';
import { DomainError, forbidden, notFound } from './errors.ts';

type Exec = Kysely<Database>;

/** Access an actor has to one project (ADR 0021). Ordered: each level includes the ones before it. */
export type AccessLevel = 'none' | 'read' | 'write' | 'manage';
const ORDER: Record<AccessLevel, number> = { none: 0, read: 1, write: 2, manage: 3 };
const ROLE_LEVEL = { viewer: 'read', editor: 'write', manager: 'manage' } as const;

export function atLeast(have: AccessLevel, need: AccessLevel): boolean {
  return ORDER[have] >= ORDER[need];
}

function unrestricted(ctx: ServiceContext): boolean {
  return ctx.actor.role === 'admin' || ctx.actor.kind === 'system';
}

export async function projectLevel(
  ctx: ServiceContext,
  db: Exec,
  project: { id: string; visibility: 'public' | 'private' },
): Promise<AccessLevel> {
  if (unrestricted(ctx)) return 'manage';
  const floor: AccessLevel = project.visibility === 'public' ? 'read' : 'none';
  if (ctx.actor.kind === 'anonymous') return floor;
  const member = await db
    .selectFrom('project_members')
    .select('role')
    .where('project_id', '=', project.id)
    .where('user_id', '=', ctx.actor.id)
    .executeTakeFirst();
  const fromRole: AccessLevel = member ? ROLE_LEVEL[member.role] : 'none';
  return atLeast(fromRole, floor) ? fromRole : floor;
}

/**
 * Throws unless `have` reaches `need`. Below read, the resource is reported as not found, so private
 * projects don't reveal that they exist. Anonymous actors asking for more than read get UNAUTHENTICATED.
 */
export function requireLevel(
  ctx: ServiceContext,
  have: AccessLevel,
  need: Exclude<AccessLevel, 'none'>,
  what: string,
  ref: string,
): void {
  if (atLeast(have, need)) return;
  if (have === 'none') throw notFound(what, ref);
  if (ctx.actor.kind === 'anonymous')
    throw new DomainError('UNAUTHENTICATED', 'Sign in to make changes');
  throw forbidden(
    need === 'manage'
      ? 'Only project managers can do this'
      : 'You have read-only access to this project',
  );
}

/** Ids of projects the actor can read, or `'all'` for admins and the system actor. */
export async function readableProjectIds(ctx: ServiceContext, db: Exec): Promise<'all' | string[]> {
  if (unrestricted(ctx)) return 'all';
  let q = db.selectFrom('projects').select('id').where('visibility', '=', 'public');
  if (ctx.actor.kind !== 'anonymous') {
    const actorId = ctx.actor.id;
    q = db
      .selectFrom('projects')
      .select('id')
      .where((eb) =>
        eb.or([
          eb('visibility', '=', 'public'),
          eb(
            'id',
            'in',
            eb.selectFrom('project_members').select('project_id').where('user_id', '=', actorId),
          ),
        ]),
      );
  }
  return (await q.execute()).map((r) => r.id);
}
```

Export it from `packages/core/src/index.ts`:

```ts
export {
  atLeast,
  type AccessLevel,
  projectLevel,
  readableProjectIds,
  requireLevel,
} from './access.ts';
```

`ANONYMOUS_ACTOR` and `isAnonymous` are already exported by `export * from './context.ts'`.

- [ ] **Step 5: Add the `grant` test helper.** Append to `packages/core/src/testing.ts`:

```ts
/** Test helper: gives `who` a role on a project, writing directly (no permission check, no event). */
export async function grant(
  t: TestContext,
  projectRef: string,
  who: ServiceContext,
  role: 'viewer' | 'editor' | 'manager',
): Promise<void> {
  const project = await t.db.kysely
    .selectFrom('projects')
    .select('id')
    .where((eb) => eb.or([eb('id', '=', projectRef), eb('key', '=', projectRef.toUpperCase())]))
    .executeTakeFirstOrThrow();
  const now = t.ctx.clock.now().toISOString();
  await t.db.kysely
    .insertInto('project_members')
    .values({
      project_id: project.id,
      user_id: who.actor.id,
      role,
      created_at: now,
      updated_at: now,
    })
    .onConflict((oc) =>
      oc.columns(['project_id', 'user_id']).doUpdateSet({ role, updated_at: now }),
    )
    .execute();
}
```

- [ ] **Step 6: Run the tests.** Run `pnpm vitest run --project core src/access.test.ts`, then with `TEST_DB=postgres`. Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add packages/core/src/access.ts packages/core/src/access.test.ts packages/core/src/context.ts packages/core/src/index.ts packages/core/src/testing.ts
git commit -m "feat(core): project access levels and the anonymous actor"
```

### Task 4: Access-checked shared lookups at every call site

**Files:**

- Modify: `packages/core/src/refs.ts`, every service listed in the table below, `apps/server/src/routes/collaboration.ts`, `apps/server/src/routes/stream.ts`, and the existing `*.test.ts` files that the full suite shows failing.

**Interfaces:**

- Consumes: `projectLevel` and `requireLevel` (Task 3).
- Produces:

```ts
export async function getProjectRow(
  ctx: ServiceContext,
  db: Exec,
  ref: string,
  level: Exclude<AccessLevel, 'none'>,
): Promise<Selectable<Database['projects']>>;
export async function getIssueRow(
  ctx: ServiceContext,
  db: Exec,
  ref: string,
  level: Exclude<AccessLevel, 'none'>,
): Promise<Selectable<Database['issues']>>;
export async function requireProjectId(
  ctx: ServiceContext,
  db: Exec,
  projectId: string,
  level: Exclude<AccessLevel, 'none'>,
): Promise<Selectable<Database['projects']>>;
```

`findProject` and `findIssue` stay unchecked. They are for internal joins and the access module only. Every service that resolves a caller-supplied reference uses the checked versions.

- [ ] **Step 1: Write the failing test.** Create `packages/core/src/visibility.test.ts`. Task 6 extends this file; start it with the per-project lookups:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDialect } from '@poietic-tech/issues-db/testing';
import { ANONYMOUS_ACTOR, withActor } from './context.ts';
import { createIssue, getIssue, updateIssue } from './services/issues.ts';
import { createProject, getProject } from './services/projects.ts';
import { createTestContext, grant, type TestContext } from './testing.ts';

describe(`project visibility (${testDialect()})`, () => {
  let t: TestContext;
  beforeAll(async () => {
    t = await createTestContext();
    await createProject(t.ctx, { key: 'PUB', name: 'Public', visibility: 'public' });
    await createProject(t.ctx, { key: 'PRV', name: 'Private' });
    await createIssue(t.ctx, 'PUB', { title: 'open' });
    await createIssue(t.ctx, 'PRV', { title: 'secret' });
  });
  afterAll(() => t.destroy());

  it('hides private projects and their issues as not found', async () => {
    await expect(getProject(t.member, 'PRV')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(getIssue(t.member, 'PRV-1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('lets anyone read public projects but only editors write', async () => {
    const anon = withActor(t.ctx, ANONYMOUS_ACTOR);
    expect((await getIssue(anon, 'PUB-1')).title).toBe('open');
    await expect(updateIssue(anon, 'PUB-1', { title: 'x' })).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await expect(updateIssue(t.member, 'PUB-1', { title: 'x' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await grant(t, 'PUB', t.member, 'editor');
    expect((await updateIssue(t.member, 'PUB-1', { title: 'x' })).title).toBe('x');
  });
});
```

Check the real exported names (`updateIssue` vs `updateIssueInTx`) in `services/issues.ts` and adjust the imports.

- [ ] **Step 2: Run it to make sure it fails.** Run `pnpm vitest run --project core src/visibility.test.ts`. Expected: FAIL, because the member can read `PRV` today.

- [ ] **Step 3: Change `refs.ts`.** Replace `getProjectRow` and `getIssueRow` with:

```ts
type Need = Exclude<AccessLevel, 'none'>;

/** Resolves a project the actor may access at `level`; unreadable projects are NOT_FOUND (ADR 0021). */
export async function getProjectRow(ctx: ServiceContext, db: Exec, ref: string, level: Need) {
  const row = await findProject(db, ref);
  if (!row) throw notFound('Project', ref);
  requireLevel(ctx, await projectLevel(ctx, db, row), level, 'Project', ref);
  return row;
}

/** `getProjectRow` for an id read from another row (a label's, a comment's issue's, …). */
export async function requireProjectId(
  ctx: ServiceContext,
  db: Exec,
  projectId: string,
  level: Need,
) {
  return getProjectRow(ctx, db, projectId, level);
}

/** Resolves an issue whose project the actor may access at `level`. Includes soft-deleted issues. */
export async function getIssueRow(ctx: ServiceContext, db: Exec, ref: string, level: Need) {
  const row = await findIssue(db, ref);
  if (!row) throw notFound('Issue', ref);
  const project = await findProject(db, row.project_id);
  requireLevel(ctx, await projectLevel(ctx, db, project!), level, 'Issue', ref);
  return row;
}
```

Import `type AccessLevel`, `projectLevel` and `requireLevel` from `./access.ts`.

- [ ] **Step 4: Update every call site.** `pnpm typecheck` lists them all. Apply this table. "write" means the existing write path; any extra admin check already in the function stays.

| File                        | Function                                                                                           | Lookup → level                                                                                                                                |
| --------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/issues.ts`        | `getIssue`, `listChildren`, `listIssueActivity`                                                    | issue → `read`                                                                                                                                |
|                             | `listIssues` (with project)                                                                        | project → `read`                                                                                                                              |
|                             | `rankForPlacement`, `resolveParent`, `updateIssueInTx`, `moveIssue`, `deleteIssue`, `restoreIssue` | issue → `write`                                                                                                                               |
|                             | `createIssue`                                                                                      | project → `write`                                                                                                                             |
| `services/comments.ts`      | `listComments`                                                                                     | issue → `read`                                                                                                                                |
|                             | `createComment`                                                                                    | issue → `write`                                                                                                                               |
| `services/attachments.ts`   | `listAttachments`                                                                                  | issue → `read`                                                                                                                                |
|                             | `uploadAttachment`                                                                                 | issue → `write`                                                                                                                               |
| `services/custom-fields.ts` | `listCustomFields`                                                                                 | project → `read`                                                                                                                              |
|                             | `createCustomField`                                                                                | project → `write`                                                                                                                             |
| `services/labels.ts`        | `listLabels`                                                                                       | project → `read`                                                                                                                              |
|                             | `createLabel`                                                                                      | project → `write`                                                                                                                             |
| `services/statuses.ts`      | `listStatuses`                                                                                     | project → `read`                                                                                                                              |
|                             | `createStatus`, `reorderStatuses`                                                                  | project → `write`                                                                                                                             |
| `services/views.ts`         | `listViews`                                                                                        | project → `read`                                                                                                                              |
|                             | `createView`                                                                                       | project → `read` for personal views; `manage` when the view is shared (`owner` null)                                                          |
| `services/links.ts`         | `listIssueLinks`                                                                                   | issue → `read`                                                                                                                                |
|                             | `createLink`                                                                                       | issue → `write`, target → `read`                                                                                                              |
| `services/projects.ts`      | `getProject`                                                                                       | project → `read`                                                                                                                              |
|                             | `updateProject`                                                                                    | project → `write` (Task 7 raises this to `manage`)                                                                                            |
| `services/schema.ts`        | `issueInputJsonSchema`                                                                             | project → `read`; give it a `ctx` parameter if it only takes `db`                                                                             |
| `services/webhooks.ts`      | `createWebhook`, `updateWebhook`                                                                   | project → `read`, after the existing `requireAdmin`                                                                                           |
| `issue-query.ts`            | `resolveFilterRefs` (`parent`)                                                                     | use `getIssueRow(ctx, db, v, 'read')` inside a try/catch that turns `NOT_FOUND` into the existing `validationError(\`Unknown issue "${v}"\`)` |
| `routes/collaboration.ts`   | `GET /events`                                                                                      | project and issue → `read`                                                                                                                    |
| `routes/stream.ts`          | `GET /events/stream`                                                                               | project → `read`                                                                                                                              |

The call shape changes from `getIssueRow(tx, ref)` to `getIssueRow(ctx, tx, ref, 'write')`.

- [ ] **Step 5: Run the target test.** Run `pnpm vitest run --project core src/visibility.test.ts`. Expected: PASS.

- [ ] **Step 6: Run the full suite and repair existing tests.** Run `pnpm test`. Tests that act as `t.member` or `t.agent` on projects created by the admin now fail with `NOT_FOUND` or `FORBIDDEN`. In each failing file, right after the project is created, add `await grant(t, '<KEY>', t.member, 'editor')` (and the same for `t.agent` where it's used). Do not loosen any assertion. Repeat until `pnpm test` passes, then run `pnpm test:pg`.

  The CLI and server suites act through HTTP with tokens: grant memberships in their fixtures the same way, using the `grant` helper on the test database.

- [ ] **Step 7: Commit.**

```bash
git add packages/core apps/server/src/routes/collaboration.ts apps/server/src/routes/stream.ts apps/server/src apps/cli/src
git commit -m "feat(core): check project access in the shared issue and project lookups"
```

### Task 5: Lookups by id, moderation and manage-only actions

**Files:**

- Modify: `packages/core/src/services/labels.ts`, `statuses.ts`, `custom-fields.ts`, `views.ts`, `comments.ts`, `attachments.ts`, `links.ts`
- Test: `packages/core/src/visibility.test.ts`

**Interfaces:**

- Consumes: `requireProjectId(ctx, db, projectId, level)` (Task 4).
- Produces: no new exports. Changed behaviour:
  - updating or deleting a label, status or custom field (or its option) needs `write`;
  - **deleting** a custom field needs `manage`;
  - reading a custom field or view by id needs `read`;
  - updating or deleting a shared view needs `manage`; a personal view needs its owner;
  - editing or deleting someone else's comment or attachment needs `manage`;
  - `getAttachment` by id needs `read`;
  - `deleteLink` needs `write` on the source issue.

- [ ] **Step 1: Write the failing tests.** Append inside the `describe` in `visibility.test.ts`:

```ts
it('checks the parent project for lookups by id', async () => {
  const { listLabels, createLabel, updateLabel } = await import('./services/labels.ts');
  const label = await createLabel(t.ctx, 'PRV', { name: 'secret-label' });
  await expect(updateLabel(t.member, label.id, { name: 'x' })).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  await grant(t, 'PRV', t.member, 'viewer');
  await expect(updateLabel(t.member, label.id, { name: 'x' })).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  expect((await listLabels(t.member, 'PRV')).map((l) => l.name)).toContain('secret-label');
});

it('lets managers moderate comments and delete custom fields', async () => {
  const { createComment, updateComment } = await import('./services/comments.ts');
  const { createCustomField, deleteCustomField } = await import('./services/custom-fields.ts');
  await grant(t, 'PRV', t.agent, 'editor');
  const comment = await createComment(t.agent, 'PRV-1', { body: 'hi' });
  await grant(t, 'PRV', t.member, 'editor');
  await expect(updateComment(t.member, comment.id, { body: 'edited' })).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  await grant(t, 'PRV', t.member, 'manager');
  expect((await updateComment(t.member, comment.id, { body: 'edited' })).body).toBe('edited');
  const field = await createCustomField(t.member, 'PRV', {
    key: 'tier',
    name: 'Tier',
    type: 'text',
  });
  expect((await deleteCustomField(t.member, field.id)).id).toBe(field.id);
});
```

Match the real input shapes of `createCustomField` and `createLabel` (read their schemas in `packages/schema/src/custom-fields.ts` and `entities.ts`).

- [ ] **Step 2: Run them to make sure they fail.** Run `pnpm vitest run --project core src/visibility.test.ts`. Expected: FAIL, because by-id updates don't check the project.

- [ ] **Step 3: Add the checks.** In each by-id function, after loading the row and before any write, add `await requireProjectId(ctx, tx, row.project_id, '<level>')`. Use `ctx.db.kysely` instead of `tx` in read paths. For rows without `project_id`, join through:

| Row                   | Project id from                 |
| --------------------- | ------------------------------- |
| field options         | `custom_fields.project_id`      |
| comments, attachments | the issue's `project_id`        |
| links                 | the source issue's `project_id` |

Replace these existing checks:

- `custom-fields.ts` `deleteCustomField`: `requireAdmin(ctx, …)` becomes `requireProjectId(ctx, tx, row.project_id, 'manage')`.
- `views.ts` shared-view admin check (around line 101): for `owner_id === null`, require `'manage'`.
- `comments.ts` around line 123 and `attachments.ts` around line 193: the condition becomes `row.author_id === ctx.actor.id || atLeast(await projectLevel(ctx, tx, project), 'manage')`, where `project` comes from `requireProjectId(ctx, tx, projectId, 'write')`. Keep each file's existing error message.

- [ ] **Step 4: Run the tests.** Run `pnpm vitest run --project core` and `pnpm test:pg`. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/core
git commit -m "feat(core): project access for lookups by id; managers moderate and delete fields"
```

### Task 6: Cross-project reads and user privacy

**Files:**

- Modify:
  - `packages/core/src/services/projects.ts` (`listProjects`)
  - `packages/core/src/issue-query.ts` (`queryIssues`, `resolveFilterRefs`)
  - `packages/core/src/services/events.ts` (`listEvents`)
  - `packages/core/src/services/links.ts` (`linksOf`)
  - `packages/core/src/services/users.ts` (`listUsers`, `getUser`)
- Test: `packages/core/src/visibility.test.ts`

**Interfaces:**

- Consumes: `readableProjectIds(ctx, db)` (Task 3).
- Produces: a new helper in `access.ts`:

```ts
/** Adds "project id is readable" to a query on a column holding project ids. */
export async function whereReadable<QB extends { where: (...a: never[]) => QB }>(
  ctx: ServiceContext,
  db: Exec,
  qb: QB,
  column: string,
): Promise<QB>;
```

Type it however Kysely's builder typing allows. A plain inline pattern at each call site is fine if the generic helper fights the types:

```ts
const readable = await readableProjectIds(ctx, db);
if (readable !== 'all')
  q = readable.length ? q.where('i.project_id', 'in', readable) : q.where(sql<boolean>`1 = 0`);
```

- [ ] **Step 1: Write the failing tests.** Append to `visibility.test.ts`:

```ts
it('never returns unreadable projects from cross-project reads', async () => {
  const { listProjects } = await import('./services/projects.ts');
  const { listIssues } = await import('./services/issues.ts');
  const { listEvents } = await import('./services/events.ts');
  const anon = withActor(t.ctx, ANONYMOUS_ACTOR);
  expect((await listProjects(anon)).map((p) => p.key)).toEqual(['PUB']);
  const issues = await listIssues(anon, {});
  expect(issues.data.every((i) => i.key.startsWith('PUB-'))).toBe(true);
  const events = await listEvents(anon, { limit: 1000 });
  const prv = await t.db.kysely
    .selectFrom('projects')
    .select('id')
    .where('key', '=', 'PRV')
    .executeTakeFirstOrThrow();
  expect(events.data.some((e) => e.projectId === prv.id)).toBe(false);
  expect(events.data.some((e) => e.projectId === null)).toBe(false); // user.* events need sign-in
});

it('does not confirm private names through filter errors', async () => {
  const { listIssues } = await import('./services/issues.ts');
  const { createLabel } = await import('./services/labels.ts');
  await createLabel(t.ctx, 'PRV', { name: 'only-private' });
  const anon = withActor(t.ctx, ANONYMOUS_ACTOR);
  await expect(
    listIssues(anon, {
      filter: { conditions: [{ field: 'labels', op: 'eq', value: 'only-private' }] },
    }),
  ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: 'Unknown label "only-private"' });
});

it('omits links into unreadable projects', async () => {
  const { createLink, listIssueLinks } = await import('./services/links.ts');
  await createLink(t.ctx, 'PUB-1', { type: 'relates', target: 'PRV-1' });
  const anon = withActor(t.ctx, ANONYMOUS_ACTOR);
  expect(await listIssueLinks(anon, 'PUB-1')).toEqual([]);
  expect((await listIssueLinks(t.ctx, 'PUB-1')).length).toBe(1);
});

it('requires sign-in for users and shows emails only to admins and the user', async () => {
  const { listUsers } = await import('./services/users.ts');
  const anon = withActor(t.ctx, ANONYMOUS_ACTOR);
  await expect(listUsers(anon)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  const seen = await listUsers(t.member);
  expect(seen.data.filter((u) => u.id !== t.member.actor.id).every((u) => u.email === null)).toBe(
    true,
  );
});
```

Adjust `listIssues` and `listUsers` call shapes to their real signatures.

- [ ] **Step 2: Run them to make sure they fail.** Run `pnpm vitest run --project core src/visibility.test.ts`. Expected: FAIL.

- [ ] **Step 3: Filter projects.** In `listProjects`, apply the readable pattern on `id`.

- [ ] **Step 4: Filter issue queries.** In `queryIssues`, when `params.projectId` is undefined, apply it on `i.project_id`. In `resolveFilterRefs`, when `projectId` is undefined, compute `readable` once at the top and add `.where('project_id', 'in', readable)` to the status and label lookups (`1 = 0` when the list is empty, nothing for `'all'`).

- [ ] **Step 5: Filter events.** In `listEvents`, apply it on `e.project_id` as:

```ts
const readable = await readableProjectIds(ctx, ctx.db.kysely);
if (readable !== 'all') {
  const signedIn = ctx.actor.kind !== 'anonymous';
  q = q.where((eb) => {
    const visible = [];
    if (readable.length) visible.push(eb('e.project_id', 'in', readable));
    if (signedIn) visible.push(eb('e.project_id', 'is', null)); // user.* events
    return visible.length ? eb.or(visible) : sql<boolean>`1 = 0`;
  });
}
```

- [ ] **Step 6: Filter links.** `linksOf(db, issueId)` gains a `ctx` parameter. After the query, drop rows whose other issue's project isn't readable. Select `o.project_id as other_project_id` and filter with `readable === 'all' || readable.includes(r.other_project_id)`. `createLink` still returns the created link because its caller passed the `read` check on the target.

- [ ] **Step 7: Users.** In `listUsers` and `getUser`, start with `if (isAnonymous(ctx)) throw new DomainError('UNAUTHENTICATED', 'Sign in to see users');`. Map results through:

```ts
const redact = (u: User): User =>
  ctx.actor.role === 'admin' || u.id === ctx.actor.id ? u : { ...u, email: null };
```

- [ ] **Step 8: Run the tests.** Run `pnpm test` and `pnpm test:pg`. Expected: PASS.

- [ ] **Step 9: Commit.**

```bash
git add packages/core
git commit -m "feat(core): filter cross-project reads by readable projects; private user emails"
```

### Task 7: Membership services, visibility changes and `myAccess`

**Files:**

- Create: `packages/core/src/services/members.ts`, `packages/core/src/services/members.test.ts`
- Modify: `packages/core/src/services/projects.ts`, `packages/core/src/index.ts`

**Interfaces:**

- Consumes: `getProjectRow`, `getUserRow`, `projectLevel`, `recordEvent`.
- Produces:

```ts
export async function listMembers(
  ctx: ServiceContext,
  projectRef: string,
): Promise<ProjectMember[]>; // read
export async function addMember(
  ctx: ServiceContext,
  projectRef: string,
  input: AddProjectMemberInput,
): Promise<ProjectMember>; // manage; CONFLICT if already a member
export async function updateMember(
  ctx: ServiceContext,
  projectRef: string,
  userRef: string,
  input: UpdateProjectMemberInput,
): Promise<ProjectMember>; // manage
export async function removeMember(
  ctx: ServiceContext,
  projectRef: string,
  userRef: string,
): Promise<void>; // manage
// projects.ts: listProjects/getProject/createProject/updateProject now return ProjectWithAccess
```

- [ ] **Step 1: Write the failing tests.** Create `members.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDialect } from '@poietic-tech/issues-db/testing';
import { addMember, listMembers, removeMember, updateMember } from './members.ts';
import { createProject, getProject, updateProject } from './projects.ts';
import { listEvents } from './events.ts';
import { createTestContext, grant, type TestContext } from '../testing.ts';

describe(`project members (${testDialect()})`, () => {
  let t: TestContext;
  beforeAll(async () => {
    t = await createTestContext();
    await createProject(t.ctx, { key: 'ENG', name: 'Eng' });
  });
  afterAll(() => t.destroy());

  it('lets admins and managers manage members, with events', async () => {
    const m = await addMember(t.ctx, 'ENG', { user: '@member', role: 'viewer' });
    expect(m).toMatchObject({ user: { handle: 'member' }, role: 'viewer' });
    await expect(
      addMember(t.ctx, 'ENG', { user: '@member', role: 'editor' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      addMember(t.member, 'ENG', { user: '@bot', role: 'viewer' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await updateMember(t.ctx, 'ENG', '@member', { role: 'manager' });
    await addMember(t.member, 'ENG', { user: '@bot', role: 'editor' });
    expect((await listMembers(t.member, 'ENG')).map((x) => [x.user.handle, x.role])).toEqual([
      ['bot', 'editor'],
      ['member', 'manager'],
    ]);
    await removeMember(t.member, 'ENG', '@bot');
    const types = (
      await listEvents(t.ctx, {
        types: ['project.member_added', 'project.member_changed', 'project.member_removed'],
      })
    ).data.map((e) => e.type);
    expect(types).toEqual([
      'project.member_added',
      'project.member_changed',
      'project.member_added',
      'project.member_removed',
    ]);
  });

  it('reports myAccess and lets only managers change visibility', async () => {
    expect((await getProject(t.member, 'ENG')).myAccess).toBe('manage');
    await grant(t, 'ENG', t.agent, 'editor');
    await expect(updateProject(t.agent, 'ENG', { visibility: 'public' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect((await updateProject(t.member, 'ENG', { visibility: 'public' })).visibility).toBe(
      'public',
    );
  });
});
```

- [ ] **Step 2: Run them to make sure they fail.** Run `pnpm vitest run --project core src/services/members.test.ts`. Expected: FAIL, because `./members.ts` doesn't exist.

- [ ] **Step 3: Write `members.ts`.**

```ts
import { withWriteTx } from '@poietic-tech/issues-db';
import {
  type AddProjectMemberInput,
  AddProjectMemberInputSchema,
  type ProjectMember,
  type UpdateProjectMemberInput,
  UpdateProjectMemberInputSchema,
} from '@poietic-tech/issues-schema';
import { nowIso, type ServiceContext } from '../context.ts';
import { conflict, notFound, parseInput } from '../errors.ts';
import { recordEvent } from '../events.ts';
import { getProjectRow, getUserRow } from '../refs.ts';

type Exec = ServiceContext['db']['kysely'];

async function memberRows(db: Exec, projectId: string, userId?: string) {
  let q = db
    .selectFrom('project_members as m')
    .innerJoin('users as u', 'u.id', 'm.user_id')
    .select([
      'm.role',
      'm.created_at',
      'm.updated_at',
      'u.id',
      'u.handle',
      'u.name',
      'u.kind',
      'u.avatar_url',
    ])
    .where('m.project_id', '=', projectId)
    .orderBy('u.handle');
  if (userId) q = q.where('m.user_id', '=', userId);
  return (await q.execute()).map((r): ProjectMember => ({
    user: { id: r.id, handle: r.handle, name: r.name, kind: r.kind, avatarUrl: r.avatar_url },
    role: r.role,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export async function listMembers(
  ctx: ServiceContext,
  projectRef: string,
): Promise<ProjectMember[]> {
  const project = await getProjectRow(ctx, ctx.db.kysely, projectRef, 'read');
  return memberRows(ctx.db.kysely, project.id);
}

export async function addMember(
  ctx: ServiceContext,
  projectRef: string,
  input: AddProjectMemberInput,
) {
  const data = parseInput(AddProjectMemberInputSchema, input);
  return withWriteTx(ctx.db, async (tx) => {
    const project = await getProjectRow(ctx, tx, projectRef, 'manage');
    const user = await getUserRow(ctx, tx, data.user);
    const existing = await memberRows(tx, project.id, user.id);
    if (existing.length) throw conflict(`@${user.handle} is already a member of ${project.key}`);
    const now = nowIso(ctx);
    await tx
      .insertInto('project_members')
      .values({
        project_id: project.id,
        user_id: user.id,
        role: data.role,
        created_at: now,
        updated_at: now,
      })
      .execute();
    const [member] = await memberRows(tx, project.id, user.id);
    await recordEvent(tx, ctx, 'project.member_added', { projectId: project.id, data: { member } });
    return member!;
  });
}

export async function updateMember(
  ctx: ServiceContext,
  projectRef: string,
  userRef: string,
  input: UpdateProjectMemberInput,
) {
  const data = parseInput(UpdateProjectMemberInputSchema, input);
  return withWriteTx(ctx.db, async (tx) => {
    const project = await getProjectRow(ctx, tx, projectRef, 'manage');
    const user = await getUserRow(ctx, tx, userRef);
    const [before] = await memberRows(tx, project.id, user.id);
    if (!before) throw notFound('Member', userRef);
    await tx
      .updateTable('project_members')
      .set({ role: data.role, updated_at: nowIso(ctx) })
      .where('project_id', '=', project.id)
      .where('user_id', '=', user.id)
      .execute();
    const [member] = await memberRows(tx, project.id, user.id);
    await recordEvent(tx, ctx, 'project.member_changed', {
      projectId: project.id,
      data: { member, previousRole: before.role },
    });
    return member!;
  });
}

export async function removeMember(ctx: ServiceContext, projectRef: string, userRef: string) {
  await withWriteTx(ctx.db, async (tx) => {
    const project = await getProjectRow(ctx, tx, projectRef, 'manage');
    const user = await getUserRow(ctx, tx, userRef);
    const [member] = await memberRows(tx, project.id, user.id);
    if (!member) throw notFound('Member', userRef);
    await tx
      .deleteFrom('project_members')
      .where('project_id', '=', project.id)
      .where('user_id', '=', user.id)
      .execute();
    await recordEvent(tx, ctx, 'project.member_removed', {
      projectId: project.id,
      data: { member },
    });
  });
}
```

Export it from `index.ts` with `export * from './services/members.ts';`.

- [ ] **Step 4: Add `myAccess` and the visibility check.** In `projects.ts`:

```ts
async function withAccess(
  ctx: ServiceContext,
  db: Exec,
  row: Selectable<Database['projects']>,
): Promise<ProjectWithAccess> {
  const level = await projectLevel(ctx, db, row);
  return { ...toProject(row), myAccess: level === 'none' ? 'read' : level };
}
```

(`none` can't occur after a successful lookup or filter; it maps to `read` only to satisfy the type.)

- `listProjects` returns `Promise.all(rows.map((r) => withAccess(ctx, db, r)))`.
- `getProject` returns `withAccess`.
- `createProject` and `updateProject` return `withAccess` of the updated row.
- In `updateProject`:
  - require `'manage'` when `patch.visibility`, `patch.name` or `patch.description` is set;
  - add `...(patch.visibility !== undefined && { visibility: patch.visibility })` to the `set`;
  - add `'visibility'` to the `diff` keys.
- Events keep using `toProject(updated)` (no `myAccess`).

- [ ] **Step 5: Run the tests.** Run `pnpm test` and `pnpm test:pg`. Expected: PASS. Fix any callers that read `Project` and now get `ProjectWithAccess`; it's a superset, so it should be type-compatible.

- [ ] **Step 6: Commit.**

```bash
git add packages/core packages/schema
git commit -m "feat(core): project membership services, visibility changes and myAccess"
```

### Task 8: HTTP: anonymous requests, `/me` and the live stream

**Files:**

- Modify:
  - `apps/server/src/middleware/auth.ts`
  - `apps/server/src/app.ts`
  - `apps/server/src/routes/auth.ts` (`/me`)
  - `apps/server/src/routes/stream.ts`
  - `apps/server/src/routes/projects.ts` (response schemas `ProjectWithAccess`)
  - `packages/schema/src/entities.ts` (`MeSchema`)
- Create: `apps/server/src/access.test.ts`

**Interfaces:**

- Consumes: `ANONYMOUS_ACTOR`, `readableProjectIds`.
- Produces:
  - `MeSchema = z.union([UserSchema, z.object({ anonymous: z.literal(true) }).meta({ id: 'AnonymousMe' })]).meta({ id: 'Me' })`;
  - with no credentials, `c.get('ctx').actor === ANONYMOUS_ACTOR`;
  - unsafe methods without an actor get 401.

- [ ] **Step 1: Write the failing tests.** Create `apps/server/src/access.test.ts`. Copy the app and fixture setup from an existing server test (`api.test.ts` shows how to create the app over a test database and get an admin token). Then:

```ts
it('treats requests without credentials as anonymous, never as admin', async () => {
  // admin creates PUB (public) and PRV (private) via the API with the admin token
  const me = await app.request(`${BASE}/api/v1/me`);
  expect(me.status).toBe(200);
  expect(await me.json()).toEqual({ anonymous: true });
  expect((await app.request(`${BASE}/api/v1/projects`)).status).toBe(200);
  const list = (await (await app.request(`${BASE}/api/v1/projects`)).json()) as {
    data: { key: string; myAccess: string }[];
  };
  expect(list.data.map((p) => [p.key, p.myAccess])).toEqual([['PUB', 'read']]);
  expect((await app.request(`${BASE}/api/v1/projects/PRV`)).status).toBe(404);
  expect((await app.request(`${BASE}/api/v1/users`)).status).toBe(401);
  const post = await app.request(`${BASE}/api/v1/projects/PUB/issues`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ title: 'x' }),
  });
  expect(post.status).toBe(401);
  const admin = await app.request(`${BASE}/api/v1/webhooks`);
  expect(admin.status).not.toBe(200);
});
```

Match the real issue-create path in `routes/issues.ts`.

- [ ] **Step 2: Run them to make sure they fail.** Run `pnpm vitest run --project server src/access.test.ts`. Expected: FAIL (`/me` returns 401).

- [ ] **Step 3: Use the anonymous actor.** In `middleware/auth.ts`:
  - Change `actor: actor ?? SYSTEM_ACTOR` to `actor: actor ?? ANONYMOUS_ACTOR`. Keep `SYSTEM_ACTOR` for trusted mode, where `actor` is always set.
  - Change `requireActor` to:

```ts
/** Anonymous requests may read (core decides what is visible, ADR 0021); everything else needs a user. */
export const requireActor = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get('actor') && c.req.method !== 'GET' && c.req.method !== 'HEAD')
    return problem(
      c,
      'UNAUTHENTICATED',
      'Authenticate with "Authorization: Bearer <token>" or sign in',
    );
  await next();
});
```

Check `routes/auth.ts` `/auth/*` handlers that read `ctx.actor`: they previously got `SYSTEM_ACTOR` when signed out, and must still work with the anonymous actor. Grep for `ctx.actor` in `routes/auth.ts` and `services/sso.ts`. `signInWithSso` creates users and must keep running with a privileged actor: if it uses `ctx`, call it with `withActor(ctx, SYSTEM_ACTOR)`.

- [ ] **Step 4: `/me`.** Add `MeSchema` to `entities.ts`, then change the `/me` route's response to `json(MeSchema, 'Current user, or { anonymous: true }')` and its handler to:

```ts
async (c) => {
  const ctx = c.get('ctx');
  if (isAnonymous(ctx)) return c.json({ anonymous: true as const }, 200);
  return c.json(await getUser(ctx, ctx.actor.id), 200);
},
```

- [ ] **Step 5: Project response schemas.** In `routes/projects.ts`, use `ProjectWithAccessSchema` for the list, get, create and update responses. Add `visibility` to the route descriptions, and mark update "Name, description and visibility need manage".

- [ ] **Step 6: Live stream.** In `routes/stream.ts`, replace `matches`:

```ts
let readable = await readableProjectIds(ctx, ctx.db.kysely);
const canSee = (e: TrackerEvent) =>
  e.projectId === null ? !isAnonymous(ctx) : readable === 'all' || readable.includes(e.projectId);
const matches = (e: TrackerEvent) => (!projectId || e.projectId === projectId) && canSee(e);
```

In the subscribe callback, before `matches(e)`, refresh when access may have changed:

```ts
if (e.type.startsWith('project.member_') || e.type === 'project.updated')
  void readableProjectIds(ctx, ctx.db.kysely).then((r) => {
    readable = r;
  });
```

Replay already goes through `listEvents`, which filters since Task 6.

- [ ] **Step 7: Regenerate the contract and run the tests.** Run `pnpm openapi:gen`, `pnpm vitest run --project server`, then `pnpm test` and `pnpm test:pg`. Expected: PASS.

- [ ] **Step 8: Commit.**

```bash
git add apps/server packages/schema docs/openapi.json packages/client/src/generated
git commit -m "feat(server): anonymous read access, /me for signed-out visitors, filtered live stream"
```

### Task 9: ADR 0021 and docs, then PR 1

**Files:**

- Create: `docs/adr/0021-project-visibility-and-roles.md`
- Modify: `docs/adr/README.md`, `docs/adr/0009-auth-v1.md` (consequence line), `docs/agents.md`, `docs/deployment.md`, `docs/security.md`

- [ ] **Step 1: Write ADR 0021.** Use the template in `docs/adr/0000-template.md`, with status `Accepted` and date `2026-10-08`.
  - **Context:** ADR 0009's "every member can act on every project"; the need for public read access and private projects.
  - **Decision:**
    - the levels and roles table from the spec (§2);
    - 404 for unreadable projects;
    - enforcement in core;
    - the anonymous actor and `GET`/`HEAD`-only anonymous requests;
    - the migration backfill;
    - the five plan deviations above.
  - **Consequences:**
    - agents need memberships;
    - users created after the upgrade start with none;
    - admins see everything;
    - links into unreadable projects are hidden.
- [ ] **Step 2: Update the ADR index and ADR 0009.** Add the row to `docs/adr/README.md`. In ADR 0009, change the consequence line to: "There is no per-project permission model yet. Every member can act on every project. _(Superseded by [ADR 0021](0021-project-visibility-and-roles.md).)_"
- [ ] **Step 3: Update the guides.**
  - `docs/agents.md`: "Give every agent user a role on each private project it works in: `poietic-issues project members add <KEY> @agent --role editor`." Mark the command as available from Task 13.
  - `docs/security.md`: anonymous read access to public projects, 404 for private ones, and email visibility.
  - `docs/deployment.md`: what migration 0004 does on upgrade.
- [ ] **Step 4: Check and commit.** Run `pnpm format` and `pnpm check`, then:

```bash
git add docs
git commit -m "docs: ADR 0021 project visibility and roles"
```

- [ ] **Step 5: Open PR 1.** Push the branch and open a PR titled "Project visibility and roles: access core", without attribution lines. Wait for review before starting PR 2. Branch PR 2 from PR 1's branch if PR 1 hasn't merged yet.

---

# PR 2: Repo links

### Task 10: Repo services and `Project.repos`

**Files:**

- Create: `packages/core/src/services/repos.ts`, `packages/core/src/services/repos.test.ts`
- Modify:
  - `packages/schema/src/entities.ts` (`ProjectRepoSchema`, `AddProjectRepoInputSchema`, `Project.repos`)
  - `packages/schema/src/events.ts` (`project.repo_added`, `project.repo_removed`)
  - `packages/core/src/mappers.ts`, `packages/core/src/services/projects.ts`, `packages/core/src/index.ts`

**Interfaces:**

- Produces:

```ts
// schema
export const ProjectRepoSchema: {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  url: string;
  createdAt: string;
}; // meta id 'ProjectRepo'
export const AddProjectRepoInputSchema: { repo: string }; // meta id 'AddProjectRepoInput'
// Project gains repos: ProjectRepo[]
// core
export function parseRepoRef(input: string): { owner: string; name: string }; // throws VALIDATION_FAILED
export async function addRepo(
  ctx: ServiceContext,
  projectRef: string,
  input: AddProjectRepoInput,
): Promise<ProjectRepo>; // manage; CONFLICT on duplicate
export async function removeRepo(
  ctx: ServiceContext,
  projectRef: string,
  repoRef: string,
): Promise<void>; // manage; repoRef = rpo_ id or owner/name
export async function reposOf(db: Exec, projectIds: string[]): Promise<Map<string, ProjectRepo[]>>;
```

- [ ] **Step 1: Write the failing tests.** Create `repos.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDialect } from '@poietic-tech/issues-db/testing';
import { addRepo, parseRepoRef, removeRepo } from './repos.ts';
import { createProject, getProject } from './projects.ts';
import { createIssue, getIssue } from './issues.ts';
import { createTestContext, type TestContext } from '../testing.ts';

describe('parseRepoRef', () => {
  it.each([
    ['acme/app', { owner: 'acme', name: 'app' }],
    ['https://github.com/acme/app', { owner: 'acme', name: 'app' }],
    ['https://github.com/acme/app.git', { owner: 'acme', name: 'app' }],
    ['github.com/acme/app/pull/12', { owner: 'acme', name: 'app' }],
  ])('parses %s', (input, expected) => expect(parseRepoRef(input)).toEqual(expected));
  it.each(['acme', 'https://gitlab.com/acme/app', 'acme/app/extra?x', '-bad/app', 'acme/ap p'])(
    'rejects %s',
    (input) => expect(() => parseRepoRef(input)).toThrow(/repository/i),
  );
});

describe(`repo links (${testDialect()})`, () => {
  let t: TestContext;
  beforeAll(async () => {
    t = await createTestContext();
    await createProject(t.ctx, { key: 'ENG', name: 'Eng' });
  });
  afterAll(() => t.destroy());

  it('adds, lists and removes repos; removing clears issues', async () => {
    const repo = await addRepo(t.ctx, 'ENG', { repo: 'https://github.com/Acme/App' });
    expect(repo).toMatchObject({
      owner: 'Acme',
      name: 'App',
      fullName: 'Acme/App',
      url: 'https://github.com/Acme/App',
    });
    await expect(addRepo(t.ctx, 'ENG', { repo: 'acme/app' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect((await getProject(t.ctx, 'ENG')).repos.map((r) => r.fullName)).toEqual(['Acme/App']);
    await createIssue(t.ctx, 'ENG', { title: 'x', repo: 'acme/app' });
    expect((await getIssue(t.ctx, 'ENG-1')).repo).toBe('Acme/App');
    await removeRepo(t.ctx, 'ENG', 'acme/app');
    expect((await getIssue(t.ctx, 'ENG-1')).repo).toBeNull();
  });
});
```

The `repo` issue assertions pass only after Task 11. Mark that `it` with `it.todo` here and restore it in Task 11 Step 1.

- [ ] **Step 2: Run them to make sure they fail.** Run `pnpm vitest run --project core src/services/repos.test.ts`. Expected: FAIL.

- [ ] **Step 3: Add the schema.** In `entities.ts`:

```ts
export const ProjectRepoSchema = z
  .object({
    id: z.string().meta({ example: 'rpo_01h455vb4pex5vsknk084sn02q' }),
    owner: z.string().meta({ example: 'acme' }),
    name: z.string().meta({ example: 'app' }),
    fullName: z.string().meta({ example: 'acme/app' }),
    url: z.string().meta({ example: 'https://github.com/acme/app' }),
    createdAt: TimestampSchema,
  })
  .meta({ id: 'ProjectRepo' });
export type ProjectRepo = z.infer<typeof ProjectRepoSchema>;

export const AddProjectRepoInputSchema = z
  .object({
    repo: z
      .string()
      .meta({ description: '`owner/name` or a github.com URL.', example: 'acme/app' }),
  })
  .meta({ id: 'AddProjectRepoInput' });
export type AddProjectRepoInput = z.input<typeof AddProjectRepoInputSchema>;
```

Declare `ProjectRepoSchema` before `ProjectSchema`, then add `repos: z.array(ProjectRepoSchema)` to `ProjectSchema` after `visibility`. Add `project.repo_added` and `project.repo_removed` to `EVENT_TYPES`, with `ProjectRepoEventDataSchema = z.object({ ...base, repo: ProjectRepoSchema }).meta({ id: 'ProjectRepoEventData' })`.

- [ ] **Step 4: Write `repos.ts`.**

```ts
import { withWriteTx, type Database, type Kysely } from '@poietic-tech/issues-db';
import {
  type AddProjectRepoInput,
  AddProjectRepoInputSchema,
  isIdOf,
  type ProjectRepo,
} from '@poietic-tech/issues-schema';
import { sql } from 'kysely';
import { nowIso, type ServiceContext } from '../context.ts';
import { conflict, isUniqueViolation, notFound, parseInput, validationError } from '../errors.ts';
import { recordEvent } from '../events.ts';
import { getProjectRow } from '../refs.ts';

type Exec = Kysely<Database>;
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NAME = /^[A-Za-z0-9._-]{1,100}$/;

/** `owner/name`, or any github.com URL under the repository, reduced to owner and name. */
export function parseRepoRef(input: string): { owner: string; name: string } {
  const trimmed = input
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '');
  const path = trimmed.startsWith('github.com/') ? trimmed.slice('github.com/'.length) : trimmed;
  if (/^[^/]+\.[^/]+\//.test(trimmed) && !trimmed.startsWith('github.com/'))
    throw validationError(`Not a GitHub repository: "${input}"`);
  const [owner, rawName, ...rest] = path.split('/');
  const name = rawName?.replace(/\.git$/, '');
  const urlForm = trimmed.startsWith('github.com/');
  if (!owner || !name || !OWNER.test(owner) || !NAME.test(name) || (!urlForm && rest.length))
    throw validationError(
      `Not a GitHub repository: "${input}" (expected owner/name or a github.com URL)`,
    );
  return { owner, name };
}

export function toRepo(r: {
  id: string;
  owner: string;
  name: string;
  created_at: string;
}): ProjectRepo {
  const fullName = `${r.owner}/${r.name}`;
  return {
    id: r.id,
    owner: r.owner,
    name: r.name,
    fullName,
    url: `https://github.com/${fullName}`,
    createdAt: r.created_at,
  };
}

export async function reposOf(db: Exec, projectIds: string[]): Promise<Map<string, ProjectRepo[]>> {
  const out = new Map<string, ProjectRepo[]>(projectIds.map((id) => [id, []]));
  if (!projectIds.length) return out;
  const rows = await db
    .selectFrom('project_repos')
    .selectAll()
    .where('project_id', 'in', projectIds)
    .orderBy(sql`lower(owner)`)
    .orderBy(sql`lower(name)`)
    .execute();
  for (const r of rows) out.get(r.project_id)?.push(toRepo(r));
  return out;
}

export async function findRepo(db: Exec, projectId: string, ref: string) {
  const q = db.selectFrom('project_repos').selectAll().where('project_id', '=', projectId);
  if (isIdOf('projectRepo', ref)) return q.where('id', '=', ref).executeTakeFirst();
  const { owner, name } = parseRepoRef(ref);
  return q
    .where(sql`lower(owner)`, '=', owner.toLowerCase())
    .where(sql`lower(name)`, '=', name.toLowerCase())
    .executeTakeFirst();
}

export async function addRepo(ctx: ServiceContext, projectRef: string, input: AddProjectRepoInput) {
  const data = parseInput(AddProjectRepoInputSchema, input);
  const { owner, name } = parseRepoRef(data.repo);
  try {
    return await withWriteTx(ctx.db, async (tx) => {
      const project = await getProjectRow(ctx, tx, projectRef, 'manage');
      const row = await tx
        .insertInto('project_repos')
        .values({
          id: ctx.ids('projectRepo'),
          project_id: project.id,
          owner,
          name,
          created_at: nowIso(ctx),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      const repo = toRepo(row);
      await recordEvent(tx, ctx, 'project.repo_added', { projectId: project.id, data: { repo } });
      return repo;
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw conflict(`${owner}/${name} is already linked to this project`);
    throw error;
  }
}

export async function removeRepo(ctx: ServiceContext, projectRef: string, repoRef: string) {
  await withWriteTx(ctx.db, async (tx) => {
    const project = await getProjectRow(ctx, tx, projectRef, 'manage');
    const row = await findRepo(tx, project.id, repoRef);
    if (!row) throw notFound('Repository', repoRef);
    const issueIds = (
      await tx.selectFrom('issues').select('id').where('repo_id', '=', row.id).execute()
    ).map((r) => r.id);
    // Clear through the issue update path so each change records issue.updated (Task 11 adds `repo`).
    for (const id of issueIds) await clearIssueRepo(ctx, tx, id);
    await tx.deleteFrom('project_repos').where('id', '=', row.id).execute();
    await recordEvent(tx, ctx, 'project.repo_removed', {
      projectId: project.id,
      data: { repo: toRepo(row) },
    });
  });
}
```

`clearIssueRepo` is defined in Task 11 (`services/issues.ts`). Until then, define it locally as a direct `updateTable('issues').set({ repo_id: null, version: sql\`version + 1\`, updated_at: nowIso(ctx) })`. Task 11 Step 5 replaces it with the version that records events.

- [ ] **Step 5: Add `repos` to projects.** `toProject(r, repos: ProjectRepo[] = [])` adds `repos`.
  - Every caller that has a database handle loads the repos with `reposOf`. In `projects.ts`, `withAccess` and `listProjects` call `reposOf(db, ids)` once.
  - Event payloads built inside transactions also pass `(await reposOf(tx, [id])).get(id)`.
  - Export `repos.ts` from `index.ts`.

- [ ] **Step 6: Run the tests.** Run `pnpm vitest run --project core` and `pnpm test:pg`. Expected: PASS, apart from the `it.todo`.

- [ ] **Step 7: Commit.**

```bash
git add packages/core packages/schema
git commit -m "feat(core): link GitHub repositories to projects"
```

### Task 11: The `repo` issue field

**Files:**

- Modify:
  - `packages/schema/src/entities.ts` (`Issue.repo`, inputs)
  - `packages/schema/src/fields.ts` (`CORE_FIELDS`, a new field type `repo`)
  - `packages/core/src/issue-query.ts` (`loadIssues`, `SCALAR_COLUMNS`, `resolveFilterRefs`)
  - `packages/core/src/services/issues.ts` (create, update, move, `clearIssueRepo`)
  - `packages/core/src/services/repos.ts`
  - `packages/core/src/services/repos.test.ts`

**Interfaces:**

- Produces:
  - `Issue.repo: string | null` (`owner/name` as stored)
  - `CreateIssueInput.repo?: string | null`, `UpdateIssueInput.repo?: string | null`
  - field `{ key: 'repo', type: 'repo', filterOps: ['eq', 'neq', 'in', 'nin', 'isNull'], groupable: true, sortable: false }`
  - `export async function clearIssueRepo(ctx: ServiceContext, tx: Tx, issueId: string): Promise<void>` in `services/issues.ts`

- [ ] **Step 1: Restore the test and add filter and move cases.** In `repos.test.ts`, turn the `it.todo` back into the full test from Task 10, then add:

```ts
it('filters by repo and clears it when an issue moves projects', async () => {
  const { listIssues, moveIssue } = await import('./issues.ts');
  await addRepo(t.ctx, 'ENG', { repo: 'acme/web' });
  await createIssue(t.ctx, 'ENG', { title: 'web bug', repo: 'acme/web' });
  const found = await listIssues(t.ctx, {
    project: 'ENG',
    filter: { conditions: [{ field: 'repo', op: 'eq', value: 'acme/web' }] },
  });
  expect(found.data.map((i) => i.title)).toEqual(['web bug']);
  await expect(
    createIssue(t.ctx, 'ENG', { title: 'bad', repo: 'other/repo' }),
  ).rejects.toMatchObject({ code: 'INVALID_RELATION' });
  await createProject(t.ctx, { key: 'OPS', name: 'Ops' });
  const moved = await moveIssue(t.ctx, found.data[0]!.key, { project: 'OPS' });
  expect(moved.repo).toBeNull();
});
```

Match `moveIssue`'s real input shape (`MoveIssueInputSchema`).

- [ ] **Step 2: Run them to make sure they fail.** Run `pnpm vitest run --project core src/services/repos.test.ts`. Expected: FAIL (`repo` is unknown).

- [ ] **Step 3: Schema.**
  - Add `repo: z.string().nullable().meta({ description: 'Linked GitHub repository (`owner/name`), one of the project\'s repos.', example: 'acme/app' })` to `IssueSchema` after `parent`.
  - Add `repo: z.string().nullable().meta({ description: 'One of the project\'s repos (`owner/name`, URL or id), or null.' })` to `issueWritable`.
  - Add `repo: issueWritable.repo.optional()` to `CreateIssueInputSchema`.
  - In `fields.ts`, add `'repo'` to `FieldType` and append to `CORE_FIELDS` after `parent`:

```ts
field({
  key: 'repo',
  label: 'Repository',
  type: 'repo',
  sortable: false,
  groupable: true,
  filterOps: NULLABLE_EQUALITY,
  displayable: true,
  get: (i) => i.repo,
}),
```

(Use `SET` instead of `NULLABLE_EQUALITY` if `in`/`nin` aren't in `NULLABLE_EQUALITY`.)

- [ ] **Step 4: Query layer.**
  - In `loadIssues`, add `.leftJoin('project_repos as rp', 'rp.id', 'i.repo_id')`, select `'rp.owner as repo_owner'` and `'rp.name as repo_name'`, and map `repo: r.repo_owner ? \`${r.repo_owner}/${r.repo_name}\` : null`.
  - Add `repo: sql.ref('i.repo_id')` to `SCALAR_COLUMNS`.
  - In `resolveFilterRefs`, add:

```ts
case 'repo': {
  if (isIdOf('projectRepo', v)) return [v];
  const { owner, name } = parseRepoRef(v);
  let q = db
    .selectFrom('project_repos')
    .select('id')
    .where(sql`lower(owner)`, '=', owner.toLowerCase())
    .where(sql`lower(name)`, '=', name.toLowerCase());
  if (projectId) q = q.where('project_id', '=', projectId);
  else if (readable !== 'all') q = readable.length ? q.where('project_id', 'in', readable) : q.where(sql<boolean>`1 = 0`);
  const ids = (await q.execute()).map((r) => r.id);
  if (!ids.length) throw validationError(`Unknown repository "${v}"`);
  return ids;
}
```

(`readable` is the value computed at the top of the function in Task 6.)

- [ ] **Step 5: Services.**
  - In `createIssue` and `updateIssueInTx`, resolve `data.repo`:
    - `null` clears it;
    - a string goes through `findRepo(tx, project.id, data.repo)`, and if no row is found, `throw invalidRelation(\`"${data.repo}" is not linked to project ${project.key}\`)`;
    - write `repo_id`;
    - include `'repo'` in the `diff` keys so `issue.updated` records it.
  - In `moveIssue`, set `repo_id: null` when the project changes.
  - Implement `clearIssueRepo(ctx, tx, issueId)` by calling `updateIssueInTx(ctx, tx, issueId, { repo: null })`, then delete the temporary version from `repos.ts` and import this one.
  - `updateIssueInTx` looks up the issue with `'write'`. `removeRepo` already holds `manage`, so this passes.

- [ ] **Step 6: Run the tests.** Run `pnpm test` and `pnpm test:pg`. Expected: PASS.

- [ ] **Step 7: Commit, then open PR 2.**

```bash
git add packages/schema packages/core
git commit -m "feat(core): issues can name one of their project's repos"
```

Open PR 2, "Project repo links", stacked on PR 1.

---

# PR 3: API and CLI

### Task 12: Member and repo routes

**Files:**

- Create: `apps/server/src/routes/members.ts`
- Modify: `apps/server/src/app.ts` (register), `apps/server/src/access.test.ts`

**Interfaces:**

- Consumes: `listMembers`, `addMember`, `updateMember`, `removeMember`, `addRepo`, `removeRepo`.
- Produces these routes, all under `/api/v1`:

| Method and path                             | Response                                              |
| ------------------------------------------- | ----------------------------------------------------- |
| `GET /projects/{project}/members`           | `{ data: ProjectMember[] }`                           |
| `POST /projects/{project}/members`          | 201 `ProjectMember`                                   |
| `PATCH /projects/{project}/members/{user}`  | 200 `ProjectMember`                                   |
| `DELETE /projects/{project}/members/{user}` | 204                                                   |
| `POST /projects/{project}/repos`            | 201 `ProjectRepo`                                     |
| `DELETE /projects/{project}/repos/{repo}`   | 204 (`repo` = `rpo_…` id or `owner/name` URL-encoded) |

- [ ] **Step 1: Write the failing test.** Append to `apps/server/src/access.test.ts`:

```ts
it('manages members and repos over HTTP', async () => {
  const add = await call(
    'POST',
    '/projects/PRV/members',
    { user: '@member', role: 'viewer' },
    adminToken,
  );
  expect(add.status).toBe(201);
  expect((await call('GET', '/projects/PRV', undefined, memberToken)).status).toBe(200);
  expect(
    (await call('POST', '/projects/PRV/repos', { repo: 'acme/app' }, memberToken)).status,
  ).toBe(403);
  expect((await call('POST', '/projects/PRV/repos', { repo: 'acme/app' }, adminToken)).status).toBe(
    201,
  );
  expect(
    (
      await call(
        'DELETE',
        `/projects/PRV/repos/${encodeURIComponent('acme/app')}`,
        undefined,
        adminToken,
      )
    ).status,
  ).toBe(204);
  expect(
    (await call('DELETE', '/projects/PRV/members/@member', undefined, adminToken)).status,
  ).toBe(204);
  expect((await call('GET', '/projects/PRV', undefined, memberToken)).status).toBe(404);
});
```

Use the `call` helper pattern from `api.test.ts`, with a member token created through `POST /users/{user}/tokens` as admin.

- [ ] **Step 2: Run it to make sure it fails.** Run `pnpm vitest run --project server src/access.test.ts`. Expected: FAIL (404 on the new paths).

- [ ] **Step 3: Write `routes/members.ts`.** Follow `routes/projects.ts`: `createRoute`, `projectParam`, `json`, `jsonBody`, `errorResponses`, tags `['Project access']`. Each handler is one line calling the core service with `c.get('ctx')`, for example:

```ts
async (c) => c.json(await addMember(c.get('ctx'), c.req.valid('param').project, c.req.valid('json')), 201),
```

For deletes, return `c.body(null, 204)`. Register it in `app.ts` next to `registerProjectRoutes`.

- [ ] **Step 4: Regenerate and run the tests.** Run `pnpm openapi:gen`, `pnpm vitest run --project server`, `pnpm test`. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/server docs/openapi.json packages/client/src/generated
git commit -m "feat(api): project member and repo endpoints"
```

### Task 13: CLI commands

**Files:**

- Create: `apps/cli/src/commands/members.ts`
- Modify:
  - `apps/cli/src/main.ts` (register under the `project` command)
  - `apps/cli/src/commands/admin.ts` (`--visibility` on `project create|edit`)
  - `apps/cli/src/commands/issues.ts` (`--repo`)
  - `apps/cli/src/output.ts` (kinds `member` and `repo`)
  - `apps/cli/src/cli.test.ts`

**Interfaces:**

- Produces these commands:

| Command                                                             | Calls                                                 |
| ------------------------------------------------------------------- | ----------------------------------------------------- |
| `poietic-issues project members list [project]`                     | `GET /projects/{project}/members`                     |
| `poietic-issues project members add [project] <user> --role <role>` | `POST /projects/{project}/members`                    |
| `poietic-issues project members set [project] <user> --role <role>` | `PATCH /projects/{project}/members/{user}`            |
| `poietic-issues project members remove [project] <user>`            | `DELETE /projects/{project}/members/{user}`           |
| `poietic-issues project repo list [project]`                        | prints `project.repos` from `GET /projects/{project}` |
| `poietic-issues project repo add [project] <repo>`                  | `POST /projects/{project}/repos`                      |
| `poietic-issues project repo remove [project] <repo>`               | `DELETE /projects/{project}/repos/{repo}`             |

Also `--visibility public|private` on `project create|edit`, and `--repo <owner/name>` on `issue create|edit` (`--repo ''` clears it).

Where `[project]` is optional it falls back to `rt.project(undefined)`, which uses `-P`, `POIETIC_ISSUES_PROJECT` or `.poietic-issues.json`. For commands that take both a project and a user, make the project a required option `-P` instead, to avoid ambiguous positionals. The CLI already has the global `-P, --project`; use `rt.project(undefined)` and take only `<user>`/`<repo>` as positionals.

- [ ] **Step 1: Write the failing test.** In `apps/cli/src/cli.test.ts`, inside the remote-mode test that has an admin, add:

```ts
const added = await cli([
  'project',
  'members',
  'add',
  '@ada',
  '--role',
  'editor',
  '-P',
  'ENG',
  '--json',
]);
expect(added.code).toBe(0);
expect(added.json()).toMatchObject({ user: { handle: 'ada' }, role: 'editor' });
const repo = await cli([
  'project',
  'repo',
  'add',
  'https://github.com/acme/app',
  '-P',
  'ENG',
  '--json',
]);
expect(repo.json()).toMatchObject({ fullName: 'acme/app' });
const vis = await cli(['project', 'edit', 'ENG', '--visibility', 'public', '--json']);
expect(vis.json()).toMatchObject({ visibility: 'public' });
```

Use whatever user handles and project keys the surrounding test already set up.

- [ ] **Step 2: Run it to make sure it fails.** Run `pnpm vitest run --project cli src/cli.test.ts`. Expected: FAIL ("unknown command 'members'").

- [ ] **Step 3: Implement the commands.** Follow the `project create` pattern in `admin.ts` (`act`, `rt.api()`, `rt.call`, `rt.out.item` / `rt.out.list`). In `output.ts`, add to `Kind` and `COLUMNS`:

```ts
member: [
  ['USER', (r) => handle(r.user)],
  ['ROLE', (r) => r.role],
  ['SINCE', (r) => date(r.createdAt)],
],
repo: [
  ['ID', (r) => r.id],
  ['REPO', (r) => r.fullName],
  ['URL', (r) => r.url],
],
```

Validate `--role` against `viewer|editor|manager` and `--visibility` against `public|private` with Commander's `Option.choices`.

- [ ] **Step 4: Refresh the goldens and run the tests.** Run `pnpm vitest run --project cli -u`, then `pnpm check`. Expected: PASS. Commit the updated `apps/cli/test/commands.golden.json` and `docs/cli-reference.md`.

- [ ] **Step 5: Commit and open PR 3.**

```bash
git add apps/cli docs/cli-reference.md
git commit -m "feat(cli): project members, repos and visibility; --repo on issues"
```

Open PR 3, "Project access: API and CLI".

---

# PR 4: Web app and demo

### Task 14: Anonymous browsing

**Files:**

- Modify:
  - `apps/web/src/lib/queries.ts`
  - `apps/web/src/routes/+layout.svelte` (401 handler)
  - `apps/web/src/routes/(app)/+layout.svelte`
  - `apps/web/src/lib/components/Sidebar.svelte`
  - `apps/web/src/lib/live.svelte.ts`
  - components that read `me.data.role` or `me.data.id`:
    - `Sidebar.svelte:38`
    - `CommandMenu.svelte:210,284`
    - `ActivityTimeline.svelte:188`
    - `(app)/+page.svelte:28`
- Test: `apps/web/e2e/visibility.spec.ts`

**Interfaces:**

- Produces in `queries.ts`:

```ts
export type Me = Schemas['Me'];
export function isSignedIn(me: Me | undefined): me is Schemas['User'];
```

- [ ] **Step 1: Write the failing end-to-end test.** Create `apps/web/e2e/visibility.spec.ts` using the fixtures in `e2e/fixtures.ts`. Read it first: it shows how tests seed data through the API with an admin token and open pages.

```ts
import { expect, test } from './fixtures.ts';

test('anonymous visitors can read a public project but not a private one', async ({
  page,
  api,
  browser,
}) => {
  await api.post('/projects', { key: 'OPEN', name: 'Open', visibility: 'public' });
  await api.post('/projects/OPEN/issues', { title: 'Readable by anyone' });
  await api.post('/projects', { key: 'SHUT', name: 'Shut' });
  const anon = await browser.newContext(); // no session cookie
  const p = await anon.newPage();
  await p.goto('/p/OPEN');
  await expect(p.getByText('Readable by anyone')).toBeVisible();
  await expect(p).not.toHaveURL(/\/login/);
  await expect(p.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expect(p.getByRole('button', { name: /new issue/i })).toHaveCount(0);
  await p.goto('/p/SHUT');
  await expect(p.getByText(/not found/i)).toBeVisible();
  await anon.close();
});
```

Adapt `api` and `browser` to the real fixture names.

- [ ] **Step 2: Run it to make sure it fails.** Run `pnpm e2e -- visibility.spec.ts`. Expected: FAIL, because the page redirects to `/login`.

- [ ] **Step 3: Change the query layer and layouts.**
  - In `queries.ts`, add the `Me` type and the guard:

```ts
export function isSignedIn(me: Me | undefined): me is Schemas['User'] {
  return !!me && !('anonymous' in me);
}
```

- In `(app)/+layout.svelte`:
  - remove the assumption that `me.data` is a user;
  - connect the live stream whenever `me.data` exists (signed in or anonymous), because the server filters what it sends;
  - when `!isSignedIn(me.data)`, show a header button `Sign in` that calls `navigate(\`/login?next=${encodeURIComponent(current().path)}\`)`;
  - hide create-issue and create-project actions and their keyboard shortcuts.
- Replace `me.data.role === 'admin'` with `isSignedIn(me.data) && me.data.role === 'admin'` at each listed call site. Where `me.data.id` is used (personal views, "assigned to me"), skip it when signed out.
- In `routes/+layout.svelte`, the 401 handler still redirects to `/login`. An anonymous visitor only hits 401 when they try a write, which is the right moment to send them there.
- The root page (`(app)/+page.svelte`) with no projects visible while signed out should show "Sign in to see your projects" with a button.

- [ ] **Step 4: Hide write controls by `myAccess`.** Expose `myAccess` from the project query (`useProjectData` in `$lib/project-data.svelte.ts` reads `/projects/{key}`). Add `canWrite = myAccess === 'write' || myAccess === 'manage'` and `canManage = myAccess === 'manage'` to its return value. Gate the issue-editing controls on `canWrite`:
  - `IssueProperties` pickers become read-only text;
  - the `MarkdownEditor` edit button;
  - comment form, attachment upload, link add and sub-issue add;
  - board drag.

  Gate the project settings link on `canManage`. The server stays the authority, so these are cosmetic.

- [ ] **Step 5: Run the end-to-end tests.** Run `pnpm e2e`. Expected: PASS for the new test and all existing tests. Existing tests sign in as admin and have `manage` everywhere.

- [ ] **Step 6: Commit.**

```bash
git add apps/web
git commit -m "feat(web): browse public projects signed out; hide write controls without access"
```

### Task 15: Project settings for visibility, members and repos

**Files:**

- Create: `apps/web/src/lib/components/ProjectAccessSettings.svelte`, `apps/web/src/lib/components/ProjectReposSettings.svelte`
- Modify: `apps/web/src/routes/(app)/p/[key]/settings/+page.svelte`, `apps/web/src/lib/queries.ts` (`keys.members(key)`, `fetchers.members(key)`)
- Test: `apps/web/e2e/visibility.spec.ts`

- [ ] **Step 1: Write the failing end-to-end test.** Append:

```ts
test('a manager makes a project public, adds a repo and a member', async ({ page, api }) => {
  await api.post('/projects', { key: 'CFG', name: 'Config' });
  await page.goto('/p/CFG/settings');
  await page.getByTestId('settings-access').getByRole('radio', { name: 'Public' }).check();
  await expect(page.getByText('Saved')).toBeVisible();
  await page
    .getByTestId('settings-repos')
    .getByPlaceholder('owner/name or GitHub URL')
    .fill('acme/app');
  await page.getByTestId('settings-repos').getByRole('button', { name: 'Link repository' }).click();
  await expect(
    page.getByTestId('settings-repos').getByRole('link', { name: 'acme/app' }),
  ).toHaveAttribute('href', 'https://github.com/acme/app');
  await page.getByTestId('settings-access').getByPlaceholder('@handle').fill('@member');
  await page.getByTestId('settings-access').getByRole('button', { name: 'Add member' }).click();
  await expect(page.getByTestId('settings-access').getByText('@member')).toBeVisible();
});
```

Make sure a user `member` exists in the end-to-end seed (`e2e/server.ts`); add one if not.

- [ ] **Step 2: Run it to make sure it fails.** Run `pnpm e2e -- visibility.spec.ts`. Expected: FAIL (no `settings-access`).

- [ ] **Step 3: Write `ProjectAccessSettings.svelte`.** Follow the structure of the `settings-labels` section in the existing settings page (`run(...)` helper, `btn` / `input` styles, `toast`, `confirmAction` for removal).
  - A `<section data-testid="settings-access">` with:
    - a `<fieldset>` of two radios, Private and Public. Each has a one-line explanation:
      - Private: "Only members and admins can see it."
      - Public: "Anyone with the link can read it, even signed out. Only members can change it."
    - On change, `PATCH /projects/{project}` with `{ visibility }`.
  - A members list from `GET /projects/{key}/members`:
    - each row shows the avatar and `@handle`, a `Select` for the role (`viewer`/`editor`/`manager`, with hints "can read", "can edit issues", "can manage settings and members"), and a remove button;
    - an add form with an `@handle` input, a role `Select` (default `editor`) and an "Add member" button.
  - Invalidate `keys.members(key)` and `keys.project(key)` after each change.

- [ ] **Step 4: Write `ProjectReposSettings.svelte`.** A `<section data-testid="settings-repos">` that lists `project.repos`. Each row has an `<a href={repo.url} target="_blank" rel="noreferrer">{repo.fullName}</a>` and a remove button, with confirmation text: "Issues linked to it lose the link." Below the list is an input with placeholder `owner/name or GitHub URL` and a "Link repository" button that posts `{ repo }`.

- [ ] **Step 5: Wire up the settings page.** Render both components at the top of the settings page, under `<h1>`, only when `canManage`. Viewers and editors who open `/settings` see "Only project managers can change these settings." plus the read-only member list.

- [ ] **Step 6: Run the end-to-end tests.** Run `pnpm e2e`. Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add apps/web
git commit -m "feat(web): project settings for visibility, members and repositories"
```

### Task 16: The repo property on issues

**Files:**

- Create: `apps/web/src/lib/components/RepoPicker.svelte`
- Modify:
  - `apps/web/src/lib/components/IssueProperties.svelte`
  - `apps/web/src/lib/components/FieldValue.svelte` (renderer for type `repo`)
  - `apps/web/src/lib/components/CreateIssueDialog.svelte`
- Test: `apps/web/e2e/visibility.spec.ts`

- [ ] **Step 1: Write the failing end-to-end test.** Append:

```ts
test('an issue can be linked to one of the project repos and filtered by it', async ({
  page,
  api,
}) => {
  await api.post('/projects', { key: 'REP', name: 'Repos' });
  await api.post('/projects/REP/repos', { repo: 'acme/app' });
  await api.post('/projects/REP/issues', { title: 'Needs a repo' });
  await page.goto('/i/REP-1');
  await page.getByRole('button', { name: 'Repository' }).click();
  await page.getByRole('option', { name: 'acme/app' }).click();
  await expect(page.getByRole('link', { name: 'acme/app' })).toHaveAttribute(
    'href',
    'https://github.com/acme/app',
  );
});
```

- [ ] **Step 2: Run it to make sure it fails.** Run `pnpm e2e -- visibility.spec.ts`. Expected: FAIL.

- [ ] **Step 3: Add the picker.** Write `RepoPicker.svelte` on top of the existing `Picker.svelte`, the way `AssigneePicker.svelte` does. Its items are the project's `repos` plus "No repository"; selecting one sends `PATCH` with `{ repo: fullName | null }`.
  - In `IssueProperties.svelte`, add a "Repository" row, hidden when the project has no repos and the issue has none. It's read-only (a link) without `canWrite`.
  - In `FieldValue.svelte`, render type `repo` as a GitHub link.
  - In `CreateIssueDialog.svelte`, add the picker when the project has repos.

- [ ] **Step 4: Run the end-to-end tests.** Run `pnpm e2e`. Expected: PASS. The filter bar picks up `repo` from `CORE_FIELDS` automatically. If it needs a value renderer for type `repo`, add one in `FilterChip.svelte` with the project's repo names as choices.

- [ ] **Step 5: Commit.**

```bash
git add apps/web
git commit -m "feat(web): repository property on issues"
```

### Task 17: Demo seed and the demo end-to-end tests

**Files:**

- Modify: `packages/core/src/services/seed.ts`; also `apps/web/e2e-demo/*.spec.ts` if they assume every project is visible.

- [ ] **Step 1: Seed both visibilities.** In `seedDemoData`:
  - make the first demo project `public` and give it one repo (`poietic-tech/poietic-issues`), with a couple of issues linked to it;
  - make the second project `private`;
  - add the demo's non-admin users with different roles on it (one `viewer`, one `editor`, one `manager`) through `addMember`, using the admin seed context.
- [ ] **Step 2: Run the demo build and tests.** Run `pnpm build:demo && pnpm e2e:demo`. Expected: PASS. If a demo test signs in as a non-admin user and expects to see the private project, change it to use the manager user. Don't remove assertions.
- [ ] **Step 3: Run everything.** Run `pnpm check`, `pnpm test:pg` and `pnpm e2e` (both databases: `E2E_DATABASE_URL=… pnpm e2e`). Expected: all PASS.
- [ ] **Step 4: Commit, then open PR 4.**

```bash
git add packages/core/src/services/seed.ts apps/web
git commit -m "feat(demo): public and private demo projects with roles and a repo"
```

Open PR 4, "Project access: web app and demo". In the PR description, note that after deploy every existing project is still private and every pre-existing member is an editor.

---

## Self-review notes

- **Spec coverage:**

| Spec section    | Tasks                                          |
| --------------- | ---------------------------------------------- |
| §1 data model   | 1, 2, 10, 11                                   |
| §2 access model | 3–8                                            |
| §3 repo links   | 10, 11                                         |
| §4 API          | 8, 12                                          |
| §4 CLI          | 13                                             |
| §4 web          | 14–16                                          |
| §4 demo         | 17                                             |
| §5 testing      | throughout, plus the end-to-end tests in 14–16 |
| §6 docs         | 9                                              |
| §7 delivery     | the four PRs                                   |

- **Deviations:** listed at the top. Five, all simplifications or fixes for problems found in the code.
