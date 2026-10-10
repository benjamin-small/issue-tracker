# Cloudflare Containers deployment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the tracker to `https://issues.poietic.tech` on Cloudflare Containers, with SQLite replicated to R2 by Litestream and attachments in R2. Deploys run from this repository's CI.

**Architecture:**

- **Workspace package.** A new `deploy/cloudflare` workspace package holds:
  - a tiny Worker that sends every request to one `Container` Durable Object (id `"main"`);
  - that Container's class;
  - a Dockerfile layering Litestream onto the existing tracker image.
- **Container start-up.** The container's entrypoint is `litestream replicate -restore-if-db-not-exists -exec "node /app/dist/server.mjs"`:
  1. it restores `/data/tracker.db` from R2 on a cold start (a first boot with no replica starts empty);
  2. it streams WAL changes to R2 while the tracker runs;
  3. it forwards `SIGTERM` to the tracker, waits for it to exit, then does a final sync.
- **CI.** A GitHub Actions workflow builds the base image, sets the Worker secrets, and runs `wrangler deploy` after CI passes on `main`.

**Tech Stack:** Cloudflare Workers + Containers (`@cloudflare/containers`), Wrangler, Docker, Litestream 0.5.17, GitHub Actions, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-07-issues-poietic-tech-design.md`, sections 1, 4 and 5.

## Global Constraints

- **Worker and buckets.** The Worker name is exactly `poietic-issues`. OpenTofu in poietic-dot-tech owns its existence, DNS and route, so `wrangler.jsonc` sets `workers_dev: false` and declares **no routes**. R2 buckets: `poietic-issues-db` (Litestream) and `poietic-issues-attachments` (attachments).
- **Single instance.** Exactly one container: `getContainer(env.TRACKER, "main")` and `max_instances: 1`. Cloudflare runs at most one instance per Durable Object id, which is the single writer Litestream needs.
- **Container settings.** Image platform `linux/amd64`. `instance_type: "basic"` (1/4 vCPU, 1 GiB, 4 GB disk). `sleepAfter = "30m"`.
- **Litestream version.** Pinned to `0.5.17`; tarball SHA-256 `cfb371176d164437ae869f8351cfde49bd1804ae71c61923f75c9cba9c9c006d`.
- **Platform facts the design relies on.** The container sees `Host: container` (Containers rewrites it), so `TRACKER_ALLOWED_ORIGINS=https://issues.poietic.tech` is required for cookie-authenticated writes. On stop, the platform sends `SIGTERM` and allows 15 minutes before `SIGKILL`.
- **Secrets.** They come only from GitHub Actions: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (minted by poietic-dot-tech's `infra/api` scripts). Never commit them.
- **Repository rules.** New dependencies (`wrangler`, `@cloudflare/containers`, `@cloudflare/workers-types`) are recorded in ADR `0019`. `pnpm check` passes before every commit. Relative imports use `.ts` extensions.
- **Prerequisites (not in this plan):**
  - poietic-dot-tech's infra PR is applied (the Worker placeholder, route and both buckets exist);
  - the account is on Workers Paid;
  - the four secrets above are set on `benjamin-small/issue-tracker` (this repository's GitHub name);
  - the SSO plan (`2026-10-07-sso-shared-cookie.md`) has merged, which this plan's `TRACKER_SSO_*` values need.

---

## File map

| File                                                     | Responsibility                                                                           |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `deploy/cloudflare/package.json`                         | Workspace package `@tracker/deploy-cloudflare`: wrangler, containers, types, `typecheck` |
| `deploy/cloudflare/tsconfig.json`                        | Workers types, not Node types                                                            |
| `deploy/cloudflare/wrangler.jsonc`                       | Worker, container, DO binding and migration, non-secret vars                             |
| `deploy/cloudflare/src/container-env.ts`                 | Pure `containerEnv(env)`: Worker bindings → the container's environment                  |
| `deploy/cloudflare/src/container-env.test.ts`            | Tests for it                                                                             |
| `deploy/cloudflare/src/worker.ts`                        | `TrackerContainer` class and the `fetch` handler                                         |
| `deploy/cloudflare/Dockerfile`                           | `FROM tracker:local` + Litestream + entrypoint                                           |
| `deploy/cloudflare/litestream.yml`                       | Replica config (env-expanded)                                                            |
| `deploy/cloudflare/entrypoint.sh`                        | `exec litestream replicate …`                                                            |
| `deploy/cloudflare/test/restore.sh`                      | Local Docker test: write, stop, wipe, restore                                            |
| `pnpm-workspace.yaml`, `vitest.config.ts`                | Register the package and its tests                                                       |
| `.github/workflows/deploy.yml`                           | Build, set secrets, deploy                                                               |
| `docs/adr/0019-cloudflare-containers-with-litestream.md` | ADR                                                                                      |
| `docs/deployment.md`                                     | "Cloudflare Containers" section                                                          |

---

### Task 1: Workspace package and `containerEnv`

**Files:**

- Create: `deploy/cloudflare/package.json`, `deploy/cloudflare/tsconfig.json`, `deploy/cloudflare/src/container-env.ts`, `deploy/cloudflare/src/container-env.test.ts`
- Modify: `pnpm-workspace.yaml`, `vitest.config.ts`

**Interfaces:**

- Produces:

```ts
export interface WorkerEnv {
  // vars (wrangler.jsonc / --var)
  PUBLIC_ORIGIN: string; // "https://issues.poietic.tech"
  R2_ENDPOINT: string; // "https://<account>.r2.cloudflarestorage.com" (deploy-time --var)
  DB_BUCKET: string; // "poietic-issues-db"
  ATTACHMENTS_BUCKET: string; // "poietic-issues-attachments"
  SSO_NAME: string;
  SSO_COOKIE: string;
  SSO_ISSUER: string;
  SSO_AUDIENCE: string;
  SSO_JWKS_URL: string;
  SSO_LOGIN_URL: string;
  SSO_REFRESH_URL: string;
  // secrets
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
}
export function containerEnv(env: WorkerEnv): Record<string, string>;
```

- [x] **Step 1: Scaffold the package**

`deploy/cloudflare/package.json`:

```json
{
  "name": "@tracker/deploy-cloudflare",
  "version": "0.0.0",
  "private": true,
  "description": "Runs the tracker on Cloudflare Containers at issues.poietic.tech (SQLite replicated to R2 by Litestream).",
  "type": "module",
  "scripts": {
    "typecheck": "tsc -p .",
    "deploy": "wrangler deploy"
  },
  "dependencies": {
    "@cloudflare/containers": "^0.0.0"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.0.0",
    "typescript": "^5.0.0",
    "vitest": "^5.0.2",
    "wrangler": "^4.0.0"
  }
}
```

> Don't keep the placeholder ranges. Run `pnpm --filter @tracker/deploy-cloudflare add @cloudflare/containers@latest` and `pnpm --filter @tracker/deploy-cloudflare add -D wrangler@latest @cloudflare/workers-types@latest typescript@<root's version> vitest@<root's version>`. That pins the current versions in `pnpm-lock.yaml`, and the root's versions keep the toolchain the same. If `onlyBuiltDependencies` blocks the install, add `workerd` (and `sharp`, if pnpm names it) to `pnpm-workspace.yaml`.

`deploy/cloudflare/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "allowImportingTsExtensions": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["@cloudflare/workers-types"]
  },
  "include": ["src"]
}
```

`pnpm-workspace.yaml`: add `  - deploy/cloudflare` under `packages:`.

`vitest.config.ts`: change `projects` to `['packages/*', 'apps/server', 'apps/cli', 'deploy/cloudflare']`.

- [x] **Step 2: Write the failing test**

`deploy/cloudflare/src/container-env.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { containerEnv, type WorkerEnv } from './container-env.ts';

const env: WorkerEnv = {
  PUBLIC_ORIGIN: 'https://issues.poietic.tech',
  R2_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
  DB_BUCKET: 'poietic-issues-db',
  ATTACHMENTS_BUCKET: 'poietic-issues-attachments',
  SSO_NAME: 'poietic.tech',
  SSO_COOKIE: '__Secure-poietic-session',
  SSO_ISSUER: 'https://auth.poietic.tech',
  SSO_AUDIENCE: 'poietic:public',
  SSO_JWKS_URL: 'https://auth.poietic.tech/.well-known/jwks.json',
  SSO_LOGIN_URL: 'https://auth.poietic.tech/signin',
  SSO_REFRESH_URL: 'https://auth.poietic.tech/me',
  R2_ACCESS_KEY_ID: 'AKID',
  R2_SECRET_ACCESS_KEY: 'SECRET',
};

describe('containerEnv', () => {
  it('maps Worker bindings to the tracker and Litestream environment', () => {
    expect(containerEnv(env)).toEqual({
      TRACKER_DATABASE_URL: 'sqlite:/data/tracker.db',
      TRACKER_SECURE_COOKIES: '1',
      TRACKER_ALLOWED_ORIGINS: 'https://issues.poietic.tech',
      TRACKER_LOG_FORMAT: 'json',
      TRACKER_BLOB_STORE: 's3',
      TRACKER_S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
      TRACKER_S3_BUCKET: 'poietic-issues-attachments',
      TRACKER_S3_REGION: 'auto',
      TRACKER_S3_ACCESS_KEY_ID: 'AKID',
      TRACKER_S3_SECRET_ACCESS_KEY: 'SECRET',
      TRACKER_SSO_NAME: 'poietic.tech',
      TRACKER_SSO_COOKIE: '__Secure-poietic-session',
      TRACKER_SSO_ISSUER: 'https://auth.poietic.tech',
      TRACKER_SSO_AUDIENCE: 'poietic:public',
      TRACKER_SSO_JWKS_URL: 'https://auth.poietic.tech/.well-known/jwks.json',
      TRACKER_SSO_LOGIN_URL: 'https://auth.poietic.tech/signin',
      TRACKER_SSO_REFRESH_URL: 'https://auth.poietic.tech/me',
      LITESTREAM_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
      LITESTREAM_BUCKET: 'poietic-issues-db',
      LITESTREAM_ACCESS_KEY_ID: 'AKID',
      LITESTREAM_SECRET_ACCESS_KEY: 'SECRET',
    });
  });

  it('refuses to start without the R2 credentials', () => {
    expect(() => containerEnv({ ...env, R2_SECRET_ACCESS_KEY: '' })).toThrow(
      /R2_SECRET_ACCESS_KEY/,
    );
  });
});
```

- [x] **Step 3: Run it and confirm it fails**

Run: `pnpm install && pnpm vitest run --project @tracker/deploy-cloudflare`

Expected: FAIL with "Cannot find module './container-env.ts'". If Vitest names the project after the directory, use `--project cloudflare`; check with `pnpm vitest list`.

- [x] **Step 4: Implement it**

`deploy/cloudflare/src/container-env.ts`:

```ts
/** Worker bindings: `vars` in wrangler.jsonc (R2_ENDPOINT via `--var` at deploy) and secrets set by CI. */
export interface WorkerEnv {
  PUBLIC_ORIGIN: string;
  R2_ENDPOINT: string;
  DB_BUCKET: string;
  ATTACHMENTS_BUCKET: string;
  SSO_NAME: string;
  SSO_COOKIE: string;
  SSO_ISSUER: string;
  SSO_AUDIENCE: string;
  SSO_JWKS_URL: string;
  SSO_LOGIN_URL: string;
  SSO_REFRESH_URL: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
}

const REQUIRED = [
  'PUBLIC_ORIGIN',
  'R2_ENDPOINT',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
] as const;

/**
 * The container's environment. The tracker image's own defaults (NODE_ENV=production, port 3000, /data) stay;
 * this adds storage, the public origin (Containers rewrites Host to "container", so same-origin checks need it)
 * and SSO. Litestream reads the LITESTREAM_* values through litestream.yml.
 */
export function containerEnv(env: WorkerEnv): Record<string, string> {
  for (const name of REQUIRED)
    if (!env[name]) throw new Error(`${name} is not set on the poietic-issues Worker`);
  return {
    TRACKER_DATABASE_URL: 'sqlite:/data/tracker.db',
    TRACKER_SECURE_COOKIES: '1',
    TRACKER_ALLOWED_ORIGINS: env.PUBLIC_ORIGIN,
    TRACKER_LOG_FORMAT: 'json',
    TRACKER_BLOB_STORE: 's3',
    TRACKER_S3_ENDPOINT: env.R2_ENDPOINT,
    TRACKER_S3_BUCKET: env.ATTACHMENTS_BUCKET,
    TRACKER_S3_REGION: 'auto',
    TRACKER_S3_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID,
    TRACKER_S3_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY,
    TRACKER_SSO_NAME: env.SSO_NAME,
    TRACKER_SSO_COOKIE: env.SSO_COOKIE,
    TRACKER_SSO_ISSUER: env.SSO_ISSUER,
    TRACKER_SSO_AUDIENCE: env.SSO_AUDIENCE,
    TRACKER_SSO_JWKS_URL: env.SSO_JWKS_URL,
    TRACKER_SSO_LOGIN_URL: env.SSO_LOGIN_URL,
    TRACKER_SSO_REFRESH_URL: env.SSO_REFRESH_URL,
    LITESTREAM_ENDPOINT: env.R2_ENDPOINT,
    LITESTREAM_BUCKET: env.DB_BUCKET,
    LITESTREAM_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID,
    LITESTREAM_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY,
  };
}
```

- [x] **Step 5: Run the tests, typecheck and lint**

Run: `pnpm vitest run --project @tracker/deploy-cloudflare && pnpm typecheck && pnpm lint`

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add deploy/cloudflare pnpm-workspace.yaml pnpm-lock.yaml vitest.config.ts
git commit -m "deploy: Cloudflare package with the container environment mapping"
```

---

### Task 2: Container image with Litestream, proven locally

**Files:**

- Create: `deploy/cloudflare/Dockerfile`, `deploy/cloudflare/litestream.yml`, `deploy/cloudflare/entrypoint.sh`, `deploy/cloudflare/test/restore.sh`

**Interfaces:**

- Consumes: the root `Dockerfile`, built as `tracker:local`, and SeaweedFS from `docker-compose.yml`.
- Produces: an image whose entrypoint restores and then replicates `/data/tracker.db`.

- [x] **Step 1: Write the failing end-to-end test script**

`deploy/cloudflare/test/restore.sh`:

```bash
#!/usr/bin/env bash
# Proves the Litestream image survives a container replacement: write → stop (SIGTERM) → fresh container → data restored.
# Uses SeaweedFS from docker-compose.yml as a stand-in for R2. Run from the repository root.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
NET=tracker-restore-test
cleanup() { docker rm -f tr-a tr-b >/dev/null 2>&1 || true; docker compose rm -sf seaweedfs >/dev/null 2>&1 || true; docker network rm "$NET" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker build -t tracker:local .
docker build -t tracker-cloudflare:test deploy/cloudflare
docker compose up -d seaweedfs
SW=$(docker compose ps -q seaweedfs)
docker network create "$NET" >/dev/null
docker network connect --alias seaweedfs "$NET" "$SW"
for i in $(seq 60); do
  echo "s3.bucket.create -name tracker-db" | docker compose exec -T seaweedfs weed shell -master=localhost:9333 2>&1 | grep -qE "created|already exists" && break
  sleep 2
done

run() {
  docker run -d --name "$1" --network "$NET" -p 3999:3000 \
    -e LITESTREAM_ENDPOINT=http://seaweedfs:8333 -e LITESTREAM_BUCKET=tracker-db \
    -e LITESTREAM_ACCESS_KEY_ID=tracker -e LITESTREAM_SECRET_ACCESS_KEY=tracker-secret \
    -e TRACKER_SECURE_COOKIES=0 tracker-cloudflare:test >/dev/null
  for i in $(seq 60); do curl -fs http://127.0.0.1:3999/readyz >/dev/null && return; sleep 1; done
  docker logs "$1"; echo "container $1 never became ready"; exit 1
}

run tr-a
TOKEN=$(docker exec tr-a tracker db bootstrap --handle ada --name Ada | grep -oE 'trk_[A-Za-z0-9]+' | head -1)
curl -fs -X POST http://127.0.0.1:3999/api/v1/projects -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"key":"RST","name":"Restore test"}' >/dev/null
docker stop -t 60 tr-a >/dev/null   # SIGTERM → tracker exits → Litestream final sync
docker logs tr-a 2>&1 | grep -q "litestream shut down" || { docker logs tr-a; echo "no clean Litestream shutdown"; exit 1; }
docker rm tr-a >/dev/null

run tr-b                            # fresh disk: must restore from the replica
curl -fs http://127.0.0.1:3999/api/v1/projects/RST -H "authorization: Bearer $TOKEN" | grep -q '"key":"RST"' \
  || { docker logs tr-b; echo "FAIL: project not restored"; exit 1; }
echo "PASS: data survived container replacement"
```

`chmod +x deploy/cloudflare/test/restore.sh`

> The SeaweedFS S3 credentials `tracker` / `tracker-secret` come from `deploy/seaweedfs/s3.json`. If that file's identity can't create or write a second bucket, add `tracker-db` to its allowed actions or buckets.

- [x] **Step 2: Run it and confirm it fails**

Run: `deploy/cloudflare/test/restore.sh`

Expected: FAIL at `docker build … deploy/cloudflare` (there's no Dockerfile yet).

- [x] **Step 3: Write the image files**

`deploy/cloudflare/Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1
# The tracker image (root Dockerfile, built first as tracker:local) plus Litestream, which restores /data/tracker.db
# from R2 on a cold start and replicates it while the tracker runs. Containers have no persistent disk.
ARG BASE=tracker:local
FROM ${BASE}
USER root
ARG LITESTREAM_VERSION=0.5.17
ARG LITESTREAM_SHA256=cfb371176d164437ae869f8351cfde49bd1804ae71c61923f75c9cba9c9c006d
ADD https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-${LITESTREAM_VERSION}-linux-x86_64.tar.gz /tmp/litestream.tar.gz
RUN echo "${LITESTREAM_SHA256}  /tmp/litestream.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/litestream.tar.gz -C /usr/local/bin litestream \
  && rm /tmp/litestream.tar.gz
COPY litestream.yml /etc/litestream.yml
COPY --chmod=755 entrypoint.sh /usr/local/bin/tracker-entrypoint
USER node
ENTRYPOINT ["/usr/local/bin/tracker-entrypoint"]
CMD []
```

`deploy/cloudflare/litestream.yml`:

```yaml
# Expanded from the environment at startup (see src/container-env.ts).
dbs:
  - path: /data/tracker.db
    replica:
      type: s3
      bucket: ${LITESTREAM_BUCKET}
      path: tracker
      endpoint: ${LITESTREAM_ENDPOINT}
      region: auto
      force-path-style: true
      access-key-id: ${LITESTREAM_ACCESS_KEY_ID}
      secret-access-key: ${LITESTREAM_SECRET_ACCESS_KEY}
```

`deploy/cloudflare/entrypoint.sh`:

```sh
#!/bin/sh
# Restore on a fresh disk (no-op on first boot when no replica exists), then run the tracker under Litestream.
# Litestream forwards SIGTERM to the tracker, waits for it to exit, then performs a final sync before exiting.
set -eu
exec litestream replicate -config /etc/litestream.yml -restore-if-db-not-exists -exec "node /app/dist/server.mjs"
```

- [x] **Step 4: Run the test and confirm it passes**

Run: `deploy/cloudflare/test/restore.sh`

Expected: the last line is `PASS: data survived container replacement`.

If it fails:

- **No `litestream shut down` in the logs:** check that the tracker exits on `SIGTERM` within 60 s (`TRACKER_SHUTDOWN_TIMEOUT_MS` defaults to 10 s).
- **Restore finds nothing:** check the SeaweedFS bucket permissions note in Step 1.

- [x] **Step 5: Commit**

```bash
git add deploy/cloudflare
git commit -m "deploy: tracker image with Litestream restore/replicate, with a local restore test"
```

---

### Task 3: Worker, Container class and `wrangler.jsonc`

**Files:**

- Create: `deploy/cloudflare/src/worker.ts`, `deploy/cloudflare/wrangler.jsonc`

**Interfaces:**

- Consumes: `containerEnv`, `WorkerEnv` (Task 1); the image (Task 2).
- Produces:
  - Worker `poietic-issues`, whose default export `fetch` forwards to `getContainer(env.TRACKER, 'main')`;
  - Durable Object class `TrackerContainer`.

- [x] **Step 1: Write the Worker**

`deploy/cloudflare/src/worker.ts`:

```ts
import { Container, getContainer } from '@cloudflare/containers';
import { containerEnv, type WorkerEnv } from './container-env.ts';

interface Env extends WorkerEnv {
  TRACKER: DurableObjectNamespace<TrackerContainer>;
}

/**
 * One tracker process. A single Durable Object id ("main") means at most one container at a time — the single
 * writer Litestream requires. An open live-update stream counts as activity and keeps it awake.
 */
export class TrackerContainer extends Container<Env> {
  override defaultPort = 3000;
  override sleepAfter = '30m';
  override pingEndpoint = 'healthz';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.envVars = containerEnv(env);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return getContainer(env.TRACKER, 'main').fetch(request);
  },
} satisfies ExportedHandler<Env>;
```

> If `@cloudflare/containers` types reject `override` on these fields (they may be declared as plain properties), drop `override`. The root `noImplicitOverride` doesn't apply here, because this tsconfig doesn't extend the base.

- [x] **Step 2: Write `wrangler.jsonc`**

```jsonc
{
  // OpenTofu in benjamin-small/poietic-dot-tech (infra/issues.tf) owns this Worker's existence, DNS and route.
  // This file owns only what it serves. Never add routes or enable workers.dev here.
  "$schema": "../../node_modules/wrangler/config-schema.json",
  "name": "poietic-issues",
  "main": "src/worker.ts",
  "compatibility_date": "2026-10-07",
  "workers_dev": false,
  "preview_urls": false,
  "observability": { "enabled": true },
  "containers": [
    {
      "class_name": "TrackerContainer",
      "image": "./Dockerfile",
      "instance_type": "basic",
      "max_instances": 1,
    },
  ],
  "durable_objects": {
    "bindings": [{ "name": "TRACKER", "class_name": "TrackerContainer" }],
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["TrackerContainer"] }],
  "vars": {
    "PUBLIC_ORIGIN": "https://issues.poietic.tech",
    "DB_BUCKET": "poietic-issues-db",
    "ATTACHMENTS_BUCKET": "poietic-issues-attachments",
    "SSO_NAME": "poietic.tech",
    "SSO_COOKIE": "__Secure-poietic-session",
    "SSO_ISSUER": "https://auth.poietic.tech",
    "SSO_AUDIENCE": "poietic:public",
    "SSO_JWKS_URL": "https://auth.poietic.tech/.well-known/jwks.json",
    "SSO_LOGIN_URL": "https://auth.poietic.tech/signin",
    "SSO_REFRESH_URL": "https://auth.poietic.tech/me",
  },
  // R2_ENDPOINT is passed at deploy time (--var), built from CLOUDFLARE_ACCOUNT_ID.
  // Secrets (set by .github/workflows/deploy.yml): R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.
}
```

> Check the `$schema` path against where pnpm puts `wrangler` (`deploy/cloudflare/node_modules/wrangler/config-schema.json` is likelier). The current Wrangler may prefer the `exports` form for Durable Objects (`"exports": { "TrackerContainer": { "type": "durable-object", "storage": "sqlite" } }`) over `migrations`. Use whichever `wrangler deploy --dry-run` accepts without a deprecation warning.

- [x] **Step 3: Verify with a dry run**

Run: `docker build -t tracker:local . && cd deploy/cloudflare && pnpm exec wrangler deploy --dry-run --outdir /tmp/wr-dry --var R2_ENDPOINT:https://example.r2.cloudflarestorage.com`

Expected: the bundle builds, the container image builds from `./Dockerfile` (`FROM tracker:local` resolves locally), there are no config warnings, and no API calls are made. Then run `pnpm typecheck && pnpm lint` from the root: PASS.

- [x] **Step 4: Commit**

```bash
git add deploy/cloudflare
git commit -m "deploy: poietic-issues Worker fronting a single tracker container"
```

---

### Task 4: Deploy workflow

**Files:**

- Create: `.github/workflows/deploy.yml`

- [x] **Step 1: Write the workflow**

```yaml
name: Deploy

# Deploys to Cloudflare (issues.poietic.tech) after CI passes on main.
on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]
  workflow_dispatch:

concurrency:
  group: deploy-production
  cancel-in-progress: false

jobs:
  deploy:
    if: github.event_name == 'workflow_dispatch' || github.event.workflow_run.conclusion == 'success'
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.workflow_run.head_sha || github.sha }}
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Build the tracker base image
        run: docker build -t tracker:local .
      - name: Set Worker secrets
        working-directory: deploy/cloudflare
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
        run: |
          for s in CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY; do
            [ -n "${!s}" ] || { echo "::error::secret $s is empty"; exit 1; }
          done
          jq -n --arg id "$R2_ACCESS_KEY_ID" --arg secret "$R2_SECRET_ACCESS_KEY" \
            '{R2_ACCESS_KEY_ID: $id, R2_SECRET_ACCESS_KEY: $secret}' | pnpm exec wrangler secret bulk
      - name: Deploy
        working-directory: deploy/cloudflare
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        run: pnpm exec wrangler deploy --var "R2_ENDPOINT:https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com"
      - name: Smoke check
        run: |
          for i in $(seq 30); do
            curl -fs https://issues.poietic.tech/healthz && exit 0
            sleep 10
          done
          echo "::error::issues.poietic.tech did not become healthy"; exit 1
```

> **About `wrangler secret bulk` before the first deploy:** it applies to the existing placeholder Worker that OpenTofu created. If Wrangler refuses because the placeholder has no Durable Object bindings yet, move the step after `Deploy`. The first boot would then fail `containerEnv` and the smoke check retries, so also add a second `wrangler deploy` (or a container restart) after setting the secrets.

- [x] **Step 2: Lint the workflow**

Run: `pnpm dlx @action-validator/cli .github/workflows/deploy.yml` (or `actionlint`, if installed). Also run `pnpm format:check` from the root.

Expected: no errors.

- [x] **Step 3: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: deploy issues.poietic.tech after CI passes on main"
```

---

### Task 5: ADR 0019 and the deployment docs

**Files:**

- Create: `docs/adr/0019-cloudflare-containers-with-litestream.md`
- Modify: `docs/deployment.md`, and `docs/adr/README.md` if it indexes ADRs

- [x] **Step 1: Write the ADR**

```markdown
# 0019. Cloudflare Containers with Litestream for issues.poietic.tech

- **Status:** Accepted
- **Date:** 2026-10-07

## Context

The tracker is hosted at issues.poietic.tech, a domain served entirely by Cloudflare Workers that OpenTofu creates
in benjamin-small/poietic-dot-tech. It is a long-running Node process with a native SQLite driver and SSE streams.
Containers have no persistent disk, Cloudflare offers no hosted Postgres, and D1 lacks interactive transactions.

## Decision

- Run the unchanged tracker image on Cloudflare Containers behind a Worker (`deploy/cloudflare`), as one instance
  (Durable Object id `main`, `max_instances: 1`).
- Keep the database as SQLite on the container disk, replicated by Litestream 0.5 to the R2 bucket
  `poietic-issues-db`. It is restored on a fresh disk and synced on SIGTERM. Attachments go to R2 over the S3 API.
- New dependencies: `wrangler`, `@cloudflare/containers` and `@cloudflare/workers-types` (deploy package only), and
  the Litestream binary pinned by version and SHA-256 in the image.
- Deploy from this repository's CI after CI passes on `main`.

## Consequences

- All infrastructure stays on Cloudflare, and the tracker code needs no changes.
- A crash (not a clean stop) can lose the last second or so of writes. A cold start restores before serving.
  Webhooks are delivered only while the container is awake.
- Exactly one writer: never raise `max_instances` or use more than one Durable Object id while on SQLite.
- Escape hatches: point `TRACKER_DATABASE_URL` at a Postgres (Neon etc.) and drop Litestream. Or port the server to
  Workers with Durable Object SQLite, which removes the container.
```

- [x] **Step 2: Update `docs/deployment.md`**

Add a section `## Cloudflare Containers (issues.poietic.tech)` after "Reverse proxy". It should cover:

- **Layout.** Point to `deploy/cloudflare/` (Worker, container, Litestream) and the ADR, and include the request path: browser → Worker → container `:3000`.
- **Data.** SQLite at `/data/tracker.db`, replicated to R2 `poietic-issues-db`; attachments in R2 `poietic-issues-attachments`. To back up, copy both buckets. Restore by deleting nothing: a fresh container restores itself.
- **Deploys.** `.github/workflows/deploy.yml`, the secrets it needs, and that poietic-dot-tech owns the route.
- **Admin.** There is no `docker exec`. Use the CLI in remote mode (`TRACKER_SERVER=https://issues.poietic.tech TRACKER_TOKEN=…`). Approve SSO users with `tracker user edit <handle> --reactivate`.
- **Local test.** `deploy/cloudflare/test/restore.sh`.

- [x] **Step 3: Run the check and commit**

Run: `pnpm check`

Expected: PASS.

```bash
git add docs
git commit -m "docs: ADR 0019 and Cloudflare Containers deployment"
```

---

### Task 6: First deploy and smoke test (with the owner)

Runs after the infra PR is applied, the secrets exist, the SSO plan has merged and Tasks 1–5 have merged.

- [x] **Step 1:** Merging to `main` triggers CI, then Deploy. Watch the Deploy run until the smoke check passes.
      Result: Deploy run 37666099022 (`workflow_run`, 2026-10-07) succeeded, smoke check passed.
- [x] **Step 2:** Open `https://issues.poietic.tech`. The poietic admin account should land signed in as a tracker admin, through the automatic SSO attempt.
      Result: the owner signed in via poietic.tech SSO and reported it working; admin role not separately confirmed.
- [x] **Step 3:** Create a project and an issue, upload an attachment, and confirm the attachment downloads (a presigned R2 URL).
      Result (2026-10-10, after the 0004 upgrade): issue TEST-2 created in the existing TEST project; a text file and a PNG uploaded (201); the PNG's content link redirected to a presigned URL in `poietic-issues-attachments` and loaded as `image/png` 4×4. TEST-2 was then moved to the trash.
- [x] **Step 4:** Open the issue list in two tabs, edit in one, and confirm the other updates live. This shows SSE streams through `Container.fetch`. If it doesn't, change the Worker to proxy through `this.ctx.container.getTcpPort(3000).fetch(...)` and redeploy.
      Result (2026-10-10): renaming TEST-2 from one tab showed in the other tab's issue list within 3 seconds, with no reload. SSE streams through `Container.fetch`.
- [x] **Step 5:** Trigger a restart and confirm the data is restored. The Containers API has a stop/restart call, which the cloudflare-devops agent runs via `cf api`; otherwise wait out `sleepAfter`.
      Result: the container slept at 18:57:04Z (`litestream shut down`) and woke at 19:49:22Z with `restore completed` and no migrations.
- [x] **Step 5a: Rollout ordering (run before relying on a second deploy).** The spec's single-writer check: a `wrangler deploy` rollout must stop the old container, and let Litestream finish its final sync, before the new container restores. With a tab open on the live stream (the issue list), write something (create or edit an issue). Then trigger the Deploy workflow by `workflow_dispatch` on `main`. When the smoke check passes, reload and confirm the write survived. In the Worker's container logs (Workers Observability), confirm that the old container's `litestream shut down` line comes before the new container's `attempting restore before replication` / `restore completed`. If the write is lost, or the ordering is not guaranteed (overlap, or no `litestream shut down` before the restore), stop deploying: implement the spec's lease guard first (the Worker holds a lease in Durable Object storage that the entrypoint checks before restoring), and re-run this step.
      Result: run 37681019282 rolled v1→v2; old `litestream shut down` at 20:20:37.672Z, before the new instance's restore (20:20:41.886Z → 20:20:46.555Z, txid 0x0a). Stop-then-start, so no lease guard is needed (see ADR 0019).
- [x] **Step 6:** Create two agent identities, so history shows who acted and each token can be revoked on its own: - `claude`, for Claude sessions a person drives on their own machine. Its token lives only in that machine's CLI config (`poietic-issues auth login --server https://issues.poietic.tech --with-token`), never in CI. - `github-ci`, for unattended GitHub Actions workflows. Its token is the `poietic-tech` org Actions secret `POIETIC_ISSUES_TOKEN` (all repositories), next to the org variable `POIETIC_ISSUES_SERVER=https://issues.poietic.tech`.

      Both need a role on each private project they work in (`poietic-issues project members add @<agent> --role editor -P <KEY>`).
      Result (2026-10-10): both users exist (kind `agent`) and are editors on TEST. The `github-ci` token was verified against `/me` and stored as the org secret; the `claude` token is saved in the owner's local CLI config (mode 0600). Neither token value was displayed.
