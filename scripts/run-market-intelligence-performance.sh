#!/usr/bin/env bash
set -euo pipefail

project="${MARKET_PERF_COMPOSE_PROJECT:-atlas-market-performance}"
postgres_port="${MARKET_PERF_POSTGRES_PORT:-55437}"
redis_port="${MARKET_PERF_REDIS_PORT:-56384}"
database="atlas_market_intelligence_performance_test"
user="atlas"
password="atlas-market-performance-local"

pnpm --filter @atlas/domain build
pnpm --filter @atlas/database build
pnpm --filter @atlas/api build

cleanup() {
  POSTGRES_DB=atlas_market_performance POSTGRES_USER="$user" POSTGRES_PASSWORD="$password" \
    POSTGRES_PORT="$postgres_port" REDIS_PORT="$redis_port" \
    docker compose -p "$project" down -v >/dev/null 2>&1 || true
}
trap cleanup EXIT

POSTGRES_DB=atlas_market_performance POSTGRES_USER="$user" POSTGRES_PASSWORD="$password" \
  POSTGRES_PORT="$postgres_port" REDIS_PORT="$redis_port" \
  docker compose -p "$project" up -d --wait

database_created=false
for _attempt in $(seq 1 30); do
  if docker exec "${project}-postgres-1" createdb -U "$user" "$database"; then
    database_created=true
    break
  fi
  sleep 1
done
if [[ "$database_created" != "true" ]]; then
  echo "Market intelligence performance database did not become ready" >&2
  exit 1
fi

set +e
TEST_DATABASE_URL="postgresql://${user}:${password}@127.0.0.1:${postgres_port}/${database}" \
REDIS_URL="redis://127.0.0.1:${redis_port}" \
  pnpm --filter @atlas/api perf:market "$@"
benchmark_status=$?
set -e

if [[ -f reports/performance/market-intelligence-baseline.json ]]; then
  pnpm exec prettier --write \
    reports/performance/market-intelligence-baseline.json \
    reports/performance/market-intelligence-baseline.md
fi

exit "$benchmark_status"
