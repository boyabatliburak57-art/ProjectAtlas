# Load, Chaos and Resilience Runbook

## Safety boundary

The runners target an already deployed, isolated staging environment. They never deploy production and
they reject any fixture whose environment is not exactly `staging`, whose hostname is not explicitly a
staging/localhost host, or whose release is not identified by an immutable SHA-256 image digest. Chaos
also requires `ATLAS_STAGING_CHAOS_APPROVAL=TASK-078-STAGING-ONLY` and an adapter with a staging
context/namespace. Commands are executed directly without a shell and only from the adapter allowlist.

Copy, do not edit, the examples below into ignored operator-owned files:

```sh
cp performance/fixtures/production-staging-v1.example.json \
  performance/fixtures/production-staging-v1.json
cp deploy/chaos/staging-adapter.example.json deploy/chaos/staging-adapter.json
```

The fixture contains resource identifiers, never bearer tokens. Token field values name environment
variables. The normalized diagnostic snapshot is an authenticated staging-operations adapter over the
existing observability metrics. It must return queue lag, DB pool capacity/waiters, Redis saturation,
CPU/memory, connections, cache size, file descriptors, log/metric volume, cancellation latency, pending
synthetic jobs, durable loss and duplicate counters. Chaos scenarios additionally expose the documented
scenario booleans. Missing evidence is a failure, not a skipped check.

The snapshot numeric contract is: `apiP50Ms`, `apiP95Ms`, `apiP99Ms`, `apiMaxMs`,
`apiLatencySampleCount`, `errorRate`, `queueLagMs`, `workerThroughputPerSecond`, `dbPoolActive`,
`dbPoolMax`, `dbPoolWaiting`, `dbQueryP95Ms`, `redisConnections`, `redisMemoryBytes`,
`redisOperationP95Ms`, `cpuUtilization`, `memoryBytes`, `connectionCount`, `cacheBytes`,
`openFileDescriptors`, `logBytes`, `metricSamples`, `cancellationLatencyP95Ms`,
`pendingSyntheticJobs`, `durableResultLoss`, `duplicateResults`, `duplicateFills`,
`duplicateChildRuns` and `databaseCorruption`. `redisSaturated` and recovery/scenario observations are booleans. These normalized
fields may be computed from Prometheus and the admin-safe diagnostic summary; raw provider payloads are
not accepted as evidence.

## Load commands

```sh
pnpm resilience:validate
pnpm perf:production --scenario read-load
pnpm perf:production --scenario mixed
pnpm perf:production --scenario soak
pnpm perf:production
```

`perf:production` runs all three scenarios. The checked-in minimums are 60 seconds/12 clients for read,
300 seconds/12 clients for mixed, and four hours/12 clients for soak. Environment overrides are accepted
only when they increase duration or concurrency. Each mutation gets a unique idempotency key. Cross-user
probes use a separate synthetic account and accept only 401/403/404. A 2xx is an IDOR failure.

The route p95 values are loaded from `performance/thresholds/production-resilience.json`; contract
validation proves that each value is identical to its Scanner, Alerts/Watchlists, Portfolio/Risk, Market
Intelligence or Strategy Lab baseline source. Error rate must remain strictly below 1%.

## Chaos commands

```sh
export ATLAS_STAGING_CHAOS_APPROVAL=TASK-078-STAGING-ONLY
pnpm chaos:staging --scenario redis-restart
pnpm chaos:staging --scenario worker-kill
pnpm chaos:staging --scenario postgres-interruption
pnpm chaos:staging --scenario object-storage
pnpm chaos:staging --scenario rollback
pnpm chaos:staging --scenario stale-market-data
pnpm chaos:staging
```

The provider adapter owns only the mechanics of inducing and recovering a fault. PostgreSQL remains the
source of truth. The runner observes application invariants through diagnostics and always attempts the
recovery command in `finally`. The rollback adapter may deploy only a deliberately unhealthy staging
canary using an expand-compatible migration; it must never apply a destructive schema change.

Before each run, confirm on-call coverage, current backups, an empty maintenance window, immutable image
digest, synthetic fixture ownership, dashboard ingestion and alert routing. After each run, confirm queue
drain, terminal jobs, durable fingerprints, duplicate counters, readiness, synthetic journeys and incident
closure. Stop immediately for security leakage, corruption, uncontrolled saturation or recovery timeout.

## Evidence and exit behavior

Load writes `reports/performance/production-load.json` and `.md`. Chaos writes
`reports/resilience/staging-chaos.json` and `.md`. Every record includes environment, commit/image,
workload, duration, concurrency, p50/p95/p99, error rate, queue lag, DB/Redis, CPU/memory, recovery and
invariants. Missing fixture, diagnostics, mandatory scenario, threshold breach or invariant failure returns
a non-zero exit code. A contract-only validation is not load/chaos evidence.

Do not proceed to TASK-079 unless all three load scenarios and all six chaos scenarios have PASS evidence;
the four-hour soak cannot be replaced by a unit test, local no-op, shortened duration or single-worker run.
