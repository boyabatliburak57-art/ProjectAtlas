#!/usr/bin/env sh
set -eu

node scripts/production/validate-observability.mjs

if command -v promtool >/dev/null 2>&1; then
  promtool check rules observability/alerts/prometheus-rules.yaml
else
  docker run --rm \
    -v "$PWD/observability/alerts:/etc/atlas-alerts:ro" \
    --entrypoint /bin/promtool \
    prom/prometheus:v3.13.1 \
    check rules /etc/atlas-alerts/prometheus-rules.yaml
fi

if command -v amtool >/dev/null 2>&1; then
  amtool check-config observability/alerts/alertmanager.yaml
fi
