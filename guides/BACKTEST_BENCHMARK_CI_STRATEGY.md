# Backtest Benchmark CI Strategy

## Command and contracts

The root command is `pnpm perf:backtest`. A single scenario can be selected with
`pnpm perf:backtest --scenario <name>`, where `<name>` is `full-bist`,
`event-engine`, `persistence`, `result-api`, `experiments`, or
`reproducibility`.

Fixture scope is versioned in `performance/fixtures/backtest-v1.json` and
thresholds are versioned in `performance/thresholds/backtest.json`. CI must not
override either contract. A missing or skipped scenario, an invariant failure,
an insufficient repetition count, or a threshold failure is a failed job.

Every run uses an isolated PostgreSQL database and Redis instance. The full
command builds and invokes the production API module, production BullMQ
backtest processor, planner, deterministic engine, result persistence, and
result API. The runner does not contact an external market-data provider.

## Pull requests

Pull requests that change backtest domain, API, worker, persistence, database,
or performance code run these targeted gates:

1. `event-engine`
2. `persistence`
3. `result-api`
4. `reproducibility`

`full-bist` and `experiments` are also required before merge when the change
touches planning, snapshot resolution, queue/worker composition, experiment
orchestration, or their fixture/threshold contracts. A branch-protection rule
must treat every selected scenario as required; a reported FAIL cannot be
converted to a warning.

## Main branch

Every main-branch update runs the complete root command without a scenario
filter. The JSON and Markdown reports are retained as CI artifacts. Main is red
if any PERF-BT-001 through PERF-BT-006 result is absent or failed.

## Nightly

Nightly runs execute the complete suite on a stable runner class with no other
benchmark workload. Reports and raw job logs are retained long enough to
compare at least 30 runs. Nightly may add diagnostic repetitions, but cannot
reduce fixture scope, required repetitions, or thresholds.

## Manual

Manual dispatch accepts an optional scenario name for diagnosis. The default
is the complete suite. The dispatch records the commit SHA and runner identity,
and publishes both report files. A targeted manual PASS is evidence only for
that scenario; it cannot replace the complete main or milestone gate.

## Measurement policy

- PR, main, nightly, and manual jobs use the same fixture and threshold files.
- Database/Redis startup, package build, fixture construction, and unit-test
  duration are not reported as scenario latency.
- Cold/warm policy, repetitions, concurrency, batch size, peak RSS, component
  timings, invariants, and errors remain in the report.
- Performance runners must use the real production path named by each scenario;
  mock/no-op worker, persistence, HTTP, or experiment consumers are forbidden.
- Report artifacts are produced even when a measured gate fails, and the
  command exits non-zero after writing them.
