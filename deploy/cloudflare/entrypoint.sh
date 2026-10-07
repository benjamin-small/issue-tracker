#!/bin/sh
# Restore on a fresh disk (no-op on first boot when no replica exists), then run the tracker under Litestream.
# Litestream forwards SIGTERM to the tracker, waits for it to exit, then performs a final sync before exiting.
set -eu
exec litestream replicate -config /etc/litestream.yml -restore-if-db-not-exists -exec "node /app/dist/server.mjs"
