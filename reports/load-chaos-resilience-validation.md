# NO-GO — TASK-078 Load, Chaos and Resilience Validation

Date: 2026-07-22  
Repository commit: `464efc2d17057411e8264d892ff30c8acf874fa9`  
Execution environment: local repository validation only; no authorized staging fixture, credentials,
immutable deployed image digest, normalized diagnostics endpoint, chaos adapter or Kubernetes staging
context was available.

## Outcome

The root runners, threshold contract, deterministic staging fixture schema, provider-neutral chaos adapter,
explicit production safety guards, non-zero failure behavior, reports, runbook and manually approved staging
workflow are implemented. Contract and safety tests pass. Mandatory load, four-hour soak and destructive
staging chaos were not run because the required staging authorization and environment were absent. They are
fail-closed and cannot be represented as PASS by a local mock, shortened soak or no-op adapter.

TASK-079 must not start until all rows below have real staging PASS evidence.

## Scenario evidence

<!-- prettier-ignore -->
| Scenario | Environment / image | Workload | Required duration | Concurrency | p50 / p95 / p99 | Error rate | Queue lag | DB / Redis | CPU / memory | Recovery | Invariant result | Result |
| --- | --- | --- | ---: | ---: | --- | --- | --- | --- | --- | --- | --- | --- |
| LOAD-OPS-001 Read API | staging not configured / digest unavailable | market overview, symbol detail/chart, scanner results, watchlist summary, portfolio positions, backtest summary/trades | >= 60 s | >= 12 | not measured | target < 1%; not measured | not measured | not measured | not measured | n/a | cross-user leakage not measured | FAIL — mandatory run absent |
| LOAD-OPS-002 Mixed | staging not configured / digest unavailable | reads + scanner create + alert evaluation + portfolio recalculate + backtest create + experiment orchestration | >= 300 s | >= 12 | not measured | target < 1%; not measured | <= 60,000 ms; not measured | pool < 90%, waiters = 0; not measured | not measured | <= 120 s; not measured | durable loss/duplicates/cancellation not measured | FAIL — mandatory run absent |
| LOAD-OPS-003 Soak | staging not configured / digest unavailable | sustained mixed staging workload | >= 14,400 s | >= 12 | not measured | target < 1%; not measured | <= 60,000 ms; not measured | leak/saturation not measured | memory drift <= 10%; not measured | n/a | connection/cache/log/FD/latency drift not measured | FAIL — mandatory run absent |
| CHAOS-OPS-001 Redis restart | staging not configured / digest unavailable | active API and workers | adapter-controlled | fixture-defined | not measured | not measured | not measured | not measured | not measured | <= 120 s; not measured | durable loss = 0 and duplicate result = 0 not measured | FAIL — mandatory run absent |
| CHAOS-OPS-002 Worker termination | staging not configured / digest unavailable | active scanner/backtest/experiment | adapter-controlled | fixture-defined | not measured | not measured | not measured | not measured | not measured | <= 180 s; not measured | checkpoint/retry, duplicate fill/result = 0, terminal state not measured | FAIL — mandatory run absent |
| CHAOS-OPS-003 PostgreSQL interruption | staging not configured / digest unavailable | reads, writes and queued work | adapter-controlled | fixture-defined | not measured | not measured | not measured | not measured | not measured | <= 180 s; not measured | readiness false, bounded retry, corruption = 0, backpressure not measured | FAIL — mandatory run absent |
| CHAOS-OPS-004 Object storage | staging not configured / digest unavailable | export and series artifacts | adapter-controlled | fixture-defined | not measured | not measured | not measured | not measured | not measured | <= 180 s; not measured | retry, visible status and DB corruption = 0 not measured | FAIL — mandatory run absent |
| CHAOS-OPS-005 Bad release rollback | staging not configured / digest unavailable | unhealthy canary and synthetic checks | adapter-controlled | fixture-defined | not measured | not measured | not measured | not measured | not measured | <= 300 s; not measured | rollout stop, migration compatibility, rollback and synthetic recovery not measured | FAIL — mandatory run absent |
| CHAOS-OPS-006 Stale market data | staging not configured / digest unavailable | market freshness, UI, scanner and alerts | adapter-controlled | fixture-defined | not measured | not measured | not measured | not measured | not measured | <= 120 s; not measured | freshness alert/banner/policies and false freshness = 0 not measured | FAIL — mandatory run absent |

## Preserved feature thresholds

`pnpm resilience:validate` compares the new production contract to the existing authoritative JSON files;
the new runner does not copy or loosen them:

- Market overview warm p95 <= 500 ms; symbol aggregate <= 700 ms; chart <= 900 ms.
- Scanner result pagination p95 <= 300 ms.
- Watchlist market summary p95 <= 750 ms.
- Portfolio positions real HTTP p95 <= 500 ms.
- Backtest summary and trade cursor page p95 <= 500 ms.
- Error rate is strictly below 1%; equality is failure.
- Four-hour soak duration and minimum concurrency cannot be reduced by environment overrides.

## Implementation and fail-closed verification

- `pnpm test:resilience`: PASS, 5/5; staging/production target guard, bounded histogram,
  substitution, adapter context, executable allowlist and shell rejection covered.
- `pnpm resilience:validate`: PASS; three load and six chaos scenarios present, all prior p95 values equal
  their source contracts, four-hour soak minimum preserved.
- `pnpm workflow:lint`: PASS for the manually approved, staging-scoped workflow.
- `pnpm format:check`: PASS.
- `pnpm validate:adr`: PASS, 25 ADR files; no ADR changed or created.
- `pnpm lint`: PASS, 8/8 workspaces.
- `pnpm typecheck`: PASS, 8/8 workspaces.
- `pnpm secret:scan`: PASS; no leak found.
- `git diff --check` and Node syntax checks for all four operations scripts: PASS.
- `pnpm perf:production --scenario read-load`: expected non-zero exit 1 with
  `STAGING_FIXTURE_NOT_CONFIGURED`.
- `pnpm chaos:staging --scenario redis-restart`: expected non-zero exit 1 with
  `STAGING_FIXTURE_NOT_CONFIGURED`.
- Missing scenario, diagnostics field, ownership probe, mixed operation, threshold breach, invariant
  failure, mutable image digest, production target, absent approval and unresolved adapter all fail closed.
- Chaos recovery runs from `finally`; shell commands and executables outside the adapter allowlist are
  rejected.
- No production deployment or destructive production operation was initiated.

## Required next evidence

An authorized operator must materialize the ignored staging fixture/adapter from the examples, provide two
isolated synthetic users plus operations/metrics credentials, expose the admin-safe normalized diagnostic
snapshot, select the immutable deployed image digest, and execute all nine scenarios. The generated JSON
and Markdown reports must show every threshold and invariant as PASS. Until then, mandatory chaos/soak is
not verifiable and this task remains NO-GO.
