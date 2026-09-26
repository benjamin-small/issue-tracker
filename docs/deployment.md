# Deployment

The tracker ships as **one process**: the HTTP API, the web app and the webhook worker. It runs on Postgres (SQLite also works for a single small instance) with attachments on local disk or any S3-compatible store.

## Quick start with Docker Compose

`docker-compose.yml` runs the production shape: tracker, Postgres 16 and SeaweedFS for S3 storage.

```sh
docker compose up -d --build --wait tracker
docker compose exec tracker tracker db bootstrap --handle you --name "Your Name"
```

`bootstrap` creates the first admin and prints an API token. Open http://localhost:3000, paste it into **API token** and sign in. Everything else, such as projects, users and more tokens, is managed from there or with the CLI:

```sh
export TRACKER_SERVER=http://localhost:3000 TRACKER_TOKEN=trk_…
tracker project create -k ENG --name Engineering
tracker user create --handle claude --name Claude --kind agent
tracker token create --user claude --name ci      # token for an agent
```

The compose file is a starting point, not a hardened production setup: it uses fixed passwords and plain HTTP. Put TLS in front of it (see [Reverse proxy](#reverse-proxy)) and change the credentials.

## The image

`docker build -t tracker .` produces a Node 22 slim image. It contains:

- `dist/server.mjs` and `dist/tracker.mjs`: single-file bundles made by `pnpm build` ([ADR 0014](adr/0014-packaging.md)).
- `web/`: the built SPA.
- The native SQLite driver.

The image runs as the `node` user, keeps state in `/data` (a volume), listens on port 3000, and has a `HEALTHCHECK` on `/readyz`. The `tracker` CLI is on the `PATH`, so admin tasks run with `docker exec … tracker …` in local mode against the same database.

Its defaults:

| Setting                | Value                     |
| ---------------------- | ------------------------- |
| `NODE_ENV`             | `production`              |
| `TRACKER_DATABASE_URL` | `sqlite:/data/tracker.db` |
| `TRACKER_BLOB_DIR`     | `/data/blobs`             |
| `TRACKER_AUTO_MIGRATE` | `1`                       |

Point `TRACKER_DATABASE_URL` at Postgres for anything beyond a single small instance.

Without Docker: `pnpm install && pnpm build`, then run `node dist/server.mjs` with `TRACKER_WEB_DIR=apps/web/build`. The bundles need only `better-sqlite3` from `node_modules`.

## Configuration

All settings are environment variables, validated at startup. An invalid value stops the process with a list of the problems. Defaults depend on `NODE_ENV`: development defaults (left) favour convenience, production defaults (right) favour safety.

| Variable                                                                 | Default (dev / production)      | Meaning                                                                                                         |
| ------------------------------------------------------------------------ | ------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `TRACKER_DATABASE_URL`                                                   | `sqlite:./data/dev.db`          | `postgres://user:pass@host:5432/db` or `sqlite:/path/file.db`.                                                  |
| `TRACKER_HOST` / `TRACKER_PORT`                                          | `127.0.0.1` / `0.0.0.0`; `3000` | Listen address.                                                                                                 |
| `TRACKER_AUTH_MODE`                                                      | `dev` / `standard`              | `dev` adds a user picker to the sign-in page (anyone can act as anyone). Refused in production.                 |
| `TRACKER_AUTO_MIGRATE`                                                   | `1` / `0` (`1` in the image)    | Apply pending migrations at startup. Otherwise the server refuses to start until `tracker db migrate` has run.  |
| `TRACKER_SEED`                                                           | `1` / `0`                       | Seed demo users and a project into an empty database.                                                           |
| `TRACKER_WEB_DIR`                                                        | —                               | Directory of the built web app to serve at `/`.                                                                 |
| `TRACKER_SECURE_COOKIES`                                                 | `0` / `1`                       | `Secure` session cookies (requires HTTPS).                                                                      |
| `TRACKER_ALLOWED_ORIGINS`                                                | —                               | Extra origins, comma-separated, that may send cookie-authenticated writes (CSRF allow-list).                    |
| `TRACKER_BLOB_STORE`                                                     | `local`                         | `local` or `s3`.                                                                                                |
| `TRACKER_BLOB_DIR`                                                       | `./data/blobs`                  | Attachment directory for `local`.                                                                               |
| `TRACKER_S3_ENDPOINT`, `_BUCKET`, `_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY` | —                               | Required for `s3`. `TRACKER_S3_REGION` defaults to `us-east-1`.                                                 |
| `TRACKER_S3_FORCE_PATH_STYLE`                                            | `true`                          | `endpoint/bucket/key` URLs. Set `false` for virtual-hosted buckets.                                             |
| `TRACKER_S3_PRESIGN`                                                     | `true`                          | Downloads redirect to presigned URLs. Set `0` to stream through the server when browsers can't reach the store. |
| `TRACKER_S3_PUBLIC_ENDPOINT`                                             | —                               | Browser-facing endpoint for presigned URLs, if it differs from `TRACKER_S3_ENDPOINT`.                           |
| `TRACKER_MAX_UPLOAD_MB`                                                  | `25`                            | Attachment size limit.                                                                                          |
| `TRACKER_WEBHOOKS`                                                       | `1`                             | Run the webhook worker in this process.                                                                         |
| `TRACKER_WEBHOOK_ALLOW_PRIVATE`                                          | `1` / `0`                       | Allow webhooks to use `http` and private addresses. Refused in production.                                      |
| `TRACKER_LOG_LEVEL`                                                      | `info`                          | `trace` … `fatal`, or `silent`.                                                                                 |
| `TRACKER_LOG_FORMAT`                                                     | `pretty` / `json`               | JSON lines for log collectors, or compact human-readable lines.                                                 |
| `TRACKER_SHUTDOWN_TIMEOUT_MS`                                            | `10000`                         | How long shutdown waits for in-flight requests.                                                                 |

## Database and migrations

- **Postgres 14+** is the production database. The server needs a normal user that owns its schema. Timestamps are `timestamptz`, and all times are UTC.
- **Migrations** are forward-only files compiled into the bundle. They run at startup when `TRACKER_AUTO_MIGRATE=1`. Kysely's migrator takes a lock, so replicas starting together are safe.
- **Explicit migrations.** To run migrations as a separate release step instead, set `TRACKER_AUTO_MIGRATE=0` and run `tracker db migrate` with `TRACKER_DATABASE_URL` set, e.g. `docker run --rm -e TRACKER_DATABASE_URL=… tracker tracker db migrate`.
- **Status.** `tracker db status` shows applied and pending migrations.
- **SQLite** works for single-instance installs. It runs in WAL mode with `BEGIN IMMEDIATE` writes, so the server and CLI can share the file. Put it on a local disk, not network storage.

**Backups** need the database (e.g. `pg_dump`) and the blob store: the bucket, or `/data/blobs`. Restore both from the same point in time. An attachment row whose bytes are missing downloads as 404; bytes without a row are only wasted space.

## Health, logs and shutdown

- **Health probes:**
  - `GET /healthz` is liveness (the process is serving).
  - `GET /readyz` is readiness: it checks the database, and returns `503` once shutdown has begun.
- **Logs** are JSON lines on stdout in production. There is one `request` entry per API call, with `reqId`, `method`, `path`, `status`, `ms` and `actor`. `reqId` matches the `X-Request-Id` response header and the `requestId` in problem responses.
- **Shutdown.** On `SIGTERM`/`SIGINT` the server:
  1. stops accepting connections and fails readiness;
  2. ends live event streams with a `shutdown` event, so browsers reconnect elsewhere and resume with `Last-Event-ID`;
  3. waits up to `TRACKER_SHUTDOWN_TIMEOUT_MS` for in-flight requests;
  4. stops the webhook worker and the event tailer, and closes the database.

  Webhook deliveries in flight when a process dies are retried by any replica once their 60-second lease expires.

## Scaling out

Several replicas can run against one Postgres database:

- **Live events.** Every replica tails the event log and is woken by `LISTEN/NOTIFY`, so live updates reach clients on any replica.
- **Webhooks.** Every replica with `TRACKER_WEBHOOKS=1` may deliver. Fan-out and claiming are serialized, so each delivery is sent once per attempt.
- **Attachments** must use S3 (or shared storage).
- **Sessions** live in the database, so no sticky sessions are needed.

## Reverse proxy

Terminate TLS in front of the server and set `TRACKER_SECURE_COOKIES=1` (the production default). Live updates use Server-Sent Events on `/api/v1/events/stream`, and **the proxy must not buffer them**:

```nginx
location / {
  proxy_pass http://tracker:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  client_max_body_size 30m;          # ≥ TRACKER_MAX_UPLOAD_MB
}
location /api/v1/events/stream {
  proxy_pass http://tracker:3000;
  proxy_buffering off;               # the server also sends X-Accel-Buffering: no
  proxy_read_timeout 1h;             # heartbeats are sent every 15 s
  proxy_http_version 1.1;
  proxy_set_header Connection '';
}
```

If the web app is served from a different origin than the API, add that origin to `TRACKER_ALLOWED_ORIGINS`.
