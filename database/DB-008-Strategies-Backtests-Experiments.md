# DB-008 — Strategies, Backtests and Experiments

**Sürüm:** 1.0  
**Durum:** Uygulamaya hazır

## Strategies

### `strategies`

- id
- owner_user_id
- name
- description
- visibility
- status
- current_revision
- timestamps
- deleted_at

### `strategy_revisions`

- id
- strategy_id
- revision
- schema_version
- definition jsonb
- parameter_schema jsonb
- validation_status
- complexity_score
- created_by
- created_at

Unique: `strategy_id + revision`.

## Backtests

### `backtest_runs`

- id
- strategy_id/revision
- requested_by
- status
- request_hash
- idempotency_key_hash
- engine/policy versions
- data_snapshot_id
- parameters
- universe_snapshot
- range
- initial_capital numeric
- progress
- timestamps
- error fields

Unique: `requested_by + idempotency_key_hash`.

### `backtest_data_snapshots`

- market/universe/fundamental/corporate action revisions
- data_cutoff_at
- hash unique

### `backtest_summaries`

- ending equity
- returns
- drawdown
- volatility
- Sharpe/Sortino/Calmar
- trade metrics
- turnover/exposure
- fees/slippage
- benchmark
- methodology

## Events

### `backtest_orders`

### `backtest_fills`

### `backtest_trades`

Fill deduplication key unique olmalıdır.

## Series

### `backtest_series_chunks`

Unique: `run + series_type + chunk_index`.

## Experiments

### `research_experiments`

### `research_experiment_runs`

Binding hash experiment içinde unique olmalıdır.

## Finansal alanlar

Para, fiyat ve miktar için numeric/decimal kullanılır; binary float kalıcı veri için kullanılmaz.
