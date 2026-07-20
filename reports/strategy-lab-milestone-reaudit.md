# GO — Strategy Lab Milestone Re-audit

- **Görev:** TASK-070E remediation re-audit
- **Tarih:** 2026-07-20
- **Commit:** `89ff250a1a12579a32956a217f7ac7e18ecc2c9b`
- **İlk audit:** `reports/strategy-lab-milestone-audit.md`
- **İlk re-audit:** NO-GO; PERF-BT-001, PERF-BT-003, PERF-BT-006 ve kararsız PERF-AWN-002
- **Kanonik benchmark:** `reports/performance/backtest-benchmark.json` ve `.md`

## Karar

İlk re-audit bulgularının tamamı giderildi. Threshold, fixture ve assertion kapsamı
değiştirilmedi. Zorunlu backtest runner, iki bağımsız Alerts/Watchlists performans koşumu,
iki ardışık tam Playwright suite ve bütün repository kapıları PASS oldu.

| GO ölçütü                                  | Sonuç |
| ------------------------------------------ | ----: |
| Failed                                     |     0 |
| Critical deviations                        |     0 |
| Metrics missing                            |     0 |
| Hard-coded turnover production occurrences |     0 |
| PERF-BT-001–006                            |  PASS |
| Production experiment path                 |  PASS |
| Duplicate child/fill/trade/result          |     0 |
| Full Playwright iki ardışık normal koşum   |  PASS |
| Not-run/flaky/retry-only/skip              |     0 |
| Bias failures                              |     0 |
| Previous milestone regressions             |     0 |
| Format/ADR/secret/dependency/build         |  PASS |

## 1. Backtest metrics completeness

`backtest-metrics-v2` annualized return, annualized volatility, Sharpe, Sortino, Calmar,
expectancy, benchmark return, excess return ve gerçek turnover üretir. Her metrik `value`,
`status`, `reasonCode`, `observationCount`, `methodologyVersion` ve `warnings` taşır.

- Return: simple close-to-close; annualization 252; annualized return day count 365.
- Risk-free rate: yıllık 0; sample standard deviation; periodic downside target 0.
- Turnover: synthetic corporate-action fill hariç gross fill notional / average equity;
  annualize edilmez.
- Benchmark: aynı range, cutoff ve adjustment mode; exact-date intersection, forward-fill yok.
- Known-value metrics + execution fixture: 46/46 PASS.
- Summary API: 11/11 PASS; OpenAPI: 1/1 PASS.
- Zero volatility/drawdown/closed-trade ve eksik benchmark açık `notEvaluable` döndürür.
- Public/persistent NaN veya Infinity: 0.

## 2. Hard-coded turnover taraması

Production kaynakları test/spec dosyaları dışlanarak tarandı:

```text
rg -n "turnover\\s*[:=]\\s*(['\"]?0(?:\\.0+)?['\"]?)" apps packages \
  --glob '!**/*.test.*' --glob '!**/*.spec.*'
```

Production occurrence: **0 — PASS**. Turnover gerçek fill notional üzerinden hesaplanır.

## 3. PERF-BT-001–006

Komut: `pnpm perf:backtest` — exit 0. Ortam: macOS `darwin 25.5.0`, Apple M1,
8 GiB, Node `22.14.0`, pnpm `9.15.4`, PostgreSQL `17.10`, Redis `7.4.9`.
Runner her senaryo grubunu ayrı Node sürecinde ve temiz schema/seed ile ölçer; gerçek
PostgreSQL/Redis/HTTP/BullMQ yolları korunur.

| ID                  | Fixture / production path                                                                                            |   Tekrar |    p50 ms |    p95 ms |    max ms | Subsystem p50                                        | Invariant                      | Threshold       | Sonuç |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- | -------: | --------: | --------: | --------: | ---------------------------------------------------- | ------------------------------ | --------------- | ----- |
| PERF-BT-001         | 650 symbol × 1.304 daily bar × 4 indicator; planner → PIT snapshot → production BullMQ worker → engine → persistence |        3 | 23.765,76 | 27.495,19 | 27.495,19 | engine 22.026,03; DB 1.739,73; persistence 320,68 ms | terminal 3/3, error 0          | p95 ≤ 30.000 ms | PASS  |
| PERF-BT-002         | 5.000.000 ordered event; deterministic core + gerçek cost model                                                      |        5 |  6.681,83 |  7.298,04 |  7.298,04 | engine 6.681,83 ms                                   | hash count 1, invalid order 0  | p95 ≤ 12.000 ms | PASS  |
| PERF-BT-003         | 100.000 combined order/fill/trade/series; atomik PostgreSQL persistence                                              |        5 |  5.187,88 |  5.468,95 |  5.468,95 | DB/persistence 5.187,88 ms                           | idempotent replay true         | p95 ≤ 8.000 ms  | PASS  |
| PERF-BT-004 summary | gerçek HTTP/auth/controller/application/repository/serialization                                                     |       10 |      4,98 |     10,07 |     10,07 | API 4,98 ms                                          | real HTTP                      | p95 ≤ 500 ms    | PASS  |
| PERF-BT-004 series  | aynı gerçek HTTP yolu; 2.000 point                                                                                   |       10 |     19,30 |     23,85 |     23,85 | API 19,30 ms                                         | 2.000 point                    | p95 ≤ 700 ms    | PASS  |
| PERF-BT-004 trades  | aynı gerçek HTTP yolu; 10.000 trade cursor dataset                                                                   | 100 page |      6,57 |      8,74 |     17,96 | API 6,57 ms                                          | duplicate 0, missing 0         | p95 ≤ 500 ms    | PASS  |
| PERF-BT-005         | 100 combination; production experiment queue/worker/reuse/aggregation                                                |        5 |     85,55 |    104,06 |    104,06 | orchestration 85,55 ms                               | registered, duplicate child 0  | p95 ≤ 3.000 ms  | PASS  |
| PERF-BT-006         | aynı snapshot üzerinde iki bağımsız gerçek run                                                                       |        2 |      7,76 |     15,34 |     15,34 | DB read 7,76 ms                                      | summary/fill/equity hash equal | hash equality   | PASS  |

Fixture `performance/fixtures/backtest-v1.json` ve threshold
`performance/thresholds/backtest.json` değiştirilmedi. Eksik/skipped scenario ve error yoktur;
threshold/invariant failure hâlâ non-zero exit üretir.

Remediation teknik kanıtı:

- Completed run için dev JSONB checkpoint yazımı kaldırıldı; ara checkpoint davranışı korundu.
- Timeline hash allocation-bounded ve deterministik hâle getirildi; stable event ordering korundu.
- PostgreSQL snapshot resolver immutable snapshot cache ve revision-aware composite indeks kullanır.
- Result persistence tek atomik transaction içinde bulk JSON recordset ve bulk series insert kullanır.
- Tamamlanmış atomik summary, idempotent replay için authoritative no-op kanıtıdır.
- BullMQ ve PostgreSQL terminal durumları birlikte beklenir; ikinci-run lifecycle yarışı kapandı.

## 4. Experiment production worker wiring

Akış API → application → PostgreSQL → reliable dispatch → BullMQ experiment queue → production
WorkerRuntime → combination generator → child create/reuse → aggregator → terminal PostgreSQL
state olarak doğrulandı. Job payload yalnız `experimentId` taşır.

- Production dispatch database testi: 1/1 PASS.
- Worker PostgreSQL/Redis integration: queue-to-terminal, 2+/100 combination, duplicate delivery,
  duplicate binding, compatible reuse, incompatible no-reuse, retry, child failure, partial result,
  cancellation, terminal race, worker/Redis restart, metrics/correlation: PASS.
- Production worker integration toplamı ilgili suite içinde 15/15 PASS.
- PERF-BT-005 p95 104,06 ms; duplicate child run 0.

## 5. Playwright full-suite stability

Config `fullyParallel: true`, retry 0, service worker blocked ve failure trace/screenshot açık.

| Kanıt                        | Komut                                          |      Sonuç |    Süre |
| ---------------------------- | ---------------------------------------------- | ---------: | ------: |
| Full suite normal koşum 1    | `pnpm --filter @atlas/web test:e2e`            | 15/15 PASS | 43,0 sn |
| Full suite normal koşum 2    | aynı komut                                     | 15/15 PASS | 54,2 sn |
| Strategy Lab normal          | `strategy-lab.spec.ts --workers=4 --retries=0` |   4/4 PASS | 34,7 sn |
| Strategy Lab single worker   | `strategy-lab.spec.ts --workers=1 --retries=0` |   4/4 PASS | 33,4 sn |
| Düzeltilen cursor/poll testi | grep payload round-trip, repeat 10, workers 4  | 10/10 PASS | 54,2 sn |

Failed 0, not-run 0, flaky 0, retry-only 0 ve skip/fixme/only 0. Single-worker sonucu tek
başına başarı sayılmadı. Assertion ve suite kapsamı azaltılmadı.

## 6. Bias ve data-integrity regresyonları

Deterministic core 18/18 ve execution-cost/data-integrity 25/25 PASS.

| Gate                                              | Failure |
| ------------------------------------------------- | ------: |
| Look-ahead / same-bar leakage                     |       0 |
| Survivorship / future listing / future membership |       0 |
| Fundamental publication / restatement leakage     |       0 |
| Corporate-action / dividend double count          |       0 |
| Missing/corrected bar ve snapshot hash            |       0 |
| Duplicate fill/trade/result                       |       0 |
| NaN/Infinity                                      |       0 |

Commission, minimum commission, directional slippage, fee/tax, post-cost cash, stop-loss,
take-profit, trailing stop, maximum holding, participation, missing volume, split, dividend ve
delisting fixture'ları PASS.

## 7. API, IDOR, cursor ve export güvenliği

Strategy/run/experiment IDOR, result ownership, create idempotency/conflict, bounded series,
orders/fills/methodology, export IDOR, CSV formula escaping, complexity/rate limit, production
stack-trace suppression ve OpenAPI PASS. Trade cursor user/run/filter/sort context invariant'ı
PASS; duplicate 0, missing 0.

## 8. Önceki milestone regresyonları

| Baseline            | Test/E2E/security                                    | Performans p95 ms                                                    | Sonuç |
| ------------------- | ---------------------------------------------------- | -------------------------------------------------------------------- | ----- |
| Scanner Runtime     | baseline 181; AST round-trip ve IDOR full E2E içinde | 267,10 / 2.528,10 / 5.021,19 / 8,32 / 1,67 / 2,04                    | PASS  |
| Alerts/Watchlists   | baseline 223; E2E/IDOR PASS                          | iki bağımsız PERF-AWN koşumu PASS; PERF-AWN-002 1.705,23 ve 1.459,14 | PASS  |
| Portfolio/Risk      | baseline 347; E2E/IDOR PASS                          | 232,42 / 114,72 / 49,15 / 6,77 / 324,76 / 10,34                      | PASS  |
| Market Intelligence | baseline 446; E2E/IDOR PASS                          | 4,15 / 4,58 / 27,59 / 67,04 / 10,47 / 5.223,20                       | PASS  |

Gerekçesiz test sayısı düşüşü yoktur. Scanner, Portfolio ve Market mandatory performans
runner'ları exit 0; Alerts runner iki bağımsız koşumda exit 0 üretmiştir.

## 9. Repository kalite kapıları

| Kapı                                | Sonuç                                              |
| ----------------------------------- | -------------------------------------------------- |
| Node / pnpm version                 | 22.14.0 / 9.15.4 — PASS                            |
| `pnpm format:check`                 | PASS                                               |
| `pnpm validate:adr`                 | PASS                                               |
| lint cache dışı                     | 8/8 PASS                                           |
| typecheck cache dışı                | 8/8 PASS                                           |
| production build cache dışı         | 8/8 PASS                                           |
| unit/runtime                        | 554/554 PASS                                       |
| database integration                | 42/42 PASS                                         |
| API database integration            | 5/5 PASS                                           |
| worker PostgreSQL/Redis integration | 67/67 PASS                                         |
| OpenAPI                             | 1/1 PASS                                           |
| migration check + forward/rollback  | PASS; `0009_messy_terror` indeks migration'ı dahil |
| secret scan                         | PASS; leak 0                                       |
| dependency audit                    | PASS; high/critical 0                              |
| skip/only/fixme scan                | PASS; occurrence 0                                 |
| `git diff --check`                  | PASS                                               |
| Playwright                          | iki ardışık 15/15 PASS                             |

## Sonuç

**GO.** Failed 0, critical deviation 0, metric missing 0, hard-coded turnover 0,
mandatory performance PASS, production experiment path PASS, reproducibility failure 0,
bias failure 0, IDOR/export security failure 0, önceki milestone regresyonu 0 ve bütün zorunlu
repository/E2E kapıları PASS.
