# Load, Chaos and Resilience Baseline

## LOAD-OPS-001 — Read API load

- market overview
- symbol detail
- scanner results
- portfolio positions
- backtest summary

Target:

- existing feature p95 thresholds preserved,
- error rate < 1%,
- no cross-user leakage.

## LOAD-OPS-002 — Mixed workload

- read traffic
- scanner creates
- alert evaluations
- portfolio recalculations
- backtest creates
- experiment orchestration

Target:

- queue lag bounded,
- API availability target maintained,
- DB connection saturation absent.

## LOAD-OPS-003 — Soak

- minimum multi-hour staging run
- memory leak
- connection leak
- queue growth
- log/metric volume

Target:

- no unbounded growth,
- stable latency/error.

## CHAOS-OPS-001 — Redis restart

- API fallback,
- worker reconciliation,
- no durable result loss.

## CHAOS-OPS-002 — Worker termination

- active job retry/checkpoint,
- duplicate result = 0.

## CHAOS-OPS-003 — PostgreSQL transient interruption

- bounded retry,
- no partial transaction corruption,
- readiness behavior.

## CHAOS-OPS-004 — Object storage failure

- export/backtest artifact graceful failure,
- retry and user-visible status.

## CHAOS-OPS-005 — Bad release rollback

- canary/health failure,
- rollback,
- migration compatibility.

## CHAOS-OPS-006 — Stale market data

- stale banner,
- alert/scan policy,
- no false freshness.

## Rapor

- environment
- release/commit
- workload
- duration
- concurrency
- p50/p95/p99
- error rate
- queue lag
- DB/Redis metrics
- memory/CPU
- recovery time
- invariant failures
- PASS/FAIL
