# Portfolio, Transactions and Risk Analytics GO Baseline

- **Durum:** GO
- **Görev:** TASK-051
- **Baseline tarihi:** 2026-07-18
- **Baseline commit SHA:** `a5e623146268103b29f52770769c5d8cd0843c4f`
- **Kaynak re-audit SHA:** `2055727399ad13326e34fcf9c44172ab1592a910`
- **Kaynak rapor:** `reports/portfolio-risk-milestone-reaudit.md`

Baseline commit, TASK-050A/TASK-050B remediation kodunu ve TASK-050C GO re-audit raporunu içeren
repository HEAD'idir. Çalışma ağacındaki v0.7 README, indeks ve changelog entegrasyonu henüz commit
edilmemiştir ve bu baseline'ın test veya ürün davranışını değiştirmez. Performance ölçümlerinin
kanonik commit alanı kaynak re-audit SHA'sıdır.

## Karar özeti

| Ölçüt                         | Sonuç |
| ----------------------------- | ----: |
| Failed gate                   |     0 |
| Critical deviation            |     0 |
| Financial fixture failure     |     0 |
| Risk fixture failure          |     0 |
| IDOR failure                  |     0 |
| CSV security failure          |     0 |
| NaN/Infinity failure          |     0 |
| Mandatory performance failure |     0 |
| Scanner Runtime regression    |     0 |
| Alerts/Watchlists regression  |     0 |
| E2E failure                   |     0 |

TASK-050C GO koşulları eksiksiz sağlanmıştır.

## Financial fixture test tabanı

| Fixture paketi                                      |          Sonuç |
| --------------------------------------------------- | -------------: |
| Portfolio ledger ve application fixtures            |     25/25 PASS |
| Corporate action, valuation ve performance fixtures |     25/25 PASS |
| PostgreSQL ledger integration                       |       3/3 PASS |
| **Domain financial fixture toplamı**                | **50/50 PASS** |

Kapsam; moving weighted average cost, buy/sell fee ve tax, partial/full sell, insufficient
quantity, realized/unrealized P&L, cash/dividend, immutable posted transaction, reversal,
idempotency, past-dated deterministic rebuild, decimal precision, split, bonus share, rights issue,
corporate-action deduplication, tek valuation cutoff, missing/stale fiyat, TWR, XIRR ve benchmark
hizalamasını içerir.

**Financial fixture failures: 0.**

## Risk fixture test tabanı

| Fixture paketi                          |      Sonuç |
| --------------------------------------- | ---------: |
| Saf risk ve risk performance fixtures   | 25/25 PASS |
| PostgreSQL risk persistence integration |   2/2 PASS |

Volatility, beta, zero benchmark variance, correlation, peak/trough/recovery ve maximum drawdown,
Historical VaR 95/99, Expected Shortfall, symbol/sector/cash concentration, HHI, observation count,
insufficient/missing/stale input, deterministic cache invalidation ve methodology version
kontrolleri PASS'tir.

**Risk fixture failures: 0. NaN/Infinity failures: 0.**

## CSV güvenlik ve atomicity sonuçları

| Katman                                        |      Sonuç |
| --------------------------------------------- | ---------: |
| CSV preview/export domain fixtures            | 12/12 PASS |
| Import/export API fixtures                    |   9/9 PASS |
| PostgreSQL atomic commit/rollback integration |   4/4 PASS |

Geçerli preview ve atomic commit, explicit partial mode, invalid row rollback, duplicate row/file,
external-reference deduplication, unknown symbol, invalid date/decimal, UTF-8, semicolon delimiter,
file/row limitleri, formula injection import/export, ownership/IDOR ve commit replay kontrolleri
PASS'tir. Preview doğrudan ledger tablolarına yazmaz; kritik hata atomic modda hiçbir transaction
oluşturmaz.

**CSV security failures: 0.**

## API, ownership ve IDOR sonuçları

| Kapı                                                     | Sonuç      |
| -------------------------------------------------------- | ---------- |
| Repository API test toplamı                              | 67/67 PASS |
| Portfolio API ve positions cursor integration            | 21/21 PASS |
| OpenAPI                                                  | 1/1 PASS   |
| Portfolio ownership/IDOR                                 | PASS       |
| Transaction IDOR                                         | PASS       |
| Import job IDOR                                          | PASS       |
| Export IDOR                                              | PASS       |
| Positions cursor user/portfolio context                  | PASS       |
| Posted transaction PATCH yokluğu ve ayrı reverse command | PASS       |
| Idempotency ve recalculate rate limit                    | PASS       |
| Decimal string contract ve stable error code             | PASS       |
| Production response stack-trace suppression              | PASS       |

**IDOR failures: 0.**

## Playwright E2E tabanı

`pnpm --filter @atlas/web test:e2e --workers=1`: **8/8 PASS**.

| Akış                                                               |    Sonuç |
| ------------------------------------------------------------------ | -------: |
| Portfolio create, transactions, weighted average, sell ve reversal | 3/3 PASS |
| Alerts/Watchlists/Notifications                                    | 2/2 PASS |
| Scanner preset/custom ve AST round-trip                            | 3/3 PASS |

Portfolio akışlarında performance/risk, CSV preview/commit, invalid/formula-injection CSV,
partial valuation warning, accessibility ve foreign portfolio URL denial doğrulanmıştır. E2E
failure veya validation/ownership bypass yoktur.

## PERF-PORT-001–PERF-PORT-006 baseline

Ortam: Apple M1, 8 GiB RAM, Node.js 22.14.0, pnpm 9.15.4, test PostgreSQL 17.10 ve Redis
7.4.9. Fixture'lar deterministiktir; dış provider veya internet kullanılmamıştır.

| ID            | Fixture                                    | Tekrar | Warm/cold          |       p50 |         p95 |         Max | Hata | Threshold      | Sonuç |
| ------------- | ------------------------------------------ | -----: | ------------------ | --------: | ----------: | ----------: | ---: | -------------- | ----- |
| PERF-PORT-001 | 10.000 posted tx / 100 instrument          |      5 | 1 cold hariç; warm | 504,84 ms |   721,66 ms |   721,66 ms |    0 | p95 ≤ 5.000 ms | PASS  |
| PERF-PORT-002 | 1.000 position / 1.000 closed price        |      5 | 1 cold hariç; warm | 401,97 ms |   470,82 ms |   470,82 ms |    0 | p95 ≤ 3.000 ms | PASS  |
| PERF-PORT-003 | 1.826 daily value / 3 cash flow            |     20 | 1 cold hariç; warm | 134,06 ms |   160,54 ms |   174,36 ms |    0 | p95 ≤ 1.500 ms | PASS  |
| PERF-PORT-004 | 1.826 portfolio+benchmark / 1.000 exposure |     20 | 1 cold hariç; warm |  19,52 ms |    32,35 ms |    32,74 ms |    0 | p95 ≤ 3.000 ms | PASS  |
| PERF-PORT-005 | 10.000 CSV row / 669.203 byte              |      5 | 1 cold hariç; warm | 762,94 ms | 1.169,22 ms | 1.169,22 ms |    0 | p95 ≤ 8.000 ms | PASS  |
| PERF-PORT-006 | 1.000 position / page 50                   |    100 | 1 cold hariç; warm |  21,21 ms |    44,42 ms |   109,32 ms |    0 | p95 ≤ 500 ms   | PASS  |

Mandatory portfolio performance threshold'ları **6/6 PASS**. Threshold veya fixture boyutu
değiştirilmemiştir.

## Positions gerçek HTTP/application/API cursor yolu

PERF-PORT-006 aşağıdaki gerçek uygulama yolunu ölçmüştür:

```text
HTTP
→ authentication ve portfolio ownership
→ request validation
→ application service
→ versioned opaque cursor
→ PostgreSQL keyset query
→ DTO ve response meta mapping
→ JSON serialization ve HTTP response
```

Offset pagination kullanılmaz. Cursor; user, portfolio, sort alanı/yönü, normalize filter ve
`projectionLedgerVersion` bağlamlarına bağlıdır. Sort değeriyle birlikte `instrument_id` stable
unique tie-breaker olarak kullanılır. Adapter-only traversal 152,53 ms yalnız diagnostik olarak
kaydedilmiş, gate başarısı sayılmamıştır.

### Cursor invariant snapshot

| Invariant                               | Sonuç                                 |
| --------------------------------------- | ------------------------------------- |
| 1.000-row traversal unique rows         | 1.000                                 |
| Duplicate rows                          | 0 — PASS                              |
| Missing rows                            | 0 — PASS                              |
| Cursor invariant failures               | 0 — PASS                              |
| İlk/orta/son sayfa                      | PASS                                  |
| Equal-value ASC/DESC stable tie-breaker | PASS                                  |
| Başka portfolio cursor'ı                | Context mismatch — PASS               |
| Başka user cursor'ı                     | Ownership denial — PASS               |
| Sort/filter mismatch                    | Context mismatch — PASS               |
| Cursor schema/version mismatch          | Standard 400 error — PASS             |
| Projection ledger version değişimi      | `PORTFOLIO_PROJECTION_CHANGED` — PASS |

## Watchlist market summary regresyon sonucu

PERF-AWN-005 aynı 500 instrument, iki closed bar, 1.000 active alert, ownership, market-data
enrichment, stale/data-cutoff alanları, 3 hariç warm-up ve 10 ölçülen traversal ile yeniden
doğrulanmıştır.

| Ölçüm                       | Yol                |       p50 |       p95 |       Max | Threshold    | Sonuç |
| --------------------------- | ------------------ | --------: | --------: | --------: | ------------ | ----- |
| TASK-040 GO baseline        | Historical adapter | 399,13 ms | 636,27 ms | 636,27 ms | p95 ≤ 750 ms | PASS  |
| TASK-050B independent run 1 | Gerçek API         |  49,62 ms | 127,02 ms | 127,02 ms | p95 ≤ 750 ms | PASS  |
| TASK-050B independent run 2 | Gerçek API         |  41,28 ms |  87,52 ms |  87,52 ms | p95 ≤ 750 ms | PASS  |
| TASK-050C re-audit          | Gerçek API         |  35,63 ms |  46,60 ms |  46,60 ms | p95 ≤ 750 ms | PASS  |

Son koşum 10 bounded SQL statement kullanmış, item-level sorgu üretmemiş ve 500 unique row/0
duplicate döndürmüştür. Cache kapalıdır; ownership, active alert count ve freshness contract'ı
korunmuştur. **Alerts/Watchlists performance regression: 0.**

## Scanner Runtime regresyon sonucu

Scanner Runtime GO baseline'ındaki 181 runtime, 24 PostgreSQL/Redis integration, üç Playwright ve
AST request round-trip tabanı korunmuştur. Güncel repository tabanı 347 unit/runtime, 55
PostgreSQL/Redis integration assertion ve sekiz Playwright testidir; gerekçesiz test sayısı düşüşü
yoktur.

PERF-SCN-001–PERF-SCN-006 sonuçları **6/6 PASS**, hata sayısı 0'dır. Duplicate result, progress
monotonicity, terminal-state stability, unauthorized progress access, result pagination ve
idempotent replay invariant'ları PASS'tir.

**Scanner Runtime regressions: 0.**

## Alerts/Watchlists regresyon sonucu

Alerts/Watchlists GO baseline'ındaki 223 unit/runtime, 41 PostgreSQL/Redis integration ve beş
Playwright testi korunmuştur. Duplicate evaluation/trigger/delivery, ownership/IDOR, note XSS,
quiet hours, unread/read, worker retry ve catch-up kontrolleri PASS'tir.

PERF-AWN-001–PERF-AWN-005 sonuçları **5/5 PASS**, hata sayısı 0'dır.

**Alerts/Watchlists regressions: 0.**

## Repository ve security gate snapshot

| Kapı                         | Baseline sonucu                    |
| ---------------------------- | ---------------------------------- |
| Format                       | `pnpm format:check` PASS           |
| ADR validation               | PASS — 11 ADR; validator 3/3       |
| Secret scan                  | Synthetic PASS; 142 commit; 0 leak |
| Production dependency audit  | PASS — no known vulnerability      |
| Production build             | PASS — 8/8 package, cached 0       |
| Lint                         | PASS — 8/8 package, cached 0       |
| Typecheck                    | PASS — 8/8 package, cached 0       |
| OpenAPI                      | PASS — 1/1                         |
| Clean migration/schema       | PASS                               |
| Unit/runtime                 | PASS — 347/347                     |
| PostgreSQL/Redis integration | PASS — 55/55 assertions            |

## Baseline kararı

Portfolio, Transactions and Risk Analytics milestone; 50 financial fixture, 25 risk fixture, CSV
security/atomicity, API/IDOR, sekiz Playwright E2E, altı mandatory PERF-PORT threshold'u, gerçek
positions HTTP/application/API cursor yolu, watchlist market summary remediation ve önceki Scanner
ile Alerts/Watchlists milestone regresyon kapılarıyla **GO** baseline olarak sabitlenmiştir.

Failed gate veya critical deviation yoktur. TASK-052 bağımlılık kapısı sağlanmıştır. Bu görev test,
threshold veya uygulama kodu davranışını değiştirmez.
