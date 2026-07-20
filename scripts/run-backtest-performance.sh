#!/usr/bin/env bash
set -euo pipefail

project="${BACKTEST_PERF_COMPOSE_PROJECT:-atlas-backtest-performance}"
postgres_port="${BACKTEST_PERF_POSTGRES_PORT:-55439}"
redis_port="${BACKTEST_PERF_REDIS_PORT:-56386}"
database="atlas_backtest_performance_test"
user="atlas"
password="atlas-backtest-performance-local"

pnpm --filter @atlas/domain build
pnpm --filter @atlas/database build
pnpm --filter @atlas/api build
pnpm --filter @atlas/worker build

cleanup() {
  POSTGRES_DB=atlas_backtest_performance POSTGRES_USER="$user" POSTGRES_PASSWORD="$password" \
    POSTGRES_PORT="$postgres_port" REDIS_PORT="$redis_port" \
    docker compose -p "$project" down -v >/dev/null 2>&1 || true
}
trap cleanup EXIT

POSTGRES_DB=atlas_backtest_performance POSTGRES_USER="$user" POSTGRES_PASSWORD="$password" \
  POSTGRES_PORT="$postgres_port" REDIS_PORT="$redis_port" \
  docker compose -p "$project" down -v --remove-orphans >/dev/null 2>&1 || true

POSTGRES_DB=atlas_backtest_performance POSTGRES_USER="$user" POSTGRES_PASSWORD="$password" \
  POSTGRES_PORT="$postgres_port" REDIS_PORT="$redis_port" \
  docker compose -p "$project" up -d --wait

database_created=false
for _attempt in $(seq 1 30); do
  if docker exec "${project}-postgres-1" createdb -U "$user" "$database" 2>/dev/null || \
    [[ "$(docker exec "${project}-postgres-1" psql -U "$user" -d postgres -Atc \
      "select 1 from pg_database where datname = '$database'" 2>/dev/null)" == "1" ]]; then
    database_created=true
    break
  fi
  sleep 1
done
if [[ "$database_created" != "true" ]]; then
  echo "Backtest performance database did not become ready" >&2
  exit 1
fi

set +e
TEST_DATABASE_URL="postgresql://${user}:${password}@127.0.0.1:${postgres_port}/${database}" \
REDIS_URL="redis://127.0.0.1:${redis_port}" \
  pnpm --filter @atlas/worker perf:backtest -- "$@"
benchmark_status=$?
set -e

if [[ -f reports/performance/backtest-benchmark.json ]]; then
  pnpm exec prettier --write \
    reports/performance/backtest-benchmark.json \
    reports/performance/backtest-benchmark.md
fi

exit "$benchmark_status"
