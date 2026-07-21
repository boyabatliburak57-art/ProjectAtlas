# SLO and Error Budget Report

- Policy: `slo-v1`
- Window: 2026-06-21T00:00:00.000Z — 2026-07-21T00:00:00.000Z
- API availability: 99.9500% (target ≥ 99.9%)
- Worker successful terminal rate: 99.7000% (target ≥ 99.5%)
- API error budget remaining: 50.00%
- Active fast-burn alerts: 0
- Release decision: **ALLOW_CONTROLLED_ROLLOUT**

| Journey                 | Successful terminal/freshness ratio |
| ----------------------- | ----------------------------------: |
| scanner_completion      |                             99.800% |
| alert_delivery          |                             99.900% |
| portfolio_recalculation |                             99.900% |
| backtest_completion     |                             99.700% |
| market_data_freshness   |                             99.900% |

Existing milestone latency thresholds remain authoritative and unchanged.
