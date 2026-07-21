#!/usr/bin/env sh
set -eu

api_image="${1:-atlas-api:task-073}"
worker_image="${2:-atlas-worker:task-073}"
migration_image="${3:-atlas-migration:task-073}"
web_image="${4:-atlas-web:task-073}"
suffix="${ATLAS_SMOKE_SUFFIX:-$$}"
network="atlas-task073-${suffix}"
postgres="atlas-task073-postgres-${suffix}"
redis="atlas-task073-redis-${suffix}"
api="atlas-task073-api-${suffix}"
worker="atlas-task073-worker-${suffix}"
web="atlas-task073-web-${suffix}"
port="${ATLAS_SMOKE_PORT:-43173}"
web_port="${ATLAS_SMOKE_WEB_PORT:-43174}"

cleanup() {
  docker rm -f "$api" "$worker" "$web" "$postgres" "$redis" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker network create "$network" >/dev/null
docker run -d --name "$postgres" --network "$network" \
  -e POSTGRES_DB=atlas_smoke -e POSTGRES_USER=atlas -e POSTGRES_PASSWORD=smoke-only \
  postgres:17-alpine >/dev/null
docker run -d --name "$redis" --network "$network" redis:7-alpine >/dev/null

until docker exec "$postgres" pg_isready -U atlas -d atlas_smoke >/dev/null 2>&1; do sleep 1; done
until docker exec "$redis" redis-cli ping >/dev/null 2>&1; do sleep 1; done

database_url="postgresql://atlas:smoke-only@${postgres}:5432/atlas_smoke"
redis_url="redis://${redis}:6379"
common_env="--env ATLAS_ENV=staging --env NODE_ENV=production --env CONFIG_SCHEMA_VERSION=1 --env TELEMETRY_POLICY_VERSION=telemetry-v1 --env AUTH_SESSION_HMAC_KEY=smoke-auth-session-hmac-key-000000 --env SECURITY_RATE_LIMIT_ENABLED=true --env METRICS_BEARER_TOKEN=smoke-metrics-token-change-me-00000000 --env DATABASE_URL=${database_url} --env REDIS_URL=${redis_url} --env OBJECT_STORAGE_ENDPOINT=https://object.invalid --env OBJECT_STORAGE_BUCKET=atlas-smoke --env OBJECT_STORAGE_ACCESS_KEY_ID=smoke-access --env OBJECT_STORAGE_SECRET_ACCESS_KEY=smoke-secret --env RELEASE_VERSION=task-073 --env RELEASE_COMMIT_SHA=0000000"

# shellcheck disable=SC2086
docker run --rm --network "$network" $common_env "$migration_image"

api_user="$(docker image inspect "$api_image" --format '{{.Config.User}}')"
worker_user="$(docker image inspect "$worker_image" --format '{{.Config.User}}')"
web_user="$(docker image inspect "$web_image" --format '{{.Config.User}}')"
test "$api_user" = node || test "$api_user" = 1000
test "$worker_user" = node || test "$worker_user" = 1000
test "$web_user" = node || test "$web_user" = 1000

docker run -d --name "$web" --network "$network" \
  -p "127.0.0.1:${web_port}:3000" "$web_image" >/dev/null
attempts=0
until curl --fail --silent --show-error \
  --output /dev/null "http://127.0.0.1:${web_port}/health"; do
  attempts=$((attempts + 1))
  test "$attempts" -lt 60
  sleep 1
done

# shellcheck disable=SC2086
docker run -d --name "$api" --network "$network" -p "127.0.0.1:${port}:3001" \
  $common_env --env API_CORS_ORIGIN=https://staging.atlas.example \
  --env API_DEBUG=false --env HEALTH_CHECK_DATABASE=true "$api_image" >/dev/null

for path in live startup ready; do
  attempts=0
  until curl --fail --silent --show-error \
    --output "/tmp/atlas-${path}-${suffix}.json" \
    "http://127.0.0.1:${port}/health/${path}"; do
    attempts=$((attempts + 1))
    test "$attempts" -lt 60
    sleep 1
  done
  if grep -E 'hostname|postgresql://|redis://|smoke-secret' "/tmp/atlas-${path}-${suffix}.json"; then
    echo "unsafe health payload: ${path}" >&2
    exit 1
  fi
  rm -f "/tmp/atlas-${path}-${suffix}.json"
done

# shellcheck disable=SC2086
docker run -d --name "$worker" --network "$network" $common_env \
  --env WORKER_ROLE=market-data --env WORKER_HEALTH_FILE=/tmp/atlas-worker-ready \
  --env WORKER_DEBUG=false "$worker_image" >/dev/null
attempts=0
until test "$(docker inspect "$worker" --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}')" = healthy; do
  attempts=$((attempts + 1))
  test "$attempts" -lt 60
  sleep 1
done

docker stop --time 30 "$api" >/dev/null
docker stop --time 120 "$worker" >/dev/null
docker stop --time 30 "$web" >/dev/null
test "$(docker inspect "$api" --format '{{.State.Running}}')" = false
test "$(docker inspect "$worker" --format '{{.State.Running}}')" = false
test "$(docker inspect "$web" --format '{{.State.Running}}')" = false
echo 'Container non-root, startup, probes and SIGTERM shutdown checks passed for web, API and worker.'
