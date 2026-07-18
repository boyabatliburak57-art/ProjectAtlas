# Market Intelligence Performance Baseline

Status: **PASS**

| Scenario     | Fixture                                                     | Cache / repetitions                                                   | p50 (ms) | p95 (ms) | max (ms) | Errors | Threshold                                 | Result |
| ------------ | ----------------------------------------------------------- | --------------------------------------------------------------------- | -------: | -------: | -------: | -----: | ----------------------------------------- | ------ |
| PERF-MKT-001 | 650 active BIST instruments                                 | 7 response-cache cold repetitions; 25 response-cache warm repetitions |     1.81 |     3.48 |     4.82 |      0 | warm p95 <= 500 ms; cold p95 <= 1200 ms   | PASS   |
| PERF-MKT-002 | 650 ranking rows; page size 50                              | cold first page and warm subsequent traversal pages per repetition    |     3.71 |     7.54 |    24.39 |      0 | p95 <= 400 ms; duplicate = 0; missing = 0 | PASS   |
| PERF-MKT-003 | 1 symbol / latest quote / latest pattern signal             | database read path; 12 repetitions                                    |     4.38 |    23.25 |    23.25 |      0 | p95 <= 700 ms                             | PASS   |
| PERF-MKT-004 | 730 daily bars / volume + 6 indicators / 1 corporate action | 7 cold and 20 warm response-cache repetitions                         |    49.79 |    67.37 |    67.37 |      0 | cold p95 <= 900 ms; alignment failure = 0 | PASS   |

PERF-MKT-001 cold response-cache: p50 2.57 ms, p95 23.89 ms, max 23.89 ms.

PERF-MKT-002 cursor invariants: duplicate 0, missing 0.

PERF-MKT-003 queries: 7 logical read-model queries per aggregate repetition; cache hits 0, misses 0.

PERF-MKT-004 queries: 3 logical read-model queries per HTTP request; cache hits 20, misses 1; alignment failures 0.

The benchmark uses the real Nest HTTP controller, application service, PostgreSQL read model, cursor codec, DTO mapping, serialization, and a deterministic local fixture. No external provider is called.
