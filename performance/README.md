# Scanner Runtime Performance Baseline

The benchmark uses a deterministic, source-controlled fixture with 600 BIST instruments. Bars
are generated from the fixed `scanner-runtime-v1.json` seed and persisted to test PostgreSQL.
The production scanner worker consumes them through `PostgresScannerMarketDataLoader`; BullMQ
progress uses test Redis. No external provider or internet data is used.

## Commands

```bash
pnpm perf:scanner
pnpm perf:scanner -- --scenario small-sync
```

The root command starts isolated PostgreSQL 17 and Redis 7 containers, creates a database whose
name ends in `_test`, runs the benchmark, and removes the containers and volumes afterward.
`TEST_DATABASE_URL` and `REDIS_URL` may instead be supplied directly to the worker command in CI.

An optional `SCANNER_PERF_MAX_P95_MS` can only tighten, never raise, configured duration limits.
It exists to verify non-zero threshold failure behavior.

## CI strategy

- Pull requests: `small-sync`, `pagination`, and `idempotent-replay`.
- Main/nightly/manual: all six mandatory scenarios.
- Milestone audit: all six scenarios and committed JSON/Markdown reports.

Threshold changes require the previous and new measurements, fixture/hardware differences,
technical justification, and review. A benchmark failure must not be bypassed or converted to
`continue-on-error`.
