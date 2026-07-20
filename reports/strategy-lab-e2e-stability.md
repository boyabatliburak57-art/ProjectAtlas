# PASS — Strategy Lab ve Full Playwright Suite Stability

Tarih: 2026-07-19  
Node: 22.14.0  
pnpm: 9.15.4  
Playwright: 1.55.1  
Normal worker sayısı: 4  
Retry: 0

## Başlangıç bulgusu

Milestone audit başlangıcı 15 testin 12 PASS, 1 FAIL ve 2 not-run sonucu ile tamamlanmıştı. Strategy Lab'in `--workers=1` koşumundaki 4/4 PASS sonucu bu raporda başarı kanıtı olarak tek başına kullanılmadı.

Başarısız test:

- `backtest payload round-trip, terminal polling, results, cursor and methodology`

Çalışmayan testler:

- `cancellation, grid experiment and in/out-of-sample comparison`
- `strategy, run and experiment IDOR are rendered safely`

İlk hata, `Daha fazla işlem` tıklamasından hemen sonra route handler sayacının senkron okunmasıydı. İkinci cursor sayfasının HTTP yanıtı tamamlanmadan `tradePages === 2` assertion'ı çalışıyordu. Strategy Lab spec'inin serial olması sonraki iki testi not-run durumuna getiriyordu.

İstenen `guides/PLAYWRIGHT_FULL_SUITE_STABILITY_GUIDE.md` dosyası repository'de bulunamadı. Mevcut görev kartı `tasks/TASK-070D-Strategy-Lab-E2E-Stability.md` ve audit raporu esas alındı. Başlangıçta `apps/web/test-results/.last-run.json` dışında trace, screenshot, video, browser network logu veya API/worker log artifact'i yoktu. Eski ayardaki `trace: on-first-retry` ve yerel `retries: 0` birleşimi ilk hatada trace üretmiyordu. Reproduction sırasında `error-context.md`; remediation sırasında screenshot ve trace artifact'leri incelendi. Failure artifact politikası `trace: retain-on-failure` ve `screenshot: only-on-failure` olarak düzeltildi.

## Kök neden ve düzeltmeler

| İncelenen alan                            | Sonuç           | Kanıt / düzeltme                                                                                                                                                         |
| ----------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shared PostgreSQL state                   | Kök neden değil | Web testleri browser-context route fixture'ları kullanıyor; Strategy fixture state'i her testte yeniden kuruluyor.                                                       |
| Fixed user/e-mail veya resource collision | Risk giderildi  | Strategy owner ve bütün resource ID'leri test ID, project, repeat ve worker bağlamından türetilen namespace'e bağlandı.                                                  |
| Sabit resource ID                         | Risk giderildi  | Strategy, clone, run, cancel run, experiment, foreign resource ve snapshot test başına benzersiz.                                                                        |
| Idempotency key reuse                     | Risk giderildi  | Backtest create header'ı zorunlu ve test-local `Set` ile duplicate kullanımı reddediliyor.                                                                               |
| Parallel worker collision                 | Doğrulandı      | Next development server paralel cold compile sırasında `ERR_NETWORK_IO_SUSPENDED` üretti. E2E web server production build/start yoluna alındı.                           |
| Fixed port collision                      | Risk giderildi  | API ve web server için `reuseExistingServer: false`; stale process sessizce reuse edilmiyor.                                                                             |
| Browser context/session leak              | Bulunmadı       | Playwright'ın test başına context izolasyonu korunuyor; Strategy serial modu kaldırıldı.                                                                                 |
| Polling/terminal state race               | Doğrulandı      | Completed ve cancelled durumlar gerçek API response body üzerinden doğrulanıyor; terminalden sonra poll sayacı sabit.                                                    |
| Test-order dependency                     | Risk giderildi  | Strategy serial modu kaldırıldı; dört test normal worker'larla bağımsız çalışıyor.                                                                                       |
| Timezone/system clock                     | Kök neden değil | Fixture zamanları sabit; namespace sistem saatine bağlı değil.                                                                                                           |
| Unawaited action/network                  | Ana kök neden   | Trade cursor, experiment submit, cancellation, market navigation/chart/financial fetch, portfolio post/reversal ve notification lifecycle response koşullarına bağlandı. |
| Selector ambiguity                        | Kök neden değil | Role/name ve row scope korunuyor; assertion azaltılmadı.                                                                                                                 |
| Global setup/teardown leakage             | Bulunmadı       | Repository'de Playwright global setup/teardown tanımı yok. Server lifecycle Playwright `webServer` tarafından yönetiliyor.                                               |
| Service worker/browser cache              | Risk giderildi  | E2E browser context'lerinde service worker bloklandı; production server her koşumda temiz başlatılıyor.                                                                  |

Arbitrary `waitForTimeout(2200)` kaldırıldı. Scanner başlangıcı `load` event'i yerine `domcontentloaded` ve görünür Rule Builder koşuluna bağlandı. Video kaydı tüm testleri sürekli kaydederek paralel I/O baskısı oluşturduğu için kapalı; failure trace ve screenshot korunuyor.

Ürün kaynak kodu veya assertion kapsamı değiştirilmedi. Değişiklikler Playwright configuration ve E2E senkronizasyon/izolasyon koduyla sınırlıdır.

## Final koşum kanıtı

Tüm tablolarda `unexpected = 0`, `flaky = 0`, `skipped/not-run = 0` ve retry sayısı 0'dır.

### Full suite — normal worker

Komut: `pnpm --filter @atlas/web exec playwright test --workers=4 --retries=0 --reporter=json`

| Ardışık koşum | PASS/test |      Süre |
| ------------- | --------: | --------: |
| 1             |     15/15 | 31.996 sn |
| 2             |     15/15 | 31.944 sn |
| 3             |     15/15 | 34.444 sn |

Kullanıcının istediği iki ardışık koşum ve görev kartındaki daha sıkı üç ardışık koşum şartı sağlandı.

### Strategy Lab — normal worker, beş ardışık koşum

Komut: `pnpm --filter @atlas/web exec playwright test e2e/strategy-lab.spec.ts --workers=4 --retries=0 --reporter=json`

| Ardışık koşum | PASS/test |      Süre |
| ------------- | --------: | --------: |
| 1             |       4/4 | 59.096 sn |
| 2             |       4/4 | 52.352 sn |
| 3             |       4/4 | 44.637 sn |
| 4             |       4/4 | 47.592 sn |
| 5             |       4/4 | 44.497 sn |

Final repository state'indeki ek normal-worker doğrulaması da 4/4 PASS ve 26.747 sn sürdü.

### Strategy Lab — single worker

Komut: `pnpm --filter @atlas/web exec playwright test e2e/strategy-lab.spec.ts --workers=1 --retries=0 --reporter=json`

Sonuç: 4/4 PASS, 27.635 sn. Bu sonuç normal-worker kanıtına ek olarak raporlandı; onun yerine kullanılmadı.

### Düzeltilen test — 10 tekrar

Komut: `pnpm --filter @atlas/web exec playwright test e2e/strategy-lab.spec.ts --grep "backtest payload round-trip" --repeat-each=10 --workers=4 --retries=0 --reporter=json`

Sonuç: 10/10 PASS, 35.229 sn; duplicate/missing trade assertion'ları, terminal API durumu ve polling-stop assertion'ı korunmuştur.

## Yasaklı kalıp ve suite bütünlüğü

- Full suite single worker'a sabitlenmedi; normal kanıt 4 worker ile alındı.
- `skip`, `fixme` veya `only` eklenmedi.
- Retry kapatıldı; retry-only veya flaky test sayısı 0.
- Timeout artırılmadı.
- Assertion azaltılmadı ve hiçbir spec suite dışına çıkarılmadı.
- Test sayısı 15 olarak korundu; final not-run sayısı 0.

## Sonuç

PASS. Full Playwright suite normal worker sayısıyla ardışık üç kez, Strategy Lab normal worker sayısıyla ardışık beş kez, Strategy Lab single worker ile ve düzeltilen test on tekrarda hatasız tamamlandı.
