# NO-GO — Scanner Runtime Milestone Audit

**Görev:** TASK-030  
**Tarih:** 2026-07-14  
**Karar:** **NO-GO — sonraki pakete geçiş kapalı**  
**Ortam:** macOS arm64, Node.js 22.14.0, pnpm 9.15.4, PostgreSQL 17, Redis 7

## 1. Sonuç özeti

Scanner runtime'ın migration, application service, worker, API, saved scan, preset, progress ve
web smoke davranışları gerçek komutlarla doğrulandı. PostgreSQL ve Redis entegrasyon testleri
izole Docker servislerinde geçti; IDOR, idempotency, retry, duplicate result, cancellation ve
terminal progress kapıları başarılıdır.

Milestone yine de kapatılamaz. Repository-wide formatting kapısı sekiz scanner dosyasında
başarısızdır. Ayrıca scanner runtime için tekrar üretilebilir veri seti, ölçüm komutu, metrik ve
kabul eşiğinden oluşan bir performance baseline sözleşmesi yoktur. Worker telemetry süreleri
ölçmektedir, ancak bu gözlemler release eşiği değildir.

| Sınıflandırma           | Sayı | Açıklama                                                                  |
| ----------------------- | ---: | ------------------------------------------------------------------------- |
| passed                  |   26 | Runtime, integration, E2E, quality ve security kapıları                   |
| failed                  |    1 | Repository Markdown/TypeScript/CSS formatting kapısı                      |
| not verifiable          |    1 | Tanımlı scanner performance baseline ve kabul eşiği yok                   |
| deviation               |    1 | Web AST payload round-trip davranışı kodda var, E2E payload assertion yok |
| critical deviation      |    1 | Performance baseline TASK-030 kapsamına rağmen tanımlanmamış              |
| security not-verifiable |    0 | IDOR, secret scan ve dependency audit doğrudan çalıştırıldı               |

```text
Decision: NO-GO
Failed gates: 1
Critical deviations: 1
Security not-verifiable: 0
Duplicate run/result findings: 0
IDOR failures: 0
E2E smoke failures: 0
```

## 2. Audit ortamı ve yöntem

Host PATH'i başlangıçta Node 25.8.1 döndürdü. Repository hedefi olan Node 22.14.0 geçici paket
binary'si olarak indirildi ve bütün release kapıları için yalnız audit process PATH'ine eklendi;
repository veya global toolchain değiştirilmedi.

| Kontrol              | Komut/kanıt                                 | Sonuç                      |
| -------------------- | ------------------------------------------- | -------------------------- |
| Node hedefi          | `node --version`                            | `v22.14.0`                 |
| pnpm hedefi          | `pnpm --version`                            | `9.15.4`                   |
| Toolchain sözleşmesi | `pnpm version:check`                        | passed                     |
| PostgreSQL           | `postgres:17-alpine`, izole compose project | healthy                    |
| Redis                | `redis:7-alpine`, izole compose project     | healthy                    |
| Test veritabanı      | `_test` son ekli ayrı audit database        | destructive testlere uygun |

İlk integration çağrısı `_test` son eki olmayan bir database URL ile yapıldığı için testlerin
koruma kilidinde, test çalıştırmadan reddedildi. `atlas_audit_test` oluşturulduktan sonra aynı
suite'ler seri biçimde yeniden çalıştırıldı ve tamamı geçti. Bu ilk çağrı ürün/test failure olarak
sınıflandırılmamıştır; test izolasyon guard'ının doğru çalıştığının kanıtıdır.

## 3. Migration ve kalıcılık kapıları

| Kabul alanı                                       | Komut/test                                          | Sonuç                 |
| ------------------------------------------------- | --------------------------------------------------- | --------------------- |
| Drizzle şema tutarlılığı                          | `pnpm --filter @atlas/database db:check`            | passed                |
| Database unit/migration file kontrolleri          | `pnpm --filter @atlas/database test`                | 3 dosya, 7/7 passed   |
| Clean migration ve 18 domain tablosu              | Database integration                                | passed                |
| Seed idempotency                                  | Database integration                                | passed                |
| Immutable saved/preset revision                   | Database integration                                | passed                |
| Run/batch/result/tag/snapshot constraint'leri     | Database integration                                | passed                |
| Duplicate request/result database guard           | Scan-run repository integration                     | passed                |
| Destructive rollback ve yeniden forward migration | Database integration                                | passed                |
| PostgreSQL integration toplamı                    | `TEST_DATABASE_URL=<redacted> ... test:integration` | 2 dosya, 10/10 passed |

Kanıt dosyaları:

- `packages/database/src/database.integration.test.ts`
- `packages/database/src/scanner-runtime/scan-run-repository.integration.test.ts`
- `packages/database/drizzle/0002_scanner_runtime.sql`
- `packages/database/drizzle/rollback/0002_scanner_runtime.down.sql`

## 4. Run application service ve state machine

`pnpm --filter @atlas/domain test` sonucu **13 dosya, 121/121 test passed**.

| Kabul alanı                                             | Sonuç  | Kanıt                                                           |
| ------------------------------------------------------- | ------ | --------------------------------------------------------------- |
| Aynı key + normalize request aynı run                   | passed | `scanner-runtime-application.test.ts`                           |
| Aynı key + farklı request conflict                      | passed | `scanner-runtime-application.test.ts`                           |
| Plan/rule version, universe snapshot ve data cutoff     | passed | `scanner-runtime-application.test.ts`                           |
| Entitlement, kaynak yetkisi ve boş evren reddi          | passed | `scanner-runtime-application.test.ts`                           |
| Owner-only read/cancel ve idempotent cooperative cancel | passed | `scanner-runtime-application.test.ts`                           |
| Terminal cancel ve invalid transition reddi             | passed | `scanner-runtime-application.test.ts`                           |
| Silinmiş saved scan'den run başlatmama                  | passed | `scanner-runtime-application.test.ts`                           |
| Preset source revision'ın run'a aynen yazılması         | passed | `scanner-runtime-application.test.ts`, `preset-catalog.test.ts` |

Database concurrency testi eşzamanlı create çağrılarını unique guard ile tek run'a indirger.
Audit sırasında duplicate run finding yoktur.

## 5. Worker queue-to-result, retry ve cancellation

| Kontrol                                       | Komut/test                                                       | Sonuç                 |
| --------------------------------------------- | ---------------------------------------------------------------- | --------------------- |
| Worker unit suite                             | `pnpm --filter @atlas/worker test`                               | 9 dosya, 23/23 passed |
| Gerçek PostgreSQL/Redis integration           | `... pnpm --filter @atlas/worker test:integration`               | 4 dosya, 14/14 passed |
| Queue-to-batch-to-durable-result              | `scanner-worker.integration.test.ts`                             | passed                |
| Retry sonrası duplicate result üretmeme       | `runs batches to durable results and retries without duplicates` | passed                |
| Cooperative cancellation, batch boundary      | Worker unit + integration                                        | passed                |
| Redis progress publication kaybında PG sonucu | Worker integration                                               | passed                |
| Timeout'ta run/batch terminal failure         | Worker integration                                               | passed                |
| Correlation ve duration telemetry             | `scanner-run-processor.ts`                                       | present               |

Worker integration suite'inin tamamı audit makinesinde 5.64 saniyede, test gövdeleri 3.50
saniyede tamamlandı. Bu değer yalnız gözlemdir; sabit fixture boyutu ve kabul eşiği olmayan bir
release performance baseline olarak kullanılamaz.

## 6. API, ownership ve security

`pnpm --filter @atlas/api exec vitest run` sonucu **8 dosya, 26/26 test passed**.

| Kabul alanı                                     | Sonuç  | Kanıt                                               |
| ----------------------------------------------- | ------ | --------------------------------------------------- |
| Run create replay/conflict                      | passed | `scanner-runtime.integration.test.ts`               |
| Owner-only status                               | passed | IDOR testi HTTP 403 doğruladı                       |
| Owner-only results                              | passed | Results IDOR testi HTTP 403 doğruladı               |
| Owner-only cancel                               | passed | Cancel IDOR testi HTTP 403 doğruladı                |
| Cursor pagination ve lazy explanation           | passed | Runtime API integration                             |
| Cancel idempotency ve terminal cancel rejection | passed | Runtime API integration                             |
| Production-safe error mapping                   | passed | API integration ve global exception filter testleri |
| OpenAPI                                         | passed | Dedicated `openapi:check`, 1/1                      |
| Redis fast progress / PostgreSQL fallback       | passed | `scanner-progress.test.ts`                          |
| Progress monotonluğu ve stale detection         | passed | `scanner-progress.test.ts`                          |
| Terminal progress freeze                        | passed | `scanner-progress.test.ts`                          |

Security kapıları:

| Kontrol                              | Komut                   | Sonuç                 |
| ------------------------------------ | ----------------------- | --------------------- |
| Synthetic secret detection           | `pnpm secret:scan:test` | passed                |
| Working tree + 93 commit secret scan | `pnpm secret:scan`      | 0 finding             |
| Production dependency audit          | `pnpm audit --prod`     | 0 known vulnerability |
| Skip/only taraması                   | `rg` test kaynakları    | 0 finding             |
| IDOR status/results/cancel           | API integration suite   | 0 failure             |

## 7. Saved scans ve preset katalog

| Kabul alanı                                             | Sonuç  | Kanıt                                                       |
| ------------------------------------------------------- | ------ | ----------------------------------------------------------- |
| CRUD, immutable revision ve stale expectedRevision      | passed | Domain saved scan suite; API `SAVED_SCAN_CONFLICT` HTTP 409 |
| Ownership, quota port, clone, tags, soft delete/restore | passed | `saved-scan-application-service.test.ts`, 3/3               |
| Public/link sharing bulunmaması                         | passed | Visibility yalnız `private`                                 |
| DOC-012 kategorileri ve ilk 10 versioned AST            | passed | `preset-catalog.test.ts`                                    |
| Tüm preset AST validator/planner                        | passed | Preset catalog testi katalog boyunca doğruluyor             |
| Indicator version varlığı                               | passed | Core registry lookup                                        |
| Seed idempotency                                        | passed | PostgreSQL database integration                             |
| Unpublished visibility                                  | passed | Preset API service testi                                    |
| Preset run source revision                              | passed | Domain + API preset testleri                                |

## 8. Web scanner ve E2E

| Kontrol                                   | Komut/test                          | Sonuç               |
| ----------------------------------------- | ----------------------------------- | ------------------- |
| Web unit suite                            | `pnpm --filter @atlas/web test`     | 2 dosya, 3/3 passed |
| Hazır tarama smoke                        | Playwright Chromium                 | passed              |
| Özel tarama validation/run smoke          | Playwright Chromium                 | passed              |
| E2E toplamı                               | `pnpm --filter @atlas/web test:e2e` | 2/2 passed          |
| Idempotency-Key varlığı                   | Playwright route assertion          | passed              |
| Progress terminal sonucu ve results       | Her iki smoke                       | passed              |
| Explanation drawer ve notEvaluable ayrımı | Hazır tarama smoke                  | passed              |
| Cursor pagination uygulaması              | `useInfiniteQuery` + `nextCursor`   | static evidence     |
| AST payload round-trip                    | Client implementation               | deviation           |

Hazır preset AST'si API fixture'ından yüklenip exact preset revision endpoint'iyle çalıştırılır.
Özel tarama UI'da düzenlenip server validation ve run endpoint'lerine gider. Ancak Playwright
route'u özel run request body'sindeki düzenlenmiş AST'yi assert etmez. Davranış kodda mevcut olsa
da TASK-030 audit kanıtı için payload round-trip assertion eklenmelidir.

## 9. Repository quality kapıları

Bütün Node tabanlı komutlar hedef Node 22.14.0 ve pnpm 9.15.4 ile çalıştırıldı.

| Kontrol          | Komut                                    | Sonuç               |
| ---------------- | ---------------------------------------- | ------------------- |
| Toolchain        | `pnpm version:check`                     | passed              |
| Lint             | `pnpm lint`                              | 8/8 task passed     |
| Typecheck        | `pnpm typecheck`                         | 8/8 task passed     |
| Production build | `NEXT_PUBLIC_API_URL=<local> pnpm build` | 8/8 task passed     |
| ADR validation   | `pnpm validate:adr`                      | 8 ADR passed        |
| ADR validator    | `pnpm test:adr-validator`                | 3/3 passed          |
| Version checker  | `pnpm test:version-check`                | 3/3 passed          |
| Whitespace       | `git diff --check`                       | passed              |
| Formatting       | `pnpm format:check`                      | **failed, 8 files** |

Formatting failure listesi:

1. `apps/api/src/scanner/scanner-catalog.dto.ts`
2. `apps/web/e2e/scanner.spec.ts`
3. `apps/web/playwright.config.ts`
4. `apps/web/src/app/globals.css`
5. `apps/web/src/features/scanner/api.ts`
6. `apps/web/src/features/scanner/rule-model.ts`
7. `apps/web/src/features/scanner/scanner-workspace.tsx`
8. `apps/web/src/features/scanner/types.ts`

## 10. Önceki milestone prerequisite'leri

| Rapor                                                 | Karar | Failed | Critical deviation | Sonuç  |
| ----------------------------------------------------- | ----- | -----: | -----------------: | ------ |
| `reports/foundation-milestone-reaudit.md`             | GO    |      0 |                  0 | passed |
| `reports/indicator-scanner-core-milestone-reaudit.md` | GO    |      0 |                  0 | passed |

Önceki auditler GO durumundadır. Mevcut TASK-030 failures bu kararları geriye dönük değiştirmez.

## 11. Sapmalar ve remediation gereksinimleri

| Kimlik | Sınıf              | Kritiklik | Açıklama                                                   | Kapanış kriteri                                                   |
| ------ | ------------------ | --------- | ---------------------------------------------------------- | ----------------------------------------------------------------- |
| F-001  | failed gate        | kritik    | `pnpm format:check` sekiz scanner dosyasında başarısız     | Sekiz dosyayı formatla; repository-wide format check PASS         |
| D-001  | critical deviation | kritik    | Scanner performance baseline sözleşmesi ve threshold yok   | Sabit fixture, komut, metrik, warm/cold kuralı ve eşik tanımla    |
| D-002  | deviation          | orta      | Custom scan E2E request body AST round-trip assert etmiyor | UI değişikliğinin run/validate payload'ında korunduğunu assert et |

Performance remediation minimum kapsamı:

- versioned ve deterministik fixture/universe büyüklüğü,
- warm-up ve cold/warm cache ayrımı,
- en az run duration ve instrument throughput metriği,
- tekrar sayısı, median ve p95 hesaplama yöntemi,
- CI ve local donanım farkını yöneten kabul eşiği,
- duplicate result ve terminal state doğrulamasını koruyan benchmark harness.

## 12. Son karar

**NO-GO.** Runtime davranışları, IDOR kapıları, duplicate guard'lar, integration suite'leri ve iki
Playwright smoke testi başarılıdır. Buna karşın `failed gates: 1` ve `critical deviations: 1`
olduğu için TASK-030 GO koşulu sağlanmamıştır. **F-001, D-001 ve D-002 kapanmadan sonraki pakete
geçilmemelidir.** Remediation sonrasında aynı komut matrisiyle TASK-030 re-audit yapılmalıdır.
