#!/bin/sh
# Restore on a fresh disk, then run the tracker under Litestream.
# Fails closed: -restore-if-db-not-exists treats only "the replica is reachable and holds no backup" as a fresh start
# (first boot). Any error reading the replica (bad credentials, unreachable endpoint, missing bucket) makes Litestream
# exit non-zero before the tracker starts, so the container never serves an empty database over a real one.
# test/restore.sh covers both cases. Litestream forwards SIGTERM to the tracker, waits for it to exit, then performs a
# final sync before exiting.
set -eu
exec litestream replicate -config /etc/litestream.yml -restore-if-db-not-exists -exec "node /app/dist/server.mjs"
