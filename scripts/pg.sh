#!/usr/bin/env bash
# Local throwaway Postgres for development and tests — no Docker required.
#
#   scripts/pg.sh start    init (if needed) and start the cluster, create the `tracker` database
#   scripts/pg.sh stop     stop the cluster
#   scripts/pg.sh reset    stop, delete all data, start fresh
#   scripts/pg.sh status   show whether it is running
#   scripts/pg.sh url      print the connection URL
#
# Tuned for speed, NOT durability (fsync=off). Never point this at data you care about.
# Env overrides: TRACKER_PG_DIR (data dir), TRACKER_PG_PORT (default 54329).
set -euo pipefail

PGDATA_DIR="${TRACKER_PG_DIR:-/var/tmp/tracker-pg}"
PORT="${TRACKER_PG_PORT:-54329}"
SOCKET_DIR="$(dirname "$PGDATA_DIR")"
LOG_FILE="$PGDATA_DIR.log"
DB_USER="tracker"
DB_NAME="tracker"
URL="postgres://$DB_USER@127.0.0.1:$PORT/$DB_NAME"

find_bin() {
  if command -v initdb >/dev/null 2>&1; then
    dirname "$(command -v initdb)"
    return
  fi
  local candidate
  candidate="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
  if [[ -n "$candidate" && -x "$candidate/initdb" ]]; then
    echo "$candidate"
    return
  fi
  echo "error: Postgres server binaries (initdb, pg_ctl) not found" >&2
  exit 1
}

PG_BIN="$(find_bin)"

# initdb refuses to run as root; drop to the `postgres` system user when needed.
as_pg() {
  if [[ "$(id -u)" == "0" ]]; then
    runuser -u postgres -- "$@"
  else
    "$@"
  fi
}

is_running() {
  [[ -f "$PGDATA_DIR/PG_VERSION" ]] && as_pg "$PG_BIN/pg_ctl" -D "$PGDATA_DIR" status >/dev/null 2>&1
}

start() {
  if [[ ! -f "$PGDATA_DIR/PG_VERSION" ]]; then
    mkdir -p "$PGDATA_DIR"
    if [[ "$(id -u)" == "0" ]]; then chown postgres: "$PGDATA_DIR"; fi
    as_pg "$PG_BIN/initdb" -D "$PGDATA_DIR" -A trust -U "$DB_USER" -E UTF8 --locale=C.UTF-8 >/dev/null
  fi
  if ! is_running; then
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

stop() {
  if is_running; then as_pg "$PG_BIN/pg_ctl" -D "$PGDATA_DIR" -m fast -w stop >/dev/null; fi
  echo "stopped"
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  reset)
    stop >/dev/null
    rm -rf "$PGDATA_DIR" "$LOG_FILE"
    start
    ;;
  status) if is_running; then echo "running: $URL"; else echo "not running"; exit 1; fi ;;
  url) echo "$URL" ;;
  *)
    sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
