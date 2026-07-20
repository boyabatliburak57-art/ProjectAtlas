# Market Intelligence Performance Baseline

Status: **PASS**

| Scenario     | Fixture                                                     | p50 (ms) | p95 (ms) | max (ms) | Errors | Threshold                                                                        | Result |
| ------------ | ----------------------------------------------------------- | -------: | -------: | -------: | -----: | -------------------------------------------------------------------------------- | ------ |
| PERF-MKT-001 | 650 active BIST instruments                                 |     1.44 |     4.15 |     4.36 |      0 | warm p95 <= 500 ms; cold p95 <= 1200 ms                                          | PASS   |
| PERF-MKT-002 | 650 ranking rows; page size 50                              |     2.96 |     4.58 |     5.02 |      0 | p95 <= 400 ms; duplicate = 0; missing = 0                                        | PASS   |
| PERF-MKT-003 | 1 symbol / latest quote / latest pattern signal             |     4.15 |    27.59 |    27.59 |      0 | p95 <= 700 ms                                                                    | PASS   |
| PERF-MKT-004 | 730 daily bars / volume + 6 indicators / 1 corporate action |    46.04 |    67.04 |    67.04 |      0 | cold p95 <= 900 ms; alignment failure = 0                                        | PASS   |
| PERF-MKT-005 | 20 periods / 14 derived ratios                              |     4.84 |    10.47 |    17.05 |      0 | p95 <= 500 ms                                                                    | PASS   |
| PERF-MKT-006 | 650 symbols × 201 daily closed bars × 16 definitions        |  4243.73 |   5223.2 |   5223.2 |      0 | queue-to-terminal p95 <= 12000 ms; duplicate pattern = 0; look-ahead failure = 0 | PASS   |

PERF-MKT-006 uses the real BullMQ worker and PostgreSQL persistence path. Duplicate pattern rows: 0; look-ahead failures: 0.
