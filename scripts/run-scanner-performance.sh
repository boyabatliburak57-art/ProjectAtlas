#!/usr/bin/env bash
set -euo pipefail

project="${SCANNER_PERF_COMPOSE_PROJECT:-atlas-scanner-performance}"
postgres_port="${SCANNER_PERF_POSTGRES_PORT:-55433}"
redis_port="${SCANNER_PERF_REDIS_PORT:-56380}"
database="atlas_performance_test"
user="atlas"
password="atlas-performance-local"

cleanup() {
  POSTGRES_DB=atlas_performance POSTGRES_USER="$user" POSTGRES_PASSWORD="$password" \
    POSTGRES_PORT="$postgres_port" REDIS_PORT="$redis_port" \
    docker compose -p "$project" down -v >/dev/null 2>&1 || true
}
trap cleanup EXIT

POSTGRES_DB=atlas_performance POSTGRES_USER="$user" POSTGRES_PASSWORD="$password" \
  POSTGRES_PORT="$postgres_port" REDIS_PORT="$redis_port" \
  docker compose -p "$project" up -d --wait

docker exec "${project}-postgres-1" createdb -U "$user" "$database"

TEST_DATABASE_URL="postgresql://${user}:${password}@127.0.0.1:${postgres_port}/${database}" \
REDIS_URL="redis://127.0.0.1:${redis_port}" \
  pnpm --filter @atlas/worker perf:scanner -- "$@"
