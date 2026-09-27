#!/usr/bin/env bash
# Local throwaway Postgres for development and tests. Uses local server binaries when installed,
# otherwise a Docker container (for example on macOS without Homebrew Postgres).
#
#   scripts/pg.sh start    init (if needed) and start the cluster, create the `tracker` database
#   scripts/pg.sh stop     stop the cluster
#   scripts/pg.sh reset    stop, delete all data, start fresh
#   scripts/pg.sh status   show whether it is running
#   scripts/pg.sh url      print the connection URL
#
# Tuned for speed, NOT durability (fsync=off). Never point this at data you care about.
# Env overrides: TRACKER_PG_DIR (data dir), TRACKER_PG_PORT (default 54329),
#   TRACKER_PG_BACKEND (native|docker; default: native when binaries exist, else docker).
set -euo pipefail

PGDATA_DIR="${TRACKER_PG_DIR:-/var/tmp/tracker-pg}"
PORT="${TRACKER_PG_PORT:-54329}"
SOCKET_DIR="$(dirname "$PGDATA_DIR")"
LOG_FILE="$PGDATA_DIR.log"
DB_USER="tracker"
DB_NAME="tracker"
URL="postgres://$DB_USER@127.0.0.1:$PORT/$DB_NAME"
CONTAINER="tracker-pg"
IMAGE="postgres:16"

find_bin() {
  if command -v initdb >/dev/null 2>&1; then
    dirname "$(command -v initdb)"
    return
  fi
  local candidate
  candidate="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
  if [[ -n "$candidate" && -x "$candidate/initdb" ]]; then
    echo "$candidate"
  fi
}

BACKEND="${TRACKER_PG_BACKEND:-}"
PG_BIN="$(find_bin)"
if [[ -z "$BACKEND" ]]; then
  if [[ -n "$PG_BIN" ]]; then
    BACKEND=native
  elif command -v docker >/dev/null 2>&1; then
    BACKEND=docker
  fi
fi
case "$BACKEND" in
  native) [[ -n "$PG_BIN" ]] || { echo "error: Postgres server binaries (initdb, pg_ctl) not found" >&2; exit 1; } ;;
  docker) command -v docker >/dev/null 2>&1 || { echo "error: docker not found" >&2; exit 1; } ;;
  *)
    echo "error: need Postgres server binaries (initdb, pg_ctl) or Docker" >&2
    exit 1
    ;;
esac

# initdb refuses to run as root; drop to the `postgres` system user when needed.
as_pg() {
  if [[ "$(id -u)" == "0" ]]; then
    runuser -u postgres -- "$@"
  else
    "$@"
  fi
}

native_is_running() {
  [[ -f "$PGDATA_DIR/PG_VERSION" ]] && as_pg "$PG_BIN/pg_ctl" -D "$PGDATA_DIR" status >/dev/null 2>&1
}

native_start() {
  if [[ ! -f "$PGDATA_DIR/PG_VERSION" ]]; then
    mkdir -p "$PGDATA_DIR"
    if [[ "$(id -u)" == "0" ]]; then chown postgres: "$PGDATA_DIR"; fi
    as_pg "$PG_BIN/initdb" -D "$PGDATA_DIR" -A trust -U "$DB_USER" -E UTF8 --locale=C.UTF-8 >/dev/null
  fi
  if ! native_is_running; then
    touch "$LOG_FILE"
    if [[ "$(id -u)" == "0" ]]; then chown postgres: "$LOG_FILE"; fi
    as_pg "$PG_BIN/pg_ctl" -D "$PGDATA_DIR" -l "$LOG_FILE" -w \
      -o "-p $PORT -k $SOCKET_DIR -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off" \
      start >/dev/null
  fi
  if ! "$PG_BIN/psql" "postgres://$DB_USER@127.0.0.1:$PORT/postgres" -tAc \
    "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1; then
    "$PG_BIN/createdb" -h 127.0.0.1 -p "$PORT" -U "$DB_USER" "$DB_NAME"
  fi
  echo "$URL"
}

native_stop() {
  if native_is_running; then as_pg "$PG_BIN/pg_ctl" -D "$PGDATA_DIR" -m fast -w stop >/dev/null; fi
  echo "stopped"
}

# Docker backend: same user, database, port and non-durable settings; data lives in the container.
docker_is_running() {
  [[ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null)" == "true" ]]
}

docker_start() {
  if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
    docker run -d --name "$CONTAINER" -p "127.0.0.1:$PORT:5432" \
      -e POSTGRES_USER="$DB_USER" -e POSTGRES_DB="$DB_NAME" -e POSTGRES_HOST_AUTH_METHOD=trust \
      "$IMAGE" -c fsync=off -c synchronous_commit=off -c full_page_writes=off >/dev/null
  elif ! docker_is_running; then
    docker start "$CONTAINER" >/dev/null
  fi
  # The image's first-run init uses a socket-only server, so wait for TCP to be sure the real one is up.
  local i
  for i in $(seq 60); do
    if docker exec "$CONTAINER" pg_isready -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
      echo "$URL"
      return
    fi
    sleep 1
  done
  echo "error: Postgres container did not become ready; see: docker logs $CONTAINER" >&2
  exit 1
}

docker_stop() {
  if docker_is_running; then docker stop "$CONTAINER" >/dev/null; fi
  echo "stopped"
}

docker_reset() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker_start
}

native_reset() {
  native_stop >/dev/null
  rm -rf "$PGDATA_DIR" "$LOG_FILE"
  native_start
}

case "${1:-}" in
  start) "${BACKEND}_start" ;;
  stop) "${BACKEND}_stop" ;;
  reset) "${BACKEND}_reset" ;;
  status) if "${BACKEND}_is_running"; then echo "running ($BACKEND): $URL"; else echo "not running"; exit 1; fi ;;
  url) echo "$URL" ;;
  *)
    sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
