# NO-GO — Scanner Runtime Milestone Re-Audit

**Görev:** TASK-030D  
**Tarih:** 2026-07-14  
**Karar:** **NO-GO — sonraki pakete geçiş önerilmez**  
**Ortam:** macOS arm64, Apple M1, Node.js 22.14.0, pnpm 9.15.4, PostgreSQL 17.10,
Redis 7.4.9

## 1. Karar özeti

TASK-030 remediation hedefleri kapanmıştır:

- **F-001 kapalı:** repository-wide `pnpm format:check` başarılıdır.
- **D-001 kapalı:** deterministik fixture, gerçek worker/PostgreSQL/Redis benchmark yolu, JSON ve
  Markdown baseline raporu ve zorunlu threshold'lar mevcuttur; altı senaryo PASS durumundadır.
- **D-002 kapalı:** Playwright gerçek UI'da custom AST oluşturmakta, gerçek scanner API
  validation/run isteklerini network katmanından gözlemlemekte ve normalized AST round-trip'ını
  doğrulamaktadır.

Milestone buna rağmen **NO-GO**'dur. Zorunlu `pnpm validate:adr` kapısı yeni bir repository
tutarsızlığı nedeniyle başarısızdır: `architecture/ADR-008-Drizzle-PostgreSQL-Data-Access.md`
dosyası vardır ancak `architecture/ADR_INDEX.md` içinde kayıtlı değildir. Audit görevi bu bağımsız
mimari kayıt sorununu gizlememiş veya kapsam dışı bir düzeltme yapmamıştır.

| Sınıflandırma           | Sayı | Açıklama                                                |
| ----------------------- | ---: | ------------------------------------------------------- |
| passed                  |   18 | 19 zorunlu kapının ADR dışındaki tamamı                 |
| failed                  |    1 | ADR resmi indeks doğrulaması                            |
| not verifiable          |    0 | Bütün zorunlu alanlar gerçek komutlarla doğrulandı      |
| deviation               |    0 | Önceki D-002 kapatıldı                                  |
| critical deviation      |    0 | Önceki D-001 kapatıldı                                  |
| security not-verifiable |    0 | IDOR, secret ve dependency audit doğrudan çalıştırıldı  |
| regression              |    0 | Runtime, integration ve E2E tabanlarında test kaybı yok |

```text
Decision: NO-GO
Failed gates: 1
Critical deviations: 0
Security not-verifiable: 0
Runtime regression: 0
Integration regression: 0
E2E regression: 0
Performance threshold failures: 0
```

## 2. Remediation değişikliklerinin doğrulanması

| Paket     | İncelenen sonuç                                                                     | Re-audit sonucu |
| --------- | ----------------------------------------------------------------------------------- | --------------- |
| TASK-030A | Sekiz scanner dosyası repository formatter'ı ile biçimlendirildi                    | PASS            |
| TASK-030B | 600 BIST fixture, 70.900 bar, altı benchmark, threshold config ve iki rapor         | PASS            |
| TASK-030C | Cross-indicator UI operandı, gerçek API E2E harness ve AST network round-trip testi | PASS            |

Formatter ignore kuralı eklenmemiş, format script kapsamı daraltılmamış ve CI kontrolü
gevşetilmemiştir. Performance runner gerçek `WorkerRuntime`, PostgreSQL market-data loader,
BullMQ/Redis ve durable scanner repository yolunu kullanmaktadır. E2E scanner validation ve run
işlemleri gerçek controller, service, `ScanRunApplicationService`, AST validator ve Execution
Planner üzerinden geçmektedir; yalnız dış yürütme/sonuç sağlayıcısı deterministik fixture'dır.

## 3. Regresyon tabanı

İlk audit'in 206 runtime toplamı 180 unit/runtime + 24 PostgreSQL/Redis integration + 2
Playwright smoke testinden oluşmaktadır. Aynı hesap re-audit'te korunmuştur.

| Katman                         | İlk audit | Re-audit | Fark | Sonuç |
| ------------------------------ | --------: | -------: | ---: | ----- |
| Domain unit                    |       121 |      121 |    0 | PASS  |
| Database unit                  |         7 |        7 |    0 | PASS  |
| Worker unit                    |        23 |       24 |   +1 | PASS  |
| API unit/integration-in-memory |        26 |       26 |    0 | PASS  |
| Web unit                       |         3 |        3 |    0 | PASS  |
| Unit/runtime ara toplamı       |       180 |      181 |   +1 | PASS  |
| PostgreSQL/Redis integration   |        24 |       24 |    0 | PASS  |
| Mevcut Playwright smoke        |         2 |        2 |    0 | PASS  |
| Yeni AST round-trip E2E        |         0 |        1 |   +1 | PASS  |
| Karşılaştırılabilir toplam     |       206 |      208 |   +2 | PASS  |

Test sayısı düşmemiştir. Worker artışı TASK-030B percentile istatistik testi, E2E artışı
TASK-030C AST round-trip testidir.

## 4. Komut matrisi

Tüm Node tabanlı komutlar hedef Node 22.14.0 ve pnpm 9.15.4 ile çalıştırıldı.

| Kapı                        | Gerçek komut                                                                                     | Sonuç                              |
| --------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------- |
| Toolchain                   | `pnpm version:check`                                                                             | PASS                               |
| Formatting                  | `pnpm format:check`                                                                              | PASS                               |
| ADR validation              | `pnpm validate:adr`                                                                              | **FAIL — ADR-008 index kaydı yok** |
| ADR validator self-test     | `pnpm test:adr-validator`                                                                        | 3/3 PASS                           |
| Version checker self-test   | `pnpm test:version-check`                                                                        | 3/3 PASS                           |
| Drizzle schema check        | `pnpm --filter @atlas/database db:check`                                                         | PASS                               |
| Lint                        | `pnpm lint`                                                                                      | 8/8 package PASS                   |
| Typecheck                   | `pnpm typecheck`                                                                                 | 8/8 package PASS                   |
| Unit/runtime                | `pnpm test`                                                                                      | 181/181 PASS                       |
| Database integration        | `TEST_DATABASE_URL=<redacted> pnpm --filter @atlas/database test:integration`                    | 10/10 PASS                         |
| Worker PG/Redis integration | `TEST_DATABASE_URL=<redacted> REDIS_URL=<redacted> pnpm --filter @atlas/worker test:integration` | 14/14 PASS                         |
| Playwright                  | `pnpm --filter @atlas/web test:e2e`                                                              | 3/3 PASS                           |
| Performance                 | `pnpm perf:scanner`                                                                              | 6/6 scenario PASS                  |
| Synthetic secret detection  | `pnpm secret:scan:test`                                                                          | PASS                               |
| Repository/history secret   | `pnpm secret:scan`                                                                               | 100 commit, 0 finding              |
| Production dependency audit | `pnpm audit --prod`                                                                              | 0 known vulnerability              |
| Production build            | `NEXT_PUBLIC_API_URL=<local> pnpm build`                                                         | 8/8 package PASS                   |
| Skip/only scan              | test kaynaklarında `rg` skip/only pattern taraması                                               | 0 finding                          |
| Whitespace                  | `git diff --check`                                                                               | PASS                               |

Integration suite'leri izole `atlas-scanner-reaudit` compose projesinde PostgreSQL 17 ve Redis 7
ile, `_test` son ekli ayrı veritabanında seri olarak çalıştırılmış ve container/volume'lar
sonrasında kaldırılmıştır.

## 5. Performance baseline ve threshold sonuçları

Kaynak raporlar:

- `reports/performance/scanner-runtime-baseline.json`
- `reports/performance/scanner-runtime-baseline.md`

Fixture: 600 BIST enstrümanı, 70.900 persisted bar, `1d` ve `1h`, worker concurrency 2, batch
size 100. Dış internet veya gerçek provider kullanılmamıştır.

| ID           | Senaryo           |   p50 ms |   p95 ms |   Max ms | Threshold                                              | Sonuç |
| ------------ | ----------------- | -------: | -------: | -------: | ------------------------------------------------------ | ----- |
| PERF-SCN-001 | Small synchronous |   108,46 |   153,33 |   153,33 | warm p95 ≤ 750; cold p95 ≤ 2.000; error = 0            | PASS  |
| PERF-SCN-002 | Full BIST         | 2.272,33 | 2.770,34 | 2.770,34 | queue-terminal p95 ≤ 8.000; duplicate/error = 0        | PASS  |
| PERF-SCN-003 | Medium complexity | 3.722,04 | 4.351,44 | 4.351,44 | p95 ≤ 15.000; crash = 0; deterministic; heap ≤ 128 MiB | PASS  |
| PERF-SCN-004 | Result pagination |     0,77 |     8,37 |     8,37 | p95 ≤ 300; duplicate/missing = 0                       | PASS  |
| PERF-SCN-005 | Progress polling  |     0,87 |     2,38 |     2,38 | p95 ≤ 250; unauthorized/terminal change = 0            | PASS  |
| PERF-SCN-006 | Idempotent replay |     1,31 |     6,49 |     6,49 | p95 ≤ 300; new run = 0; request hash stable            | PASS  |

Small cold ölçümü 205,87 ms'dir ve 2.000 ms eşiğinin altındadır. Bütün senaryolarda hata sayısı
sıfırdır. Full BIST senaryosunda 600/600 enstrüman işlenmiş/eşleşmiş, duplicate result sıfır ve
progress monotonicity %100'dür. Medium senaryoda matched count bütün tekrarlarda deterministiktir,
10 `notEvaluable` üretilmiş ve ölçülen heap growth 0 MiB'dir. Progress polling'de unauthorized
access ve terminal change sıfırdır. Idempotent replay yeni run üretmemiş ve tek request hash
korunmuştur.

## 6. AST request round-trip E2E

Playwright Chromium sonucu **3/3 PASS**:

1. Hazır tarama smoke: PASS.
2. Mevcut özel tarama validation/run smoke: PASS.
3. Yeni custom AST request round-trip: PASS.

Yeni test gerçek UI ile active BIST universe ve root `AND` altında `RSI(14, v1, 1d) LT 35` ile
`EMA(20, v1, 1d) CROSSES_ABOVE EMA(50, v1, 1d)` kurmuştur. Browser'ın gerçek
`POST /scanner/runs` request body’si network katmanından okunmuş; rule version, universe, root,
child sayısı, benzersiz `group-*`/`condition-*` nodeId politikası ve iki koşulun bütün operandları
assert edilmiştir.

Gerçek `POST /scanner/validate` cevabı valid ve errors boş dönmüş; normalized AST, nodeId'lerden
bağımsız canonical semantik karşılaştırmada request AST ile eşdeğer bulunmuştur. Run response
`ruleVersion: 1`, `planVersion: 1` taşımış ve results ekranının GET isteği aynı run ID'sini
kullanmıştır. API validation bypass edilmemiştir.

## 7. Runtime, persistence ve security davranışları

| Kabul alanı         | Çalışan kanıt                                                   | Sonuç |
| ------------------- | --------------------------------------------------------------- | ----- |
| Duplicate run       | Domain idempotency + PostgreSQL concurrent repository testleri  | PASS  |
| Duplicate result    | Database unique guard + worker retry integration + PERF-SCN-002 | PASS  |
| Retry               | Worker integration retry-without-duplicates senaryosu           | PASS  |
| Cancellation        | Domain state machine, API owner cancel ve worker batch boundary | PASS  |
| Progress            | API monotonic/fallback/freeze testleri + worker integration     | PASS  |
| IDOR                | API status/results/cancel owner-other-user HTTP testleri        | PASS  |
| Saved scan conflict | Stale expectedRevision → `SAVED_SCAN_CONFLICT`                  | PASS  |
| Preset revision     | Published catalog ve run source revision testleri               | PASS  |
| Secret scan         | Synthetic + working tree + 100 commit history                   | PASS  |
| Dependency audit    | Production dependency graph, 0 known vulnerability              | PASS  |
| Skip/only           | Test kaynaklarında 0 finding                                    | PASS  |

Security not-verifiable sayısı sıfırdır.

## 8. Bulgular

| Kimlik | Sınıf       | Kritiklik | Bulgu                                                        | Kapanış kriteri                                                             |
| ------ | ----------- | --------- | ------------------------------------------------------------ | --------------------------------------------------------------------------- |
| F-002  | failed gate | kritik    | ADR-008 dosyası resmi `ADR_INDEX.md` içinde kayıtlı değildir | ADR-008'i doğru başlık/durumla resmi tabloya ekle; `pnpm validate:adr` PASS |

Önceki F-001, D-001 ve D-002 tekrar açılmamıştır.

## 9. Son karar

**NO-GO.** Runtime regresyonu yoktur, performance baseline kurulmuş ve bütün threshold'lar
geçilmiştir; AST round-trip ve güvenlik kapıları doğrulanmıştır. Ancak zorunlu ADR validation
kapısı başarısız olduğu için `failed: 0` GO koşulu sağlanmamaktadır. **F-002 kapatılıp tam zorunlu
kapılar yeniden çalıştırılmadan sonraki pakete geçilmesi önerilmez.**
