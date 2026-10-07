#!/usr/bin/env bash
# Proves the Litestream image survives a container replacement: write → stop (SIGTERM) → fresh container → data restored.
# Uses SeaweedFS from docker-compose.yml as a stand-in for R2. Run from the repository root.
# Production (Cloudflare Containers) and the pinned Litestream tarball are linux/amd64, so everything is built and run as amd64
# (emulated on arm64 hosts, which is slower).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
PLATFORM=linux/amd64
cleanup() { docker rm -f tr-a tr-b >/dev/null 2>&1 || true; docker compose rm -sf seaweedfs >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker build --platform "$PLATFORM" -t tracker:local .
docker build --platform "$PLATFORM" -t tracker-cloudflare:test deploy/cloudflare
docker compose up -d seaweedfs
SW=$(docker compose ps -q seaweedfs)
# SeaweedFS only listens on its own compose network's address, so the test containers join that network (alias: seaweedfs).
NET=$(docker inspect "$SW" -f '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{end}}')
# Start from an empty bucket: the compose volume persists between runs and a stale replica would be restored into tr-a.
weed() { echo "$1" | docker compose exec -T seaweedfs weed shell -master=localhost:9333 2>&1; }
for i in $(seq 60); do
  weed "s3.bucket.create -name tracker-db" | grep -qE "created|already exists" && break
  sleep 2
done
weed "s3.bucket.delete -name tracker-db" >/dev/null
for i in $(seq 60); do
  weed "s3.bucket.create -name tracker-db" | grep -qE "created" && break
  sleep 2
done

# The bucket is created through the master; wait until the S3 gateway itself accepts connections (probed from the test network).
for i in $(seq 60); do
  docker run --rm --platform "$PLATFORM" --network "$NET" --entrypoint node tracker:local \
    -e 'require("net").connect(8333,"seaweedfs").on("connect",()=>process.exit(0)).on("error",()=>process.exit(1))' && break
  sleep 2
done

run() {
  docker run -d --platform "$PLATFORM" --name "$1" --network "$NET" -p 3999:3000 \
    -e LITESTREAM_ENDPOINT=http://seaweedfs:8333 -e LITESTREAM_BUCKET=tracker-db \
    -e LITESTREAM_ACCESS_KEY_ID=tracker -e LITESTREAM_SECRET_ACCESS_KEY=tracker-secret \
    -e TRACKER_SECURE_COOKIES=0 tracker-cloudflare:test >/dev/null
  for i in $(seq 120); do curl -fs http://127.0.0.1:3999/readyz >/dev/null && return; sleep 1; done
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
