# TASK-078 — Load, Chaos and Resilience Validation

**Bağımlılık:** TASK-073–TASK-077

## Kapsam

- root load/chaos commands
- deterministic staging fixtures
- read load
- mixed workload
- soak
- Redis restart
- worker termination
- PostgreSQL transient interruption
- object storage failure
- bad release rollback
- stale market data
- recovery metrics
- reports

## Kabul

- existing feature p95 thresholds preserved
- error rate target pass
- no cross-user leakage
- duplicate durable result = 0
- queue lag recovers
- no memory/connection leak
- rollback/recovery within target
- report non-zero on invariant failure
