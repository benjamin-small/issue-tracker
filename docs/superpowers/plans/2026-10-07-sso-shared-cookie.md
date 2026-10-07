# SSO via a shared-cookie JWT — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let people sign in to the tracker with an identity provider's parent-domain session cookie, such as poietic.tech's `__Secure-poietic-session`. Unknown identities are created as pending users that an admin approves.

**Architecture:**

- `apps/server` verifies the ES256 JWT in the SSO cookie against the issuer's JWKS, using a WebCrypto verifier with no new dependency.
- `packages/core` maps the verified `(issuer, subject)` to a tracker user, creating one on first sign-in. The link is stored in a new `user_identities` table.
- `POST /auth/sso` turns that into a normal `tracker_session`.
- The web sign-in page offers the SSO button and tries it once automatically.

**Tech Stack:** TypeScript (strict, ESM), Hono + zod-openapi, Kysely on SQLite and Postgres, Vitest, SvelteKit + Svelte 5, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-07-issues-poietic-tech-design.md`, section 3.

## Global Constraints

- **Business logic in `packages/core`.** Token verification and cookie reading belong to the server; user provisioning belongs to core.
- **Portable SQL only.** Write through `withWriteTx`, and use column helpers from `packages/db/src/migrations/helpers.ts`.
- **Database tests run on both dialects:** `pnpm test` and `pnpm test:pg` (after `pnpm pg start`).
- **Timestamps come from `ctx.clock`**, never database defaults.
- **The API contract is committed:** after a route or schema change, run `pnpm openapi:gen` and commit `docs/openapi.json` plus the regenerated client types.
- **New conventions get an ADR** in `docs/adr/`. This plan adds `0018`.
- **Code style:** relative imports use explicit `.ts` extensions; tests sit next to the code as `*.test.ts`.
- **No new runtime dependencies.** The verifier is adapted from poietic-dot-tech `packages/identity/verify.ts` at commit `13d40d7`, and its header comment says so.
- **Generic naming:** the feature is named "SSO", not "poietic". Poietic values appear only in deployment config, outside this plan.
- **`pnpm check` passes before every commit.**

---

## File map

| File                                                                          | Change                                                         |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `packages/db/src/migrations/0003_user_identities.ts`                          | Create: the `user_identities` table                            |
| `packages/db/src/migrate.ts`                                                  | Register `0003_user_identities`                                |
| `packages/db/src/types.ts`                                                    | Add `UserIdentitiesTable`                                      |
| `packages/db/src/db.test.ts`                                                  | Update the migrate up/down test                                |
| `packages/schema/src/errors.ts`                                               | Add the `PENDING_APPROVAL` error code                          |
| `packages/core/src/services/users.ts`                                         | Extract `insertUser(tx, ctx, data)` from `createUserUnchecked` |
| `packages/core/src/services/sso.ts`                                           | Create: `signInWithSso`, `handleFromName`                      |
| `packages/core/src/services/sso.test.ts`                                      | Create                                                         |
| `packages/core/src/index.ts`                                                  | Export `./services/sso.ts`                                     |
| `apps/server/src/sso/jwt.ts`                                                  | Create: `createJwtVerifier`                                    |
| `apps/server/src/sso/jwt.test.ts`                                             | Create                                                         |
| `apps/server/src/env.ts`                                                      | Add `SsoOptions` to `AuthConfig`                               |
| `apps/server/src/config.ts`                                                   | Add `TRACKER_SSO_*` variables and validation                   |
| `apps/server/src/config.test.ts`                                              | Create (or extend, if it exists)                               |
| `apps/server/src/server.ts`                                                   | Build `SsoOptions` from config                                 |
| `apps/server/src/middleware/auth.ts`                                          | Export `sameOrigin`                                            |
| `apps/server/src/routes/auth.ts`                                              | `/auth/config` gains `sso`; new `POST /auth/sso`               |
| `apps/server/src/sso.test.ts`                                                 | Create: route tests                                            |
| `apps/web/src/routes/login/+page.svelte`                                      | SSO button, auto attempt, pending screen                       |
| `apps/web/e2e/sso.spec.ts`                                                    | Create: UI flow with mocked routes                             |
| `docs/adr/0018-sso-via-shared-cookie-jwt.md`                                  | Create                                                         |
| `docs/deployment.md`, `docs/security.md`, `docs/api.md`, `docs/data-model.md` | Document SSO and the table                                     |
| `docs/openapi.json`, client types, `docs/cli-reference.md`                    | Regenerate                                                     |

---

### Task 1: `user_identities` table and the `PENDING_APPROVAL` error code

**Files:**

- Create: `packages/db/src/migrations/0003_user_identities.ts`
- Modify: `packages/db/src/migrate.ts`, `packages/db/src/types.ts`, `packages/db/src/db.test.ts:269-289`, `packages/schema/src/errors.ts:7-30`

**Interfaces:**

- Produces:
  - table `user_identities(issuer text, subject text, user_id text → users.id on delete cascade, created_at ts)`, primary key `(issuer, subject)`;
  - `Database['user_identities']: UserIdentitiesTable`;
  - error code `'PENDING_APPROVAL'` (403, exit 5).

- [ ] **Step 1: Update the migration test so it fails**

In `packages/db/src/db.test.ts`, replace the body of `it('migrate down removes everything and migrate up restores it', …)` with:

```ts
const db = await createTestDb();
try {
  expect(await migrateDown(db)).toEqual(['0003_user_identities']);
  await expect(sql`select count(*) from user_identities`.execute(db.kysely)).rejects.toThrow();
  expect(await migrateDown(db)).toEqual(['0002_webhook_delivery_details']);
  await expect(
    sql`select last_response from webhook_deliveries`.execute(db.kysely),
  ).rejects.toThrow();
  expect(await migrateDown(db)).toEqual(['0001_init']);
  await expect(sql`select count(*) from users`.execute(db.kysely)).rejects.toThrow();
  expect((await migrationStatus(db)).pending).toEqual([
    '0001_init',
    '0002_webhook_delivery_details',
    '0003_user_identities',
  ]);
  expect(await migrateToLatest(db)).toEqual([
    '0001_init',
    '0002_webhook_delivery_details',
    '0003_user_identities',
  ]);
  expect((await migrationStatus(db)).upToDate).toBe(true);
} finally {
  await db.destroy();
}
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run --project db -t "migrate down"`

Expected: FAIL. The first `migrateDown` returns `['0002_webhook_delivery_details']`.

- [ ] **Step 3: Write the migration**

`packages/db/src/migrations/0003_user_identities.ts`:

```ts
import type { Kysely } from 'kysely';
import type { Dialect } from '../dialect.ts';
import { columnTypes, createTable } from './helpers.ts';

/** Links a user to an external identity (SSO issuer + subject) so a returning sign-in finds the same user. */
export function migration0003(dialect: Dialect) {
  const t = columnTypes(dialect);
  return {
    async up(db: Kysely<unknown>): Promise<void> {
      await createTable(db, dialect, 'user_identities')
        .addColumn('issuer', t.text, (c) => c.notNull())
        .addColumn('subject', t.text, (c) => c.notNull())
        .addColumn('user_id', t.id, (c) => c.notNull().references('users.id').onDelete('cascade'))
        .addColumn('created_at', t.ts, (c) => c.notNull())
        .addPrimaryKeyConstraint('user_identities_pk', ['issuer', 'subject'])
        .execute();
      await db.schema
        .createIndex('user_identities_user_idx')
        .on('user_identities')
        .column('user_id')
        .execute();
    },
    async down(db: Kysely<unknown>): Promise<void> {
      await db.schema.dropTable('user_identities').execute();
    },
  };
}
```

In `packages/db/src/migrate.ts`, add `import { migration0003 } from './migrations/0003_user_identities.ts';` and the entry `'0003_user_identities': migration0003(dialect),` after `0002`.

In `packages/db/src/types.ts`, add after `SessionsTable`:

```ts
export interface UserIdentitiesTable {
  /** The SSO issuer (`iss`), e.g. `https://auth.example.com`. */
  issuer: string;
  /** The issuer's stable user id (`sub`). */
  subject: string;
  user_id: string;
  created_at: Timestamp;
}
```

Also add `user_identities: UserIdentitiesTable;` to `Database`, after `sessions`.

In `packages/schema/src/errors.ts`, add after `FORBIDDEN`:

```ts
  PENDING_APPROVAL: { status: 403, title: 'Awaiting approval', exit: 5 },
```

- [ ] **Step 4: Run the db tests on both dialects**

Run: `pnpm vitest run --project db && TEST_DB=postgres pnpm vitest run --project db`

Expected: PASS. Run `pnpm pg start` first if Postgres isn't running.

- [ ] **Step 5: Commit**

```bash
git add packages/db packages/schema/src/errors.ts
git commit -m "db: user_identities table for SSO; PENDING_APPROVAL error code"
```

---

### Task 2: `signInWithSso` in core

**Files:**

- Modify: `packages/core/src/services/users.ts` (extract `insertUser`), `packages/core/src/index.ts`
- Create: `packages/core/src/services/sso.ts`, `packages/core/src/services/sso.test.ts`

**Interfaces:**

- Consumes:
  - `user_identities` (Task 1);
  - `withWriteTx`, `Tx` from `@tracker/db`;
  - `recordEvent` from `../events.ts`;
  - `toUser` from `../mappers.ts`.
- Produces:

```ts
export interface SsoIdentity {
  issuer: string;
  subject: string;
  name: string;
  role: string;
}
export interface SsoSignIn {
  user: User;
  status: 'active' | 'pending';
}
export function signInWithSso(
  ctx: ServiceContext,
  identity: SsoIdentity,
  opts: { adminRole: string },
): Promise<SsoSignIn>;
export function handleFromName(name: string): string;
export async function insertUser(
  tx: Tx,
  ctx: ServiceContext,
  data: z.output<typeof CreateUserInputSchema>,
  opts?: { deactivated?: boolean },
): Promise<User>; // users.ts
```

- [ ] **Step 1: Write the failing tests**

`packages/core/src/services/sso.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDialect } from '@tracker/db/testing';
import { SYSTEM_ACTOR, withActor } from '../context.ts';
import { createTestContext, type TestContext } from '../testing.ts';
import { handleFromName, signInWithSso } from './sso.ts';
import { updateUser } from './users.ts';

const ISS = 'https://auth.example.test';
let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.destroy());

const sys = () => withActor(t.ctx, SYSTEM_ACTOR);
const opts = { adminRole: 'admin' };

describe('handleFromName', () => {
  it('slugifies names into valid handles', () => {
    expect(handleFromName('Ada Lovelace')).toBe('ada-lovelace');
    expect(handleFromName('  Zoë  Ünder_score ')).toBe('zoe-under_score');
    expect(handleFromName('李')).toBe('user');
    expect(handleFromName('x')).toBe('user');
    expect(handleFromName('a'.repeat(80))).toHaveLength(30);
  });
});

describe(`signInWithSso (${testDialect()})`, () => {
  it('creates an unknown non-admin identity as a pending member', async () => {
    const r = await signInWithSso(
      sys(),
      { issuer: ISS, subject: 'u1', name: 'Grace Hopper', role: 'user' },
      opts,
    );
    expect(r.status).toBe('pending');
    expect(r.user).toMatchObject({
      handle: 'grace-hopper',
      name: 'Grace Hopper',
      role: 'member',
      kind: 'human',
    });
    expect(r.user.deactivatedAt).not.toBeNull();
  });

  it('creates an unknown admin-role identity as an active admin', async () => {
    const r = await signInWithSso(
      sys(),
      { issuer: ISS, subject: 'a1', name: 'Boss', role: 'admin' },
      opts,
    );
    expect(r.status).toBe('active');
    expect(r.user).toMatchObject({ handle: 'boss', role: 'admin' });
    expect(r.user.deactivatedAt).toBeNull();
  });

  it('returns the same user for a known identity and never changes name or role', async () => {
    const first = await signInWithSso(
      sys(),
      { issuer: ISS, subject: 'k1', name: 'Kay', role: 'admin' },
      opts,
    );
    const again = await signInWithSso(
      sys(),
      { issuer: ISS, subject: 'k1', name: 'Renamed', role: 'user' },
      opts,
    );
    expect(again.user.id).toBe(first.user.id);
    expect(again.user).toMatchObject({ name: 'Kay', role: 'admin' });
    expect(again.status).toBe('active');
  });

  it('keeps an identity pending until an admin reactivates the user', async () => {
    const p = await signInWithSso(
      sys(),
      { issuer: ISS, subject: 'p1', name: 'Pat', role: 'user' },
      opts,
    );
    expect(
      (await signInWithSso(sys(), { issuer: ISS, subject: 'p1', name: 'Pat', role: 'user' }, opts))
        .status,
    ).toBe('pending');
    await updateUser(t.ctx, p.user.id, { deactivated: false });
    expect(
      (await signInWithSso(sys(), { issuer: ISS, subject: 'p1', name: 'Pat', role: 'user' }, opts))
        .status,
    ).toBe('active');
  });

  it('suffixes handles that are taken, and separates issuers', async () => {
    // 'member' and 'admin' exist from createTestContext.
    const r = await signInWithSso(
      sys(),
      { issuer: ISS, subject: 'm1', name: 'Member', role: 'user' },
      opts,
    );
    expect(r.user.handle).toBe('member-2');
    const other = await signInWithSso(
      sys(),
      { issuer: 'https://other.test', subject: 'm1', name: 'Member', role: 'user' },
      opts,
    );
    expect(other.user.id).not.toBe(r.user.id);
    expect(other.user.handle).toBe('member-3');
  });

  it('records a user.created event', async () => {
    const r = await signInWithSso(
      sys(),
      { issuer: ISS, subject: 'e1', name: 'Evie', role: 'user' },
      opts,
    );
    const ev = await t.db.kysely
      .selectFrom('events')
      .select(['type', 'entity_id'])
      .where('type', '=', 'user.created')
      .where('entity_id', '=', r.user.id)
      .executeTakeFirst();
    expect(ev).toBeDefined();
  });
});
```

> Before running, check that the `events` columns are named `type` and `entity_id` (`packages/db/src/types.ts`, `EventsTable`). If they differ, fix the select in the last test to match how `recordEvent` stores `user.created`.

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm vitest run --project core sso`

Expected: FAIL with "Cannot find module './sso.ts'".

- [ ] **Step 3: Extract `insertUser` in `users.ts`**

Replace `createUserUnchecked` in `packages/core/src/services/users.ts` with:

```ts
/** Creates a user without a permission check (bootstrap / seeding). */
export async function createUserUnchecked(
  ctx: ServiceContext,
  input: CreateUserInput,
): Promise<User> {
  const data = parseInput(CreateUserInputSchema, input);
  try {
    return await withWriteTx(ctx.db, (tx) => insertUser(tx, ctx, data));
  } catch (error) {
    if (isUniqueViolation(error))
      throw conflict(`A user with handle "${data.handle}" or that email already exists`);
    throw error;
  }
}

/** Inserts a user inside an existing write transaction and records `user.created`. */
export async function insertUser(
  tx: Tx,
  ctx: ServiceContext,
  data: z.output<typeof CreateUserInputSchema>,
  opts: { deactivated?: boolean } = {},
): Promise<User> {
  const now = nowIso(ctx);
  const row = await tx
    .insertInto('users')
    .values({
      id: ctx.ids('user'),
      handle: data.handle,
      name: data.name,
      email: data.email ?? null,
      kind: data.kind,
      role: data.role,
      avatar_url: data.avatarUrl ?? null,
      created_at: now,
      updated_at: now,
      deactivated_at: opts.deactivated ? now : null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  const user = toUser(row);
  await recordEvent(tx, ctx, 'user.created', { data: { user } });
  return user;
}
```

Update the imports: `import { type Tx, withWriteTx } from '@tracker/db';` and `import type { z } from 'zod';`. Check that `Tx` is exported from `@tracker/db` (`packages/db/src/index.ts`). If it isn't, export it there.

- [ ] **Step 4: Write `sso.ts`**

`packages/core/src/services/sso.ts`:

```ts
import { withWriteTx } from '@tracker/db';
import { CreateUserInputSchema, type User } from '@tracker/schema';
import { nowIso, type ServiceContext } from '../context.ts';
import { toUser } from '../mappers.ts';
import { insertUser } from './users.ts';

/** A verified identity from an SSO issuer's token. */
export interface SsoIdentity {
  issuer: string;
  subject: string;
  /** Display name from the token; used only when the user is first created. */
  name: string;
  /** The issuer's role claim; equal to `adminRole` makes a new user an active admin. */
  role: string;
}

export interface SsoSignIn {
  user: User;
  /** `pending` until an admin reactivates the user. */
  status: 'active' | 'pending';
}

const HANDLE_MAX = 30;

/** Derives a handle from a display name: lowercase ASCII letters, digits, `-` and `_`; `user` if nothing usable remains. */
export function handleFromName(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, HANDLE_MAX)
    .replace(/[-_]+$/, '');
  return slug.length >= 2 ? slug : 'user';
}

/**
 * Maps an SSO identity to its tracker user, creating one on first sign-in. Role and name are fixed at creation:
 * later sign-ins never re-derive privilege from the token. New non-admin users start deactivated (pending).
 */
export async function signInWithSso(
  ctx: ServiceContext,
  identity: SsoIdentity,
  opts: { adminRole: string },
): Promise<SsoSignIn> {
  const result = (
    row: { deactivated_at: string | null } & Parameters<typeof toUser>[0],
  ): SsoSignIn => ({
    user: toUser(row),
    status: row.deactivated_at ? 'pending' : 'active',
  });

  return withWriteTx(ctx.db, async (tx) => {
    const known = await tx
      .selectFrom('user_identities')
      .innerJoin('users', 'users.id', 'user_identities.user_id')
      .selectAll('users')
      .where('user_identities.issuer', '=', identity.issuer)
      .where('user_identities.subject', '=', identity.subject)
      .executeTakeFirst();
    if (known) return result(known);

    const base = handleFromName(identity.name);
    const taken = new Set(
      (
        await tx
          .selectFrom('users')
          .select('handle')
          .where((eb) => eb.or([eb('handle', '=', base), eb('handle', 'like', `${base}-%`)]))
          .execute()
      ).map((r) => r.handle.toLowerCase()),
    );
    let handle = base;
    for (let n = 2; taken.has(handle); n++) handle = `${base}-${n}`;

    const admin = identity.role === opts.adminRole;
    const data = CreateUserInputSchema.parse({
      handle,
      name: identity.name.trim().slice(0, 100) || 'User',
      kind: 'human',
      role: admin ? 'admin' : 'member',
    });
    const user = await insertUser(tx, ctx, data, { deactivated: !admin });
    await tx
      .insertInto('user_identities')
      .values({
        issuer: identity.issuer,
        subject: identity.subject,
        user_id: user.id,
        created_at: nowIso(ctx),
      })
      .execute();
    return { user, status: admin ? 'active' : 'pending' };
  });
}
```

> Writers are serialized by `withWriteTx` (an immediate transaction on SQLite, an advisory lock on Postgres). So the lookup, the handle choice and the inserts are race-free without retry logic.
>
> `like 'base-%'` treats `_` as a wildcard. That only widens the `taken` set, which is harmless: it can only skip a free suffix.
>
> If `toUser`'s parameter type makes the `result` helper's type awkward, type the row as `Selectable<UsersTable>` from `@tracker/db` instead.

Add `export * from './services/sso.ts';` to `packages/core/src/index.ts`.

- [ ] **Step 5: Run the tests on both dialects**

Run: `pnpm vitest run --project core && TEST_DB=postgres pnpm vitest run --project core`

Expected: PASS, including the existing user and bootstrap tests that go through `createUserUnchecked`.

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "core: signInWithSso provisions pending users from SSO identities"
```

---

### Task 3: The JWT verifier (`apps/server/src/sso/jwt.ts`)

**Files:**

- Create: `apps/server/src/sso/jwt.ts`, `apps/server/src/sso/jwt.test.ts`

**Interfaces:**

- Produces:

```ts
export interface SsoClaims {
  iss: string;
  sub: string;
  aud: string;
  role: string;
  name: string;
  exp: number;
  iat: number;
}
export interface JwtVerifier {
  verify(token: string): Promise<SsoClaims | null>;
}
export function createJwtVerifier(opts: {
  jwksUrl: string;
  issuer: string;
  audience: string;
  fetchImpl?: typeof fetch;
  now?: () => number /* ms */;
}): JwtVerifier;
```

- [ ] **Step 1: Write the failing tests**

`apps/server/src/sso/jwt.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createJwtVerifier } from './jwt.ts';

const ISS = 'https://auth.example.test';
const AUD = 'example:public';
const JWKS = `${ISS}/.well-known/jwks.json`;
const b64url = (b: ArrayBuffer | Uint8Array | string) =>
  Buffer.from(typeof b === 'string' ? b : new Uint8Array(b as ArrayBuffer)).toString('base64url');

async function keypair(kid: string) {
  const { privateKey, publicKey } = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const jwk = {
    ...(await crypto.subtle.exportKey('jwk', publicKey)),
    kid,
    alg: 'ES256',
    use: 'sig',
  };
  return { privateKey, jwk };
}

async function sign(privateKey: CryptoKey, header: object, claims: object) {
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(input),
  );
  return `${input}.${b64url(sig)}`;
}

const NOW = 1_800_000_000_000;
const claims = (over: object = {}) => ({
  iss: ISS,
  aud: AUD,
  sub: 'u1',
  role: 'user',
  name: 'Ada',
  sid: 's1',
  iat: NOW / 1000 - 10,
  exp: NOW / 1000 + 600,
  ...over,
});

function setup(keys: { kid: string; jwk: JsonWebKey }[], now = () => NOW) {
  let fetches = 0;
  const fetchImpl = (async (url: string) => {
    fetches++;
    expect(url).toBe(JWKS);
    return new Response(JSON.stringify({ keys: keys.map((k) => k.jwk) }));
  }) as typeof fetch;
  const verifier = createJwtVerifier({ jwksUrl: JWKS, issuer: ISS, audience: AUD, fetchImpl, now });
  return { verifier, fetches: () => fetches };
}

describe('createJwtVerifier', () => {
  it('accepts a valid ES256 token and caches the JWKS', async () => {
    const k = await keypair('k1');
    const { verifier, fetches } = setup([{ kid: 'k1', jwk: k.jwk }]);
    const token = await sign(k.privateKey, { alg: 'ES256', kid: 'k1' }, claims());
    expect(await verifier.verify(token)).toMatchObject({ sub: 'u1', name: 'Ada', role: 'user' });
    await verifier.verify(token);
    expect(fetches()).toBe(1);
  });

  it.each([
    ['wrong issuer', { iss: 'https://evil.test' }],
    ['wrong audience', { aud: 'other' }],
    ['expired', { exp: NOW / 1000 - 1 }],
    ['issued in the future', { iat: NOW / 1000 + 120 }],
    ['missing sub', { sub: undefined }],
  ])('rejects a token with %s', async (_label, over) => {
    const k = await keypair('k1');
    const { verifier } = setup([{ kid: 'k1', jwk: k.jwk }]);
    expect(
      await verifier.verify(await sign(k.privateKey, { alg: 'ES256', kid: 'k1' }, claims(over))),
    ).toBeNull();
  });

  it('rejects other algorithms, garbage and a bad signature', async () => {
    const k = await keypair('k1');
    const other = await keypair('k1');
    const { verifier } = setup([{ kid: 'k1', jwk: k.jwk }]);
    expect(
      await verifier.verify(await sign(k.privateKey, { alg: 'none', kid: 'k1' }, claims())),
    ).toBeNull();
    expect(await verifier.verify('not.a.jwt')).toBeNull();
    expect(await verifier.verify('nope')).toBeNull();
    expect(
      await verifier.verify(await sign(other.privateKey, { alg: 'ES256', kid: 'k1' }, claims())),
    ).toBeNull();
  });

  it('refetches once for an unknown kid, at most once a minute', async () => {
    const k = await keypair('k1');
    let t = NOW;
    const { verifier, fetches } = setup([{ kid: 'k1', jwk: k.jwk }], () => t);
    const bogus = await sign(k.privateKey, { alg: 'ES256', kid: 'k9' }, claims());
    expect(await verifier.verify(bogus)).toBeNull(); // initial fetch + forced refetch
    expect(await verifier.verify(bogus)).toBeNull(); // throttled
    expect(fetches()).toBe(2);
    t += 61_000;
    await verifier.verify(bogus);
    expect(fetches()).toBe(3);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm vitest run --project server jwt`

Expected: FAIL with "Cannot find module './jwt.ts'". If the project isn't named `server`, use the `name` from `apps/server/package.json`.

- [ ] **Step 3: Write the verifier**

`apps/server/src/sso/jwt.ts`:

```ts
/**
 * Verifies ES256 JWTs from an SSO issuer against its JWKS, with WebCrypto only (no dependency).
 *
 * Adapted from poietic-dot-tech packages/identity/verify.ts at 13d40d7: the cache lives in the verifier
 * (not module scope) and time comes from an injected clock, so tests and several issuers stay independent.
 * Returns claims or null — null is the only failure signal, so an unverified payload can never be used by mistake.
 * Throws only when no keys could be obtained at all.
 */

export interface SsoClaims {
  iss: string;
  sub: string;
  aud: string;
  role: string;
  name: string;
  iat: number;
  exp: number;
}

export interface JwtVerifier {
  verify(token: string): Promise<SsoClaims | null>;
}

/** JWKS is cached this long; a rotation publishes a new `kid`, which forces a refetch sooner. */
const JWKS_TTL_MS = 3_600_000;
/** How often an unknown `kid` may force a refetch, so forged kids can't turn requests into JWKS fetches. */
const FORCED_REFETCH_MIN_MS = 60_000;

function b64urlDecode(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64url'));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSegment(segment: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(b64urlDecode(segment)));
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

export function createJwtVerifier(opts: {
  jwksUrl: string;
  issuer: string;
  audience: string;
  fetchImpl?: typeof fetch;
  /** Milliseconds since the epoch. */
  now?: () => number;
}): JwtVerifier {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  let cache: { keys: Map<string, CryptoKey>; fetchedAt: number } | null = null;
  let inFlight: Promise<Map<string, CryptoKey>> | null = null;
  let lastForcedAt = -Infinity;

  async function fetchKeys(): Promise<Map<string, CryptoKey>> {
    const res = await fetchImpl(opts.jwksUrl);
    if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
    const body = (await res.json()) as { keys?: (JsonWebKey & { kid?: string })[] };
    const keys = new Map<string, CryptoKey>();
    for (const jwk of body.keys ?? []) {
      if (!jwk.kid) continue;
      try {
        keys.set(
          jwk.kid,
          await crypto.subtle.importKey(
            'jwk',
            { ...jwk, key_ops: ['verify'] },
            { name: 'ECDSA', namedCurve: 'P-256' },
            true,
            ['verify'],
          ),
        );
      } catch {
        // A malformed key must not poison the usable ones.
      }
    }
    return keys;
  }

  async function loadKeys(force: boolean): Promise<Map<string, CryptoKey>> {
    if (cache && !force && now() - cache.fetchedAt < JWKS_TTL_MS) return cache.keys;
    inFlight ??= fetchKeys()
      .then((keys) => {
        cache = { keys, fetchedAt: now() };
        return keys;
      })
      .finally(() => {
        inFlight = null;
      });
    try {
      return await inFlight;
    } catch (error) {
      // Serve stale keys rather than failing every sign-in while the issuer is briefly unreachable.
      if (cache) return cache.keys;
      throw error;
    }
  }

  return {
    async verify(token) {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const [rawHeader, rawBody, rawSig] = parts as [string, string, string];
      const header = parseSegment(rawHeader);
      // Only ES256, by allowlist: stops alg confusion, including alg=none.
      if (!header || header.alg !== 'ES256' || typeof header.kid !== 'string' || !header.kid)
        return null;

      let key = (await loadKeys(false)).get(header.kid);
      if (!key && now() - lastForcedAt >= FORCED_REFETCH_MIN_MS) {
        lastForcedAt = now();
        key = (await loadKeys(true)).get(header.kid);
      }
      if (!key) return null;

      let ok = false;
      try {
        ok = await crypto.subtle.verify(
          { name: 'ECDSA', hash: 'SHA-256' },
          key,
          b64urlDecode(rawSig),
          new TextEncoder().encode(`${rawHeader}.${rawBody}`),
        );
      } catch {
        return null;
      }
      if (!ok) return null;

      const claims = parseSegment(rawBody);
      if (!claims) return null;
      const nowS = Math.floor(now() / 1000);
      if (claims.iss !== opts.issuer || claims.aud !== opts.audience) return null;
      if (typeof claims.exp !== 'number' || claims.exp <= nowS) return null;
      if (typeof claims.iat !== 'number' || claims.iat > nowS + 60) return null;
      for (const field of ['sub', 'role', 'name'] as const)
        if (typeof claims[field] !== 'string' || !claims[field]) return null;
      return claims as unknown as SsoClaims;
    },
  };
}
```

> `role` must be a non-empty string. The poietic issuer always sets it. If a generic issuer omits it, relax the check to default `role` to `''` (never admin).

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run --project server jwt`

Expected: PASS (5 tests, with the `it.each` cases counted individually).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/sso
git commit -m "server: dependency-free ES256 JWKS verifier for SSO tokens"
```

---

### Task 4: SSO configuration

**Files:**

- Modify: `apps/server/src/config.ts`, `apps/server/src/env.ts`, `apps/server/src/server.ts:88-97`
- Test: `apps/server/src/config.test.ts`. Create it if there's no existing config test (`ls apps/server/src/*config*`).

**Interfaces:**

- Consumes: `createJwtVerifier`, `JwtVerifier` (Task 3).
- Produces, in `env.ts`:

```ts
export interface SsoOptions {
  /** Shown on the sign-in button, e.g. "poietic.tech". */
  name: string;
  /** Cookie holding the issuer's JWT. */
  cookie: string;
  /** The issuer (`iss`); identities are stored under it. */
  issuer: string;
  /** Where to send a browser without a valid cookie; the tracker appends `redirect=<sign-in URL>`. */
  loginUrl: string;
  /** Optional endpoint the browser calls (with credentials) to renew a lapsed cookie before signing in. */
  refreshUrl?: string | undefined;
  /** Token `role` that makes a new user an active admin. */
  adminRole: string;
  verifier: JwtVerifier;
}
```

`AuthConfig`'s `standard` variant gains `sso?: SsoOptions | undefined`. `loadConfig` gains `TRACKER_SSO_NAME`, `TRACKER_SSO_COOKIE`, `TRACKER_SSO_ISSUER`, `TRACKER_SSO_AUDIENCE`, `TRACKER_SSO_JWKS_URL`, `TRACKER_SSO_LOGIN_URL`, `TRACKER_SSO_REFRESH_URL` and `TRACKER_SSO_ADMIN_ROLE`, plus `ssoOptionsFromConfig(config): SsoOptions | undefined` in `config.ts`.

- [ ] **Step 1: Write the failing test**

`apps/server/src/config.test.ts` (append to the file if it exists):

```ts
import { describe, expect, it } from 'vitest';
import { loadConfig, ssoOptionsFromConfig } from './config.ts';

const SSO = {
  TRACKER_SSO_ISSUER: 'https://auth.example.test',
  TRACKER_SSO_COOKIE: '__Secure-example-session',
  TRACKER_SSO_AUDIENCE: 'example:public',
  TRACKER_SSO_JWKS_URL: 'https://auth.example.test/.well-known/jwks.json',
  TRACKER_SSO_LOGIN_URL: 'https://auth.example.test/',
};

describe('SSO configuration', () => {
  it('is off unless TRACKER_SSO_ISSUER is set', () => {
    expect(ssoOptionsFromConfig(loadConfig({}))).toBeUndefined();
  });

  it('requires the cookie, audience, JWKS and login URL with an issuer', () => {
    expect(() => loadConfig({ TRACKER_SSO_ISSUER: 'https://auth.example.test' })).toThrow(
      /TRACKER_SSO_COOKIE.*\n?.*TRACKER_SSO_AUDIENCE|TRACKER_SSO_COOKIE is required/s,
    );
  });

  it('builds options with defaults', () => {
    const sso = ssoOptionsFromConfig(loadConfig(SSO))!;
    expect(sso).toMatchObject({
      name: 'auth.example.test',
      cookie: '__Secure-example-session',
      issuer: 'https://auth.example.test',
      loginUrl: 'https://auth.example.test/',
      adminRole: 'admin',
    });
    expect(sso.refreshUrl).toBeUndefined();
    expect(typeof sso.verifier.verify).toBe('function');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run --project server config`

Expected: FAIL, because `ssoOptionsFromConfig` is not exported.

- [ ] **Step 3: Implement it**

In `apps/server/src/config.ts`, add to the zod object (after `TRACKER_ALLOWED_ORIGINS`):

```ts
    /** SSO: enabled when the issuer is set. See docs/deployment.md "Single sign-on". */
    TRACKER_SSO_ISSUER: z.url().optional(),
    TRACKER_SSO_NAME: z.string().optional(),
    TRACKER_SSO_COOKIE: z.string().optional(),
    TRACKER_SSO_AUDIENCE: z.string().optional(),
    TRACKER_SSO_JWKS_URL: z.url().optional(),
    TRACKER_SSO_LOGIN_URL: z.url().optional(),
    TRACKER_SSO_REFRESH_URL: z.url().optional(),
    TRACKER_SSO_ADMIN_ROLE: z.string().default('admin'),
```

After the s3 check, add:

```ts
if (parsed.data.TRACKER_SSO_ISSUER)
  for (const name of [
    'TRACKER_SSO_COOKIE',
    'TRACKER_SSO_AUDIENCE',
    'TRACKER_SSO_JWKS_URL',
    'TRACKER_SSO_LOGIN_URL',
  ] as const)
    if (!parsed.data[name]) throw new Error(`${name} is required when TRACKER_SSO_ISSUER is set`);
```

At the end of the file, add:

```ts
/** SSO options for the app, or undefined when SSO is off. */
export function ssoOptionsFromConfig(config: ServerConfig): SsoOptions | undefined {
  const issuer = config.TRACKER_SSO_ISSUER;
  if (!issuer) return undefined;
  const audience = config.TRACKER_SSO_AUDIENCE!;
  return {
    name: config.TRACKER_SSO_NAME ?? new URL(issuer).hostname,
    cookie: config.TRACKER_SSO_COOKIE!,
    issuer,
    loginUrl: config.TRACKER_SSO_LOGIN_URL!,
    refreshUrl: config.TRACKER_SSO_REFRESH_URL,
    adminRole: config.TRACKER_SSO_ADMIN_ROLE,
    verifier: createJwtVerifier({ jwksUrl: config.TRACKER_SSO_JWKS_URL!, issuer, audience }),
  };
}
```

Add the imports `import type { SsoOptions } from './env.ts';` and `import { createJwtVerifier } from './sso/jwt.ts';`.

> The "requires" test above uses a loose regex because the code throws at the first missing variable. Tighten it to `/TRACKER_SSO_COOKIE is required/`.

In `apps/server/src/env.ts`, add the `SsoOptions` interface from the Interfaces block (with `import type { JwtVerifier } from './sso/jwt.ts';`), and add `sso?: SsoOptions | undefined;` to the `standard` variant of `AuthConfig`.

In `apps/server/src/server.ts`, add `sso: ssoOptionsFromConfig(config),` to the `auth` object passed to `createApp`, and import `ssoOptionsFromConfig` from `./config.ts`.

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm vitest run --project server config && pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src
git commit -m "server: TRACKER_SSO_* configuration"
```

---

### Task 5: `POST /auth/sso` and the `sso` field in `/auth/config`

**Files:**

- Modify: `apps/server/src/middleware/auth.ts` (export `sameOrigin`), `apps/server/src/routes/auth.ts`
- Create: `apps/server/src/sso.test.ts`
- Regenerate: `docs/openapi.json`, client types (`pnpm openapi:gen`)

**Interfaces:**

- Consumes:
  - `SsoOptions` (Task 4);
  - `signInWithSso` (Task 2);
  - `SESSION_COOKIE`, plus the `startSession` helper inside `registerAuthRoutes`.
- Produces:
  - `GET /api/v1/auth/config` returns `{ devLogin, users?, sso: { name, loginUrl, refreshUrl } | null }`;
  - `POST /api/v1/auth/sso` (no body) returns `200 User` with the cookie set, `403 PENDING_APPROVAL`, `403 FORBIDDEN` (cross-origin) or `401 UNAUTHENTICATED`;
  - `404 NOT_FOUND` when SSO is off.

- [ ] **Step 1: Write the failing tests**

`apps/server/src/sso.test.ts`:

```ts
import { createTestContext, type TestContext } from '@tracker/core/testing';
import { testDialect } from '@tracker/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import type { SsoOptions } from './env.ts';
import type { SsoClaims } from './sso/jwt.ts';

const BASE = 'http://tracker.test';
const ISS = 'https://auth.example.test';
let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.destroy());

/** A fake verifier: the cookie value is the subject; "admin-*" subjects carry role admin; "bad" fails. */
function sso(): SsoOptions {
  return {
    name: 'Example',
    cookie: 'example_session',
    issuer: ISS,
    loginUrl: `${ISS}/login`,
    refreshUrl: `${ISS}/me`,
    adminRole: 'admin',
    verifier: {
      verify: async (token) =>
        token === 'bad'
          ? null
          : ({
              iss: ISS,
              aud: 'x',
              sub: token,
              name: `Person ${token}`,
              role: token.startsWith('admin') ? 'admin' : 'user',
              iat: 0,
              exp: 0,
            } satisfies SsoClaims),
    },
  };
}

function post(app: ReturnType<typeof createApp>, cookie: string | null, origin = BASE) {
  const headers: Record<string, string> = { origin };
  if (cookie !== null) headers.cookie = `example_session=${cookie}`;
  return app.request(`${BASE}/api/v1/auth/sso`, { method: 'POST', headers });
}

describe(`SSO sign-in (${testDialect()})`, () => {
  it('advertises SSO in /auth/config', async () => {
    const app = createApp({ db: t.db, auth: { mode: 'standard', sso: sso() } });
    const res = await app.request(`${BASE}/api/v1/auth/config`);
    expect(await res.json()).toMatchObject({
      devLogin: false,
      sso: { name: 'Example', loginUrl: `${ISS}/login`, refreshUrl: `${ISS}/me` },
    });
    const off = createApp({ db: t.db, auth: { mode: 'standard' } });
    expect(await (await off.request(`${BASE}/api/v1/auth/config`)).json()).toMatchObject({
      sso: null,
    });
  });

  it('signs an admin-role identity in with a tracker session', async () => {
    const app = createApp({ db: t.db, auth: { mode: 'standard', sso: sso() } });
    const res = await post(app, 'admin-1');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ role: 'admin', name: 'Person admin-1' });
    const session = res.headers.get('set-cookie')!.split(';')[0]!;
    expect(session).toMatch(/^tracker_session=/);
    const me = await app.request(`${BASE}/api/v1/me`, { headers: { cookie: session } });
    expect(((await me.json()) as { name: string }).name).toBe('Person admin-1');
  });

  it('answers PENDING_APPROVAL for a new non-admin identity, without a session', async () => {
    const app = createApp({ db: t.db, auth: { mode: 'standard', sso: sso() } });
    const res = await post(app, 'u-1');
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('PENDING_APPROVAL');
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('answers 401 without a valid cookie, 403 cross-origin, 404 when off', async () => {
    const app = createApp({ db: t.db, auth: { mode: 'standard', sso: sso() } });
    expect((await post(app, null)).status).toBe(401);
    expect((await post(app, 'bad')).status).toBe(401);
    expect((await post(app, 'admin-2', 'https://evil.example')).status).toBe(403);
    const off = createApp({ db: t.db, auth: { mode: 'standard' } });
    expect((await post(off, 'admin-3')).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm vitest run --project server sso.test`

Expected: FAIL. `/auth/config` has no `sso` field, and `/auth/sso` returns 404.

- [ ] **Step 3: Implement the route**

In `apps/server/src/middleware/auth.ts`, change `function sameOrigin(` to `export function sameOrigin(`.

In `apps/server/src/routes/auth.ts`:

1. Extend the imports:
   - `signInWithSso` and `SYSTEM_ACTOR` from `@tracker/core`;
   - `sameOrigin` from `../middleware/auth.ts`.
2. Extend `AuthConfigSchema` with:

```ts
    sso: z
      .object({
        name: z.string().openapi({ description: 'Label for the sign-in button.' }),
        loginUrl: z.string().openapi({ description: 'Where to sign in; append `redirect=<this page>`.' }),
        refreshUrl: z.string().nullable().openapi({
          description: 'Call with credentials before `POST /auth/sso` to renew a lapsed SSO cookie.',
        }),
      })
      .nullable()
      .openapi({ description: 'Single sign-on, when configured.' }),
```

3. Inside `registerAuthRoutes`, after `const secure = …`, add:

```ts
const sso = deps.auth.mode === 'standard' ? deps.auth.sso : undefined;
const ssoInfo = sso
  ? { name: sso.name, loginUrl: sso.loginUrl, refreshUrl: sso.refreshUrl ?? null }
  : null;
```

4. In the `/auth/config` handler, return `{ devLogin: false, sso: ssoInfo }` and `{ devLogin: true, users: …, sso: ssoInfo }`.
5. Add the route after `/auth/dev-login`:

```ts
app.openapi(
  createRoute({
    method: 'post',
    path: '/auth/sso',
    tags,
    security: [],
    summary: 'Sign in with single sign-on',
    description:
      "Exchanges the SSO issuer's cookie (sent automatically by the browser) for a session. A first sign-in " +
      "creates the user; users other than the issuer's admins wait for an admin to reactivate them " +
      '(`PENDING_APPROVAL`). Browser-only: must be same-origin.',
    responses: {
      200: json(UserSchema, 'Signed in'),
      ...errorResponses('FORBIDDEN', 'NOT_FOUND', 'PENDING_APPROVAL'),
    },
  }),
  async (c) => {
    if (!sso) throw new DomainError('NOT_FOUND', 'Single sign-on is not configured');
    if (
      !sameOrigin(c.req.raw, deps.auth.mode === 'standard' ? (deps.auth.allowedOrigins ?? []) : [])
    )
      throw new DomainError('FORBIDDEN', 'Cross-origin request rejected (CSRF protection)');
    const token = getCookie(c, sso.cookie);
    const claims = token ? await sso.verifier.verify(token) : null;
    if (!claims) throw new DomainError('UNAUTHENTICATED', `Not signed in to ${sso.name}`);
    const ctx = { ...c.get('ctx'), actor: SYSTEM_ACTOR };
    const { user, status } = await signInWithSso(
      ctx,
      { issuer: sso.issuer, subject: claims.sub, name: claims.name, role: claims.role },
      { adminRole: sso.adminRole },
    );
    if (status === 'pending')
      throw new DomainError(
        'PENDING_APPROVAL',
        `@${user.handle} is waiting for an admin to approve access`,
      );
    await startSession(c, user.id);
    return c.json(user, 200);
  },
);
```

> Check that `errorResponses(...)` in `routes/common.ts` accepts any `ErrorCode`. If it's typed to a fixed list, add `'PENDING_APPROVAL'` there.
>
> `UNAUTHENTICATED` is presumably included by default, as `/auth/token-login` uses `errorResponses()` and throws it. Confirm by reading `common.ts`.

- [ ] **Step 4: Run the tests, regenerate the contract, then run the full check**

Run: `pnpm vitest run --project server && pnpm openapi:gen && pnpm vitest run --project cli -u && pnpm check`

Expected: everything passes. The changes are `docs/openapi.json`, the client types, and possibly `docs/cli-reference.md` (if exit codes are listed).

- [ ] **Step 5: Commit**

```bash
git add apps/server packages/client docs/openapi.json docs/cli-reference.md apps/cli
git commit -m "server: POST /auth/sso exchanges an SSO cookie for a session"
```

---

### Task 6: Web sign-in with SSO

**Files:**

- Modify: `apps/web/src/routes/login/+page.svelte`
- Create: `apps/web/e2e/sso.spec.ts`

**Interfaces:**

- Consumes:
  - `fetchers.authConfig()`, which now returns `sso: { name, loginUrl, refreshUrl } | null`;
  - `api.POST('/auth/sso')`.

- [ ] **Step 1: Write the failing e2e test**

`apps/web/e2e/sso.spec.ts`. It uses the plain Playwright `test`, not the dev-login fixture, and mocks the two API calls:

```ts
import { expect, test } from '@playwright/test';

const SSO = {
  name: 'Example',
  loginUrl: 'https://auth.example.test/login',
  refreshUrl: 'https://auth.example.test/me',
};

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/auth/config', (r) =>
    r.fulfill({ json: { devLogin: false, sso: SSO } }),
  );
  await page.route('https://auth.example.test/me', (r) => r.fulfill({ status: 200, json: {} }));
});

test('shows the pending screen when the account awaits approval', async ({ page }) => {
  await page.route('**/api/v1/auth/sso', (r) =>
    r.fulfill({
      status: 403,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        type: 'urn:tracker:error:PENDING_APPROVAL',
        title: 'Awaiting approval',
        status: 403,
        code: 'PENDING_APPROVAL',
        detail: '@pat is waiting for an admin to approve access',
      }),
    }),
  );
  await page.goto('/login');
  await expect(page.getByText('Waiting for approval')).toBeVisible();
  await expect(page.getByText('@pat is waiting')).toBeVisible();
});

test('sends a signed-out visitor to the SSO login with a redirect back', async ({ page }) => {
  await page.route('**/api/v1/auth/sso', (r) =>
    r.fulfill({
      status: 401,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        type: 'urn:tracker:error:UNAUTHENTICATED',
        title: 'Authentication required',
        status: 401,
        code: 'UNAUTHENTICATED',
      }),
    }),
  );
  await page.route('https://auth.example.test/login**', (r) =>
    r.fulfill({ status: 200, body: 'login page' }),
  );
  await page.goto('/login?next=%2Fp%2FENG');
  const button = page.getByRole('button', { name: 'Sign in with Example' });
  await expect(button).toBeVisible(); // the automatic attempt got a 401 and stayed put
  await button.click();
  await page.waitForURL(/auth\.example\.test\/login/);
  const redirect = new URL(page.url()).searchParams.get('redirect')!;
  expect(new URL(redirect).pathname).toBe('/login');
  expect(new URL(redirect).searchParams.get('next')).toBe('/p/ENG');
});

test('enters the app when SSO sign-in succeeds', async ({ page }) => {
  // Sign in for real via dev login, then let the mocked SSO call report success.
  const user = await (
    await page.request.post('/api/v1/auth/dev-login', { data: { user: 'ada' } })
  ).json();
  await page.route('**/api/v1/auth/sso', (r) => r.fulfill({ status: 200, json: user }));
  await page.goto('/login?next=%2Fp%2FENG');
  await page.waitForURL(/\/p\/ENG/);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm e2e -- sso.spec.ts`

Expected: FAIL. There's no SSO button or pending screen yet.

- [ ] **Step 3: Implement the page**

In `apps/web/src/routes/login/+page.svelte`, add to the `<script>` (after `devLogin`):

```ts
let pending = $state('');
let ssoTried = false;

/** Where the SSO issuer should send the browser back to: this page, keeping `next`. */
function ssoRedirectTarget(): string {
  return shareUrl(`/login?next=${encodeURIComponent(next)}`);
}

async function ssoLogin(interactive: boolean) {
  const sso = config.data?.sso;
  if (!sso) return;
  busy = true;
  error = '';
  try {
    // Renew a lapsed SSO cookie (its tokens are short-lived); failures just mean "not signed in".
    if (sso.refreshUrl)
      await fetch(sso.refreshUrl, { credentials: 'include' }).catch(() => undefined);
    const { error: problem, response } = await api.POST('/auth/sso');
    if (response.ok) return await finish();
    const code = (problem as { code?: string; detail?: string } | undefined)?.code;
    if (code === 'PENDING_APPROVAL') {
      pending = (problem as { detail?: string }).detail ?? 'Your account is waiting for approval.';
    } else if (response.status === 401) {
      if (interactive) {
        const url = new URL(sso.loginUrl);
        url.searchParams.set('redirect', ssoRedirectTarget());
        location.assign(url.href);
      }
    } else if (interactive) {
      error =
        (problem as { detail?: string } | undefined)?.detail ??
        `Sign-in failed (${response.status})`;
    }
  } finally {
    busy = false;
  }
}

// One silent attempt per visit, so someone already signed in to the SSO issuer goes straight in.
$effect(() => {
  if (config.data?.sso && !ssoTried) {
    ssoTried = true;
    void ssoLogin(false);
  }
});
```

Update the import from `$lib/nav.ts` to `import { current, navigate, shareUrl } from '$lib/nav.ts';`.

In the markup, directly inside the card and after the heading `<div class="mb-6 …">…</div>`, add:

```svelte
{#if pending}
  <div class="mb-4 rounded-md border border-border bg-bg-subtle p-3" role="status">
    <p class="text-sm font-medium">Waiting for approval</p>
    <p class="mt-1 text-sm text-fg-muted">{pending}</p>
    <p class="mt-2 text-xs text-fg-subtle">
      An admin can approve you with
      <code class="font-mono">tracker user edit &lt;handle&gt; --reactivate</code>.
    </p>
  </div>
{:else if config.data?.sso}
  <button class="{btn.primary} mb-6 w-full" disabled={busy} onclick={() => ssoLogin(true)}
    >Sign in with {config.data.sso.name}</button
  >
{/if}
```

When `config.data?.sso` is set, change the token form's divider condition to also show "or use a token". Replace `{#if config.data?.devLogin && config.data.users?.length}` above the divider with `{#if (config.data?.devLogin && config.data.users?.length) || config.data?.sso}`.

- [ ] **Step 4: Run the e2e tests and the full check**

Run: `pnpm e2e -- sso.spec.ts && pnpm check`

Expected: PASS. Also run the full `pnpm e2e` once to make sure the other specs still sign in.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "web: sign in with SSO, with a pending-approval screen"
```

---

### Task 7: ADR 0018 and the docs

**Files:**

- Create: `docs/adr/0018-sso-via-shared-cookie-jwt.md`
- Modify: `docs/adr/README.md` (index, if it lists ADRs), `docs/deployment.md`, `docs/security.md`, `docs/api.md`, `docs/data-model.md`

- [ ] **Step 1: Write the ADR**

```markdown
# 0018. SSO via a parent-domain cookie JWT

- **Status:** Accepted
- **Date:** 2026-10-07

## Context

The tracker is deployed under a domain whose identity service (for poietic.tech, `auth.poietic.tech`) sets a
short-lived ES256 JWT in a cookie scoped to the parent domain and publishes its public keys as JWKS. ADR 0009
anticipated a real login "issuing the same sessions". Sign-up at such a provider may be open, and the tracker has no
per-project permissions, so a verified identity alone must not grant access.

## Decision

- **Verification.** When `TRACKER_SSO_ISSUER` is set, `POST /auth/sso` reads the issuer's cookie and verifies the JWT
  (ES256 only, `iss`, `aud`, `exp`, `iat`) against the JWKS with WebCrypto. There is no new dependency: the verifier
  is adapted from poietic-dot-tech `packages/identity/verify.ts`.
- **Identity mapping.** Identities are stored in `user_identities(issuer, subject)`. The first sign-in creates a
  human user with a handle derived from the token's name.
- **Access.** The token's role equal to `TRACKER_SSO_ADMIN_ROLE` makes a new user an active admin. Anyone else starts
  deactivated (`PENDING_APPROVAL`) until an admin runs `tracker user edit <handle> --reactivate`. Role and name are
  fixed at creation and never re-derived from later tokens.
- **Sessions.** Success issues the ordinary `tracker_session`. Tokens and sessions are otherwise unchanged.

## Consequences

- One login across the parent domain, with a lapsed cookie renewed by the provider's refresh endpoint before
  signing in.
- Signing out of the provider does not end an existing tracker session (30 days). Revisit with a shorter SSO session
  TTL or a liveness check if that matters.
- Nothing here is poietic-specific; any issuer with a cookie JWT and JWKS works. OIDC redirect flows would be a
  separate mode.
```

- [ ] **Step 2: Update the docs**

- **`docs/deployment.md`:**
  - Add the eight `TRACKER_SSO_*` rows to the configuration table. Meanings come from the spec's configuration table, with `TRACKER_SSO_ADMIN_ROLE` defaulting to `admin`.
  - Add a short "Single sign-on" section that links ADR 0018 and says how to approve a pending user: `tracker user list --include-deactivated`, then `tracker user edit <handle> --reactivate`.
- **`docs/security.md`:** add a bullet on SSO sessions next to the browser-sessions bullet. Cover the verification rules, the pending default, and the sign-out gap.
- **`docs/api.md`:** add `POST /auth/sso` to the web-app row of the authentication table.
- **`docs/data-model.md`:**
  - add `users ||--o{ user_identities : "signs in as"` to the ER diagram;
  - add a `user_identities` row to the tables list: "External SSO identities (issuer + subject) linked to a user. Rows cascade with the user."

- [ ] **Step 3: Run the check and commit**

Run: `pnpm check`

Expected: PASS (Prettier formats the Markdown).

```bash
git add docs
git commit -m "docs: ADR 0018 and SSO configuration, security and data model"
```
