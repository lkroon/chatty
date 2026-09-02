#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
NET="chatty-test-net_$$"
PG="chatty-test-pg_$$"

docker network create "$NET" >/dev/null
docker run -d --rm --name "$PG" --network "$NET" \
  -e POSTGRES_USER=app -e POSTGRES_PASSWORD=app -e POSTGRES_DB=appdb \
  postgres:16 >/dev/null

cleanup() {
  docker rm -f "$PG" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "waiting for postgres..."
until docker exec "$PG" pg_isready -U app -d appdb >/dev/null 2>&1; do sleep 1; done

DATABASE_URL="postgresql://app:app@${PG}:5432/appdb"
docker run --rm --network "$NET" -v "$ROOT:/code" -w /code \
  -e DATABASE_URL="$DATABASE_URL" \
  -e TEST_DATABASE_URL="$DATABASE_URL" \
  node:22-alpine sh -c \
  'npm ci && npx ts-node apps/api/src/db/run-migrations.ts && npm run test -w apps/api -- --runInBand'
