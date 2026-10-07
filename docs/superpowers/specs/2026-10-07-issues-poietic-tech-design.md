# issues.poietic.tech — design

- **Date:** 2026-10-07
- **Status:** Draft, awaiting review
- **Repositories:** `poietic-issues` (this one), `poietic-dot-tech` (infrastructure)

## Goal

Run the tracker at `https://issues.poietic.tech` as part of poietic.tech:

- hosted entirely on Cloudflare;
- signed in to with the shared poietic.tech identity (`auth.poietic.tech`);
- a public URL, with access controlled by the tracker itself.

## Decisions

| Question               | Decision                                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Where the process runs | **Cloudflare Containers**: a Worker plus a `Container` Durable Object running this repository's `Dockerfile`.                                          |
| Database               | **SQLite inside the container, continuously replicated to R2 with Litestream.** No Neon, no external Postgres.                                         |
| Attachments            | **R2** through its S3 API (`TRACKER_BLOB_STORE=s3`).                                                                                                   |
| Sign-in                | **poietic.tech SSO**: the tracker accepts the `.poietic.tech` session cookie and verifies it against auth's JWKS.                                      |
| Who gets in            | **Request access.** A poietic `role=admin` becomes an active tracker admin. Everyone else is created deactivated until a tracker admin activates them. |
| Reachability           | Public URL; the tracker's own auth protects the data. No Cloudflare Access.                                                                            |

Rejected:

- **Neon or another external Postgres:** a second vendor and account.
- **D1:** no interactive transactions, and `withWriteTx` relies on them.
- **Porting the tracker to Workers with Durable Object SQLite:** the right long-term native shape, but a large port. Revisit separately.
- **A VPS with a tunnel, or a PaaS:** breaks the all-Cloudflare goal.

## 1. Runtime

```
browser ──▶ issues.poietic.tech (Workers route, OpenTofu)
              │
              ▼
           Worker poietic-issues ──▶ Durable Object TrackerContainer (one id: "main")
                                         │
                                         ▼
                                   container (this Dockerfile + Litestream)
                                     node dist/server.mjs :3000
                                     /data/tracker.db ──Litestream──▶ R2 poietic-issues-db
                                     attachments ──S3 API──────────▶ R2 poietic-issues-attachments
```

### Worker (`deploy/cloudflare/src/worker.ts`)

- Every request goes to `getContainer(env.TRACKER, "main")`, a single instance.
- `TrackerContainer extends Container` (from `@cloudflare/containers`):
  - `defaultPort = 3000`;
  - `sleepAfter = "30m"`;
  - `envVars` built from the Worker's secrets and vars (see Configuration).
- Responses are streamed through unbuffered, so the SSE stream at `/api/v1/events/stream` works. An open stream keeps the container awake.

### Container image

- It is this repository's `Dockerfile` plus a `litestream` binary and an entrypoint script. The image is built `linux/amd64` by `wrangler deploy` in CI.
- The entrypoint script:
  1. runs `litestream restore -if-db-not-exists -if-replica-exists /data/tracker.db`, so a brand-new replica starts an empty database and the tracker migrates it;
  2. runs `exec litestream replicate -exec "node dist/server.mjs"`. Litestream supervises the server, forwards `SIGTERM`, and flushes the replica after the server exits.
- It writes Litestream's config, pointing at the R2 bucket `poietic-issues-db` through R2's S3 endpoint.

### Single-writer guarantee

- Litestream requires exactly one writer per replica. The Durable Object id `"main"` is globally unique, and a Durable Object owns at most one container, so steady state has one writer.
- **To verify during implementation:**
  - that a `wrangler deploy` rollout stops the old container before the new one starts restoring;
  - that the platform's shutdown grace period is long enough for Litestream's final sync.

  If either fails, the plan must add a guard. For example, the Worker could hold a lease in Durable Object storage that the entrypoint checks before restoring.

### Durability and limits (accepted)

- A clean sleep or redeploy loses nothing. A crash can lose up to about one second of writes, Litestream's sync interval.
- A cold start after sleep adds the restore time, which is small while the database is small.
- Webhook deliveries only run while the container is awake. Failed deliveries are retried after the next wake-up.
- The `tracker` CLI cannot be `docker exec`'d into the container. Admin tasks go through the web UI or the CLI in remote mode (`TRACKER_SERVER` plus a token).
- Requires the **Workers Paid** plan.

## 2. poietic-dot-tech changes (one PR, applied by its CI)

- **`infra/issues.tf`:**
  - A `project-site` module block with `subdomain = "issues"`. It creates the DNS record, the placeholder Worker `poietic-issues` and the route. The module's `ignore_changes = all` covers the container, Durable Object and secret bindings that Wrangler adds.
  - `cloudflare_r2_bucket.issues_db` (`poietic-issues-db`) and `cloudflare_r2_bucket.issues_attachments` (`poietic-issues-attachments`), both with `prevent_destroy`.
  - Check during planning that CI's token can manage R2 buckets. If it can't, widen it deliberately.
- **`infra/api/`** (idempotent scripts, run through the `cloudflare-devops` agent's `cf` wrapper, never stored in OpenTofu state):
  - the `poietic-issues-deploy` token, via `deploy-token.sh`, with Workers Scripts Write plus whatever Containers permission `wrangler deploy` needs (confirm the exact permission group);
  - one R2 S3 credential scoped to the two buckets.

  Both are piped straight into `benjamin-small/poietic-issues` GitHub secrets. Minting tokens is a permissions change, so confirm with the owner first.

- **README:**
  - add `issues` to the subdomain list, and a row to the "Where the site lives" table;
  - add poietic-issues to the vendored-copies list, for the JWT verifier adapted from `packages/identity/verify.ts`;
  - add the new GitHub secrets.
- **No changes to `services/auth`.** It already allows any `https://*.poietic.tech` redirect, and `/me` is open over CORS to every subdomain.

## 3. Tracker SSO (poietic-issues)

The feature is generic, so the MIT-licensed tracker doesn't hard-code poietic. The poietic values live only in deploy config.

### Configuration (`apps/server/src/config.ts`)

| Variable                  | poietic value                                                                    |
| ------------------------- | -------------------------------------------------------------------------------- |
| `TRACKER_SSO_NAME`        | `poietic.tech` (label on the button)                                             |
| `TRACKER_SSO_COOKIE`      | `__Secure-poietic-session`                                                       |
| `TRACKER_SSO_ISSUER`      | `https://auth.poietic.tech`                                                      |
| `TRACKER_SSO_AUDIENCE`    | `poietic:public`                                                                 |
| `TRACKER_SSO_JWKS_URL`    | `https://auth.poietic.tech/.well-known/jwks.json`                                |
| `TRACKER_SSO_LOGIN_URL`   | `https://auth.poietic.tech/` (the tracker appends `?redirect=<its sign-in URL>`) |
| `TRACKER_SSO_REFRESH_URL` | `https://auth.poietic.tech/me`                                                   |
| `TRACKER_SSO_ADMIN_ROLE`  | `admin` (the token `role` that maps to an active tracker admin)                  |

SSO is enabled when `TRACKER_SSO_ISSUER` is set. In that case the cookie, audience, JWKS and login settings are required, and startup validation fails with a list of whatever is missing.

The exact auth sign-in page URL gets confirmed against `services/auth` during planning.

### Data (`packages/db` migration `0003_user_identities`)

- New table `user_identities`:
  - columns `issuer`, `subject`, `user_id`, `created_at`;
  - primary key `(issuer, subject)`;
  - `user_id` references `users`.
- Portable column helpers only, tested on SQLite and Postgres.

### Core (`packages/core/src/services/sso.ts`)

`signInWithSso(ctx, { issuer, subject, name, role }, { adminRole })`, in one `withWriteTx`:

1. **Known identity:** return its user. A deactivated user returns status `pending`.
2. **Unknown identity:** create a `human` user.
   - Handle: derived from `name` (slugified, lowercase, with a numeric suffix on collision). Fall back to `user` if the slug is empty.
   - Role: `admin` and active if `role === adminRole`; otherwise `member` and deactivated.
   - Link the identity, emit the usual user-created event, and return `active` or `pending`.
3. The display name is set only at creation. Later sign-ins never change role or name, following auth's own rule that privilege isn't re-derived at login.

### Token verification (`packages/core` or `apps/server`, WebCrypto only)

- An ES256 JWT verifier adapted from poietic-dot-tech `packages/identity/verify.ts`. It caches the JWKS for an hour, and an unknown `kid` forces a refetch at most once a minute.
- It checks `iss`, `aud` and `exp` using the injected clock.
- No new dependency. A header comment names the source commit, per poietic-dot-tech's vendoring rule.

### Routes (`apps/server/src/routes/auth.ts`)

- **`GET /auth/config`** gains `sso: { name, loginUrl, refreshUrl } | null`.
- **`POST /auth/sso`:**
  - Same-origin, using the existing CSRF check.
  - Reads the SSO cookie and verifies it, then calls `signInWithSso`.
  - Responses:
    - `active`: starts a normal `tracker_session` and returns `200 User`;
    - `pending`: `403` with problem code `PENDING_APPROVAL`;
    - missing or invalid cookie: `401 UNAUTHENTICATED`.
- Regenerate `docs/openapi.json` and the client types.

### Web (`apps/web`)

- When `sso` is configured, the sign-in page shows **"Sign in with poietic.tech"**. Clicking it:
  1. calls `fetch(refreshUrl, { credentials: "include" })` and ignores any failure (this renews a lapsed 10-minute token);
  2. calls `POST /auth/sso`;
  3. on `401`, navigates to `loginUrl` with `redirect` set to the sign-in page;
  4. on `403 PENDING_APPROVAL`, shows a "Waiting for approval" screen;
  5. on `200`, enters the app.
- On first load of the sign-in page, steps 1–2 run once automatically, so an already signed-in poietic user goes straight in.
- Token-paste sign-in stays, for agents and break-glass.
- Admins activate pending users through the existing user update (`deactivated: false`) in the users UI and CLI. No new approval UI.

### Accepted gap

Signing out of poietic.tech does not end an existing tracker session (`SESSION_TTL_MS`, 30 days). Signing out of the tracker ends only the tracker session.

## 4. Deployment (poietic-issues)

- **`deploy/cloudflare/`:**
  - `wrangler.jsonc`:
    - `name: poietic-issues`;
    - `workers_dev: false`, no routes (OpenTofu owns them);
    - a `containers` entry pointing at the image;
    - a Durable Object binding `TRACKER` and its migration;
    - non-secret vars, including the SSO values above.
  - Also here: `src/worker.ts`, the Litestream config, the entrypoint script, and a Dockerfile layer adding Litestream on top of the root `Dockerfile`.
- **Container env:**
  - `TRACKER_DATABASE_URL=sqlite:/data/tracker.db`;
  - `TRACKER_BLOB_STORE=s3`, with the R2 endpoint and bucket;
  - `TRACKER_SECURE_COOKIES=1`;
  - `TRACKER_LOG_FORMAT=json`;
  - the SSO vars;
  - secrets for the R2 credentials, used by both Litestream and S3.
- **`.github/workflows/deploy.yml`:**
  - runs on pushes to `main` after the existing CI passes;
  - `wrangler secret put` for each secret, then `wrangler deploy` from `deploy/cloudflare/`;
  - uses the repository's own `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
- **ADRs:**
  - `0018-sso-via-shared-cookie-jwt.md`;
  - `0019-cloudflare-containers-with-litestream.md`.
- **Docs:** a "Cloudflare Containers" section in `docs/deployment.md`, and the SSO variables added to its configuration table.

## 5. Rollout order

1. **poietic-dot-tech:** the infra PR is merged and applied, so the placeholder Worker and the buckets exist before the first Wrangler deploy. This also confirms the Workers Paid plan.
2. **Tokens:** deploy token and R2 credential minted into poietic-issues secrets, with the owner's confirmation.
3. **poietic-issues:** the SSO feature PR (migration, core, routes, web, ADR 0018, OpenAPI).
4. **poietic-issues:** the deploy PR (`deploy/cloudflare/`, workflow, ADR 0019, docs). Merging it deploys.
5. **Smoke test:**
   - the poietic admin signs in and becomes the tracker admin;
   - create a project and an issue, upload an attachment;
   - let the container sleep, then confirm the data survives the restore;
   - create an agent token for Claude.

## Testing

- **Core:** `signInWithSso` (new identity as admin or pending, known identity, collision handles, deactivated user) under SQLite and Postgres.
- **Verifier:** valid token, wrong `iss`/`aud`, expired, unknown `kid` (throttled refetch), bad signature. The JWKS fixture is generated in the test.
- **Server:** `POST /auth/sso` returns 200 with a cookie, 403 `PENDING_APPROVAL`, and 401; CSRF is enforced; `/auth/config` shape.
- **Web:** a Playwright case for the SSO button, against a stub JWKS, cookie and refresh endpoint.
- **Deployment:** the entrypoint is tested locally with Docker against a local S3 (SeaweedFS from `docker-compose.yml`): start, write, stop, wipe `/data`, start again, and check that the data is restored.
