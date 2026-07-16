# Alerts, Watchlists and Notifications GO Baseline

- **Durum:** GO
- **Görev:** TASK-041
- **Baseline tarihi:** 2026-07-16
- **Baseline commit SHA:** `0a8c47dfdd1ba71b3f5bf8aa3a4e180feaa88e1a`
- **Kaynak audit SHA:** `ab5c29e8f8cd6b193fee6da50ae0aa2a20493044`
- **Kaynak rapor:** `reports/alerts-watchlists-milestone-audit.md`

Baseline commit SHA, TASK-040 raporunu içeren temiz repository HEAD'idir. Kaynak audit SHA ise
TASK-040 kalite kapıları çalıştırılırken rapora kaydedilen commit kimliğidir.

## Karar özeti

| Ölçüt                       | Sonuç |
| --------------------------- | ----: |
| Failed                      |     0 |
| Critical deviation          |     0 |
| Non-critical tool deviation |     1 |
| Duplicate defect            |     0 |
| IDOR                        |  PASS |
| Note XSS                    |  PASS |
| Playwright E2E              |  PASS |
| Performance                 |  PASS |

TASK-040 GO koşulları eksiksiz sağlanmıştır.

## Test tabanı

### Unit ve runtime

| Paket             |       Sonuç |
| ----------------- | ----------: |
| `@atlas/domain`   |     144/144 |
| `@atlas/database` |         9/9 |
| `@atlas/worker`   |       30/30 |
| `@atlas/api`      |       37/37 |
| `@atlas/web`      |         3/3 |
| **Toplam**        | **223/223** |

### PostgreSQL ve Redis integration

| Paket                              |     Sonuç |
| ---------------------------------- | --------: |
| `@atlas/database test:integration` |     13/13 |
| `@atlas/worker test:integration`   |     28/28 |
| **Toplam**                         | **41/41** |

Test PostgreSQL ve Redis üzerinde migration, ownership, immutable revision, evaluation/trigger
deduplication, notification delivery/outbox idempotency, retry, catch-up ve quiet hours yolları
PASS olmuştur.

## Duplicate, ownership ve güvenlik davranışları

| Kapı                        | Sonuç                                                              |
| --------------------------- | ------------------------------------------------------------------ |
| Duplicate evaluation        | PASS — aynı event/cutoff ikinci evaluation üretmedi                |
| Duplicate trigger           | PASS — duplicate event ikinci trigger üretmedi                     |
| Duplicate delivery          | PASS — notification, delivery ve outbox tekrarları tekilleştirildi |
| Duplicate instrument        | PASS — service guard ve database unique constraint                 |
| Watchlist ownership/IDOR    | PASS — foreign-user erişimleri engellendi                          |
| Alert/source ownership      | PASS                                                               |
| Notification ownership/IDOR | PASS                                                               |
| Note XSS                    | PASS — çalıştırılabilir markup reddedildi                          |

Duplicate defect sayısı sıfırdır.

## Playwright E2E

`pnpm --filter @atlas/web test:e2e`: **5/5 PASS**

| Akış                                                                                                | Sonuç |
| --------------------------------------------------------------------------------------------------- | ----- |
| Scanner preset smoke                                                                                | PASS  |
| Scanner custom smoke                                                                                | PASS  |
| Scanner AST request round-trip                                                                      | PASS  |
| Watchlist oluşturma, price alert, fixture trigger, unread/read, saved-scan newMatch ve pause/resume | PASS  |
| Notification preferences, timezone ve quiet hours                                                   | PASS  |

Skip/only taraması sıfır marker bulmuştur.

## Alerts ve Watchlists performance baseline

| ID           | Senaryo                              |   p50 ms |   p95 ms |   Max ms | Hata | Threshold                           | Sonuç |
| ------------ | ------------------------------------ | -------: | -------: | -------: | ---: | ----------------------------------- | ----- |
| PERF-AWN-001 | 1000 aktif alarm candidate filtering |     9,66 |    14,13 |    66,76 |    0 | p95 ≤ 250 ms; 1000 candidate        | PASS  |
| PERF-AWN-002 | 500 alarm evaluation batch           | 2.176,39 | 2.873,55 | 2.873,55 |    0 | p95 ≤ 10.000 ms; duplicate = 0      | PASS  |
| PERF-AWN-003 | Notification unread count            |     0,96 |     2,44 |     2,70 |    0 | p95 ≤ 100 ms; doğru count           | PASS  |
| PERF-AWN-004 | Notification pagination              |     2,01 |     3,07 |     5,08 |    0 | p95 ≤ 150 ms; missing/duplicate = 0 | PASS  |
| PERF-AWN-005 | Watchlist market summary             |   399,13 |   636,27 |   636,27 |    0 | p95 ≤ 750 ms; 500 row               | PASS  |

Beş senaryo da gerçek test PostgreSQL repository path'i ve deterministik fixture ile çalışmış;
error ve duplicate sayıları sıfır olmuştur. Kanonik ölçüm çıktıları
`reports/performance/alerts-watchlists-baseline.json` ve
`reports/performance/alerts-watchlists-baseline.md` dosyalarındadır.

## Scanner Runtime regresyon koruması

| Kapı                          | Önceki baseline | TASK-040 | Sonuç |
| ----------------------------- | --------------: | -------: | ----- |
| Unit/runtime                  |             181 |      223 | PASS  |
| PostgreSQL/Redis integration  |              24 |       41 | PASS  |
| Playwright                    |               3 |        5 | PASS  |
| AST request round-trip        |            PASS |     PASS | PASS  |
| Scanner performance threshold |             6/6 |      6/6 | PASS  |

Önceki Scanner Runtime test ve performance tabanında düşüş yoktur.

## Quality ve security kapıları

| Kapı                        | Sonuç                                                          |
| --------------------------- | -------------------------------------------------------------- |
| Format                      | `pnpm format:check` PASS                                       |
| Diff whitespace             | `git diff --check` PASS                                        |
| ADR validation              | PASS — 8 ADR; validator 3/3                                    |
| Lint                        | PASS — 8/8 package                                             |
| Typecheck                   | PASS — 8/8 package                                             |
| Secret scan                 | PASS — synthetic detection; 123 commit; 0 leak                 |
| Production dependency audit | PASS — 208 production package adı; 0 advisory; 0 high/critical |
| Production build            | PASS — 8/8 package                                             |

Sabit pnpm 9.15.4 istemcisinin emekliye ayrılan npm audit endpoint'i HTTP 410 döndürdüğü için,
önceki Scanner GO baseline'ında belgelenen npm bulk advisory fallback'ı kullanılmıştır. Sonuç sıfır
advisory'dir; bu sapma non-critical olarak kayıtlıdır.

## Baseline kararı

Alerts, Watchlists and Notification Runtime milestone'ı; 223 unit/runtime testi, 41 gerçek
PostgreSQL/Redis integration testi, beş Playwright akışı, beş performance threshold'u, sıfır
duplicate defect, IDOR/XSS korumaları ve bütün repository quality/security kapılarıyla **GO**
baseline olarak sabitlenmiştir. Bu baseline uygulama kodu davranışını değiştirmez.
