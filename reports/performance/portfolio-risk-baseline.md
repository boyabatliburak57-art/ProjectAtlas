# Portfolio and Risk Performance Baseline

- **Status:** PASS
- **Generated:** 2026-07-20T13:53:34.332Z
- **Environment:** {"hostname":"Burak-MacBook-Air.local","platform":"darwin","release":"25.5.0","cpu":"Apple M1","memoryBytes":8589934592,"node":"v22.14.0","pnpm":"9.15.4","redis":"7.4.9","databaseUrl":"test PostgreSQL (credential redacted)","externalProvider":false}
- **Fixture:** {"ledgerTransactions":10000,"ledgerInstruments":100,"positions":1000,"seriesDays":1826,"csvRows":10000}

| ID            | Scenario                                                | Fixture                                                 | Warm/cold                                          | Repetitions | p50 ms | p95 ms | Max ms | Errors | Threshold                   | Result |
| ------------- | ------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------- | ----------: | -----: | -----: | -----: | -----: | --------------------------- | ------ |
| PERF-PORT-001 | Ledger replay and projection rebuild                    | 10000 posted transactions / 100 instruments             | 1 cold warm-up excluded; measured repetitions warm |           5 | 187.06 | 232.42 | 232.42 |      0 | p95 <= 5000 ms; errors <= 0 | PASS   |
| PERF-PORT-002 | Position valuation, price load and snapshot write       | 1000 positions / 1000 closed daily prices               | 1 cold warm-up excluded; measured repetitions warm |           5 | 109.29 | 114.72 | 114.72 |      0 | p95 <= 3000 ms; errors <= 0 | PASS   |
| PERF-PORT-003 | Five-year TWR and XIRR performance series               | 1826 daily valuations / 3 irregular cash flows          | 1 cold warm-up excluded; measured repetitions warm |          20 |   38.4 |  49.15 |  52.73 |      0 | p95 <= 1500 ms; errors <= 0 | PASS   |
| PERF-PORT-004 | Five-year portfolio risk analytics                      | 1826 portfolio + benchmark days / 1000 exposures        | 1 cold warm-up excluded; measured repetitions warm |          20 |   5.31 |   6.77 |   9.61 |      0 | p95 <= 3000 ms; errors <= 0 | PASS   |
| PERF-PORT-005 | CSV preview validation and duplicate summary            | 10000 mixed valid/invalid/duplicate rows / 669203 bytes | 1 cold warm-up excluded; measured repetitions warm |           5 | 222.14 | 324.76 | 324.76 |      0 | p95 <= 8000 ms; errors <= 0 | PASS   |
| PERF-PORT-006 | Owned 50-row position page through the real API process | 1000 positions / page 50                                | 1 cold warm-up excluded; measured repetitions warm |         100 |   5.94 |  10.34 |   19.1 |      0 | p95 <= 500 ms; errors <= 0  | PASS   |
