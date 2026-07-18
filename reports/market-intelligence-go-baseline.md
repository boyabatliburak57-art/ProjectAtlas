# Market Intelligence GO Baseline

- **Durum:** GO
- **Görev:** TASK-061
- **Baseline tarihi:** 2026-07-18
- **Baseline commit SHA:** `88de4c3feee41b814e55e45833200025ab7054ce`
- **Kaynak audit SHA:** `8b4aaefc60d03141d8180abbebfcfb37ea6566fa`
- **Kaynak rapor:** `reports/market-intelligence-milestone-audit.md`

Baseline commit TASK-053–TASK-059 implementasyonlarını, Market Intelligence performance
raporlarını ve TASK-060 GO audit raporunu içerir. Çalışma ağacındaki v0.8 README, indeks,
changelog ve DB-008 markdown biçimlendirme değişiklikleri dokümantasyonla sınırlıdır; bu baseline'ın
ürün davranışını, testlerini veya threshold'larını değiştirmez.

## Karar özeti

| Ölçüt                         | Sonuç |
| ----------------------------- | ----: |
| Failed gate                   |     0 |
| Critical deviation            |     0 |
| Cursor/chart failure          |     0 |
| Fundamental fixture failure   |     0 |
| Pattern fixture failure       |     0 |
| Pattern look-ahead failure    |     0 |
| IDOR/security failure         |     0 |
| NaN/Infinity failure          |     0 |
| Performance threshold failure |     0 |
| Önceki milestone regression   |     0 |
| E2E/accessibility failure     |     0 |

TASK-060 GO koşullarının tamamı sağlanmıştır.

## Test tabanı

| Katman                              |        Sonuç |
| ----------------------------------- | -----------: |
| Domain unit/runtime                 | 288/288 PASS |
| Database unit/schema                |   13/13 PASS |
| Worker unit/runtime                 |   31/31 PASS |
| API unit/integration/OpenAPI        | 101/101 PASS |
| Web component                       |   13/13 PASS |
| **Unit/runtime toplamı**            |  **446/446** |
| PostgreSQL integration              |   32/32 PASS |
| PostgreSQL/Redis worker integration |   36/36 PASS |
| **Gerçek altyapı integration**      |    **68/68** |
| Playwright                          |   11/11 PASS |

Test skip/only marker sayısı sıfırdır.

## Market overview

| Kapı                                      | Sonuç      |
| ----------------------------------------- | ---------- |
| Market overview API fixtures              | 17/17 PASS |
| Market database/read-model fixtures       | 9/9 PASS   |
| Index summary ve quality metadata         | PASS       |
| Breadth evaluated/excluded denominator    | PASS       |
| Partial/stale propagation                 | PASS       |
| Sector generation/cutoff consistency      | PASS       |
| Ranking first/middle/last page            | PASS       |
| Equal-value stable tie-breaker            | PASS       |
| Cursor duplicate/missing row              | 0/0 — PASS |
| New closed-bar invalidation ve rate limit | PASS       |

### Market overview performance

| ID           | Fixture                       | p50 ms | p95 ms | Max ms | Threshold                              | Sonuç |
| ------------ | ----------------------------- | -----: | -----: | -----: | -------------------------------------- | ----- |
| PERF-MKT-001 | 650 active BIST instrument    |   2,52 |  14,04 |  14,67 | warm p95 ≤ 500; cold p95 42,92 ≤ 1.200 | PASS  |
| PERF-MKT-002 | 650 ranking row, page size 50 |   4,09 |  10,19 |  15,67 | p95 ≤ 400; duplicate = 0; missing = 0  | PASS  |

PERF-MKT-001 gerçek Nest HTTP → application service → PostgreSQL read model → DTO serialization
yolunda 7 cold ve 25 warm tekrar kullanmıştır. PERF-MKT-002 yedi tam keyset cursor traversal'ında
13 sayfa üretmiş; duplicate ve missing row sayısı sıfır olmuştur.

## Symbol detail ve chart

| Kapı                                         | Sonuç            |
| -------------------------------------------- | ---------------- |
| Symbol/chart API fixtures                    | 11/11 PASS       |
| Profile, quote, signal ve quality metadata   | PASS             |
| Daily/intraday timeframe ve range            | PASS             |
| Overlay ve multi-output panel alignment      | PASS             |
| Indicator code/version/parameter/output meta | PASS             |
| Open/closed bar                              | PASS             |
| Corporate action ve pattern marker dedup     | PASS             |
| Range ve altı-overlay limitleri              | PASS             |
| Public NaN/Infinity guard                    | PASS — failure 0 |

### Raw/adjusted ve chart invariant snapshot

| Invariant                                    | Sonuç    |
| -------------------------------------------- | -------- |
| Raw ve adjusted cache identity ayrımı        | PASS     |
| Adjustment mode response metadata            | PASS     |
| Artan ve duplicate'siz bar timestamp         | PASS     |
| Overlay/panel timestamp alignment failure    | 0 — PASS |
| Corporate action marker duplicate            | 0 — PASS |
| User marker ownership/foreign-user isolation | PASS     |
| Provider raw payload suppression             | PASS     |
| CHART_DATA_CONTRACT                          | PASS     |

### Symbol/chart performance

| ID           | Fixture                                         | p50 ms | p95 ms | Max ms | Threshold                     | Sonuç |
| ------------ | ----------------------------------------------- | -----: | -----: | -----: | ----------------------------- | ----- |
| PERF-MKT-003 | Profile, quote, signal ve quality meta          |   5,69 |  44,59 |  44,59 | p95 ≤ 700                     | PASS  |
| PERF-MKT-004 | 730 bar, volume, altı overlay, corporate action |  54,08 |  94,01 |  94,01 | cold p95 ≤ 900; alignment = 0 | PASS  |

PERF-MKT-004 yedi cold ve 20 warm tekrar kullanmış; cache hit/miss 20/1 ve timestamp alignment
failure sıfır olmuştur.

## Fundamentals ve ratio fixtures

| Fixture katmanı                        |      Sonuç |
| -------------------------------------- | ---------: |
| Saf ratio/TTM fixtures                 | 12/12 PASS |
| Fundamentals ingestion worker fixtures |   3/3 PASS |
| Fundamentals API fixtures              |   3/3 PASS |

Annual/quarterly statement, immutable restatement revision, missing metric, unit normalization,
currency mismatch, TTM sufficient/insufficient dönem, zero/negative denominator, financial ve
market cutoff ayrımı, growth formülleri, duplicate provider batch ve retry taxonomy PASS'tir.
NaN/Infinity sonucu yoktur.

| ID           | Fixture                      | p50 ms | p95 ms | Max ms | Threshold | Sonuç |
| ------------ | ---------------------------- | -----: | -----: | -----: | --------- | ----- |
| PERF-MKT-005 | 20 dönem ve 14 derived ratio |   6,59 |  10,21 |  10,75 | p95 ≤ 500 | PASS  |

## Pattern fixtures

Mandatory registry 16 versioned definition taşır: doji, hammer, inverted hammer,
bullish/bearish engulfing, 20/55 high breakout, 20/55 low breakdown, golden/death cross,
volume-confirmed breakout, double top/bottom candidate ve ascending/descending triangle
candidate.

| Fixture katmanı                    |               Sonuç |
| ---------------------------------- | ------------------: |
| Pattern domain fixtures            |          24/24 PASS |
| Worker persistence/state fixtures  |            2/2 PASS |
| Pattern API fixtures               |            3/3 PASS |
| Mandatory positive fixture         |          16/16 PASS |
| Near-miss, constant ve short input |                PASS |
| Missing volume                     | PASS — notEvaluable |
| Candidate/confirmed/invalidated    |                PASS |
| Evidence ve dedup key determinism  |                PASS |
| Algorithm version preservation     |                PASS |
| Duplicate pattern                  |            0 — PASS |
| NaN/Infinity                       |            0 — PASS |

**Pattern no-look-ahead: PASS. Look-ahead failures: 0.** Future ve open bar candidate sonucuna
dahil edilmemiştir.

| ID           | Fixture                              |   p50 ms |   p95 ms |   Max ms | Threshold                                             | Sonuç |
| ------------ | ------------------------------------ | -------: | -------: | -------: | ----------------------------------------------------- | ----- |
| PERF-MKT-006 | 650 symbol × 201 bar × 16 definition | 2.247,29 | 2.445,15 | 2.445,15 | queue-terminal p95 ≤ 12.000; duplicate/look-ahead = 0 | PASS  |

PERF-MKT-006 gerçek BullMQ worker ve PostgreSQL persistence yolunda üç tekrar çalışmış, 4.550
pattern instance saklamış ve duplicate/look-ahead failure üretmemiştir.

## Cache invalidation ve cross-user isolation

| Kapı                             | Sonuç                               |
| -------------------------------- | ----------------------------------- |
| Cache/quality domain fixtures    | 17/17 PASS                          |
| PostgreSQL/Redis reconciliation  | 3/3 PASS                            |
| New/corrected closed bar         | PASS                                |
| Corporate action revision        | PASS                                |
| Financial restatement            | PASS — fundamentals + ratio refresh |
| Ratio/indicator/pattern version  | PASS                                |
| Instrument sector/index değişimi | PASS                                |
| Redis restart/loss fallback      | PASS — PostgreSQL authoritative     |
| Duplicate queue delivery         | PASS — idempotent                   |
| Context mismatch/cache poisoning | PASS — rejected                     |
| Cross-user marker isolation      | PASS                                |
| Bounded query count              | PASS                                |
| Provider payload secrecy         | PASS                                |

IDOR/security failures sıfırdır.

## Playwright ve accessibility

`pnpm --filter @atlas/web test:e2e --workers=1`: **11/11 PASS**.

- Market Intelligence yeni E2E akışları: **3/3 PASS**.
- Market overview ve ranking → symbol detail PASS.
- Timeframe, raw/adjusted ve altı-overlay request round-trip PASS.
- Annual/quarterly, restatement ve pattern evidence PASS.
- Watchlist, alert ve portfolio transaction handoff PASS.
- Foreign-user marker görünmezliği PASS.
- Partial/stale/error state PASS.
- Keyboard navigation, visible focus ve chart text alternative PASS.
- Web component/accessibility fixtures: **5/5 PASS**.

Accessibility ve ownership failure sayısı sıfırdır.

## Önceki milestone regresyonları

| Baseline          | Unit/runtime baseline → güncel | Integration baseline → güncel | E2E baseline → güncel | Performance        | Sonuç |
| ----------------- | -----------------------------: | ----------------------------: | --------------------: | ------------------ | ----- |
| Scanner Runtime   |                      181 → 446 |                       24 → 68 |                3 → 11 | PERF-SCN 6/6 PASS  | PASS  |
| Alerts/Watchlists |                      223 → 446 |                       41 → 68 |                5 → 11 | PERF-AWN 5/5 PASS  | PASS  |
| Portfolio/Risk    |                      347 → 446 |                       55 → 68 |                8 → 11 | PERF-PORT 6/6 PASS | PASS  |

Scanner AST request round-trip; Alerts/Watchlists ownership, XSS ve duplicate delivery;
Portfolio/Risk financial fixtures, CSV security, positions HTTP cursor ve IDOR kapıları
korunmuştur. Gerekçesiz test sayısı düşüşü yoktur.

## Repository quality ve security snapshot

| Kapı                         | Baseline sonucu                   |
| ---------------------------- | --------------------------------- |
| Format                       | `pnpm format:check` PASS          |
| ADR validation               | PASS — 15 ADR                     |
| Lint, cache dışı             | PASS — 8/8 package, cached 0      |
| Typecheck, cache dışı        | PASS — 8/8 package, cached 0      |
| Production build, cache dışı | PASS — 8/8 package, cached 0      |
| Synthetic secret scan        | PASS                              |
| Repository secret scan       | PASS — 158 commit, 0 leak         |
| Production dependency audit  | PASS — no known vulnerability     |
| OpenAPI                      | PASS — 1/1                        |
| Migration                    | PASS — clean PostgreSQL migration |
| Skip/only                    | PASS — 0 marker                   |
| Whitespace                   | PASS                              |

## Baseline kararı

Market Intelligence milestone; overview/read-model, raw/adjusted chart, fundamentals/ratio,
versioned pattern, no-look-ahead, cache invalidation, cross-user isolation, 11 Playwright akışı,
altı mandatory Market Intelligence performance threshold'u ve üç önceki milestone regresyon
paketiyle **GO** baseline olarak sabitlenmiştir.

Failed gate veya critical deviation yoktur. TASK-062 bağımlılık kapısı sağlanmıştır. Bu baseline
kod davranışını, testi veya performance threshold'unu değiştirmez.
