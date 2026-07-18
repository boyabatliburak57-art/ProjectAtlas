# Project Atlas

Project Atlas, Borsa İstanbul (BIST) paylarını teknik ve temel verilerle tarayan; hazır ve kullanıcı tanımlı taramalar, alarm, izleme listesi, portföy ve ileride backtest yetenekleri sunacak modüler bir web uygulamasıdır.

## İlk sürüm kapsamı

- BIST sembol evreni ve şirket ana verisi
- OHLCV piyasa verisi entegrasyonu
- Teknik indikatör motoru
- Özelleştirilebilir tarama motoru
- Hazır taramalar ve kategoriler
- Çoklu zaman dilimi
- Hisse detay ekranı
- Watchlist ve favoriler
- Alarm sistemi
- Temel finansal filtreler
- Portföy takibi
- Admin, paket ve yetki temeli

## Kapsam dışı

- Otomatik emir iletimi
- Aracı kurum hesabına bağlanma
- Yatırım danışmanlığı
- ABD piyasaları, kripto, VİOP ve Forex

## Okuma sırası

1. `ATLAS_INDEX.md`
2. `T3_CODE_START_HERE.md`
3. `SYSTEM_PROMPT.md`
4. `docs/` içindeki belgeler
5. `architecture/`, `database/` ve `api/` belgeleri
6. Uygulanacak `tasks/TASK-xxx.md`

**Sürüm:** 0.1.0-foundation  
**Aşama:** Dokümantasyon ve temel proje hazırlığı

## v0.2 ile eklenenler

- Teknoloji yığını kararları
- Repository ve kod standartları
- Güvenlik ve gizlilik gereksinimleri
- Geliştirme ve release süreci
- Mimari karar kayıtları
- Market Data Engine mimarisi
- Market Data fiziksel veri tasarımı
- Instrument ve bar API taslağı
- TASK-004 ile TASK-010 arası uygulama görevleri

## v0.3 ile eklenenler

- Indicator Engine gereksinimleri ve mimarisi
- Scanner Engine gereksinimleri ve mimarisi
- İndikatör sürümleme ve fixture standardı
- Üç durumlu scanner değerlendirmesi
- Indicator/scanner veri modeli ve API taslağı
- TASK-011–TASK-020

## v0.3.1 geçiş kuralı

Foundation audit NO-GO sonucu nedeniyle Indicator Engine görevleri geçici olarak durdurulmuştur.

Önce TASK-011A ile TASK-011F uygulanır. Re-audit GO sonucu vermeden TASK-012 başlatılmaz.

## v0.4 ile eklenenler

- Scanner Runtime ve persistence
- Saved/preset scan revision modeli
- Scanner runtime API ve UX
- TASK-021–TASK-030

## v0.4.1 geçiş kuralı

TASK-021A, TASK-021B ve TASK-021C tamamlanıp re-audit GO sonucu vermeden TASK-022 başlatılmaz.

## v0.4.2 geçiş kuralı

Scanner Runtime milestone audit sonucu NO-GO'dur.

Açık bulgular:

- F-001: sekiz scanner dosyasında format farkı
- D-001: ölçülebilir performance baseline ve threshold eksikliği
- D-002: custom scan AST request round-trip E2E eksikliği

TASK-030A, TASK-030B, TASK-030C ve TASK-030D tamamlanıp re-audit GO vermeden sonraki pakete geçilmez.

## v0.5 ile eklenenler

- Alarm değerlendirme ve bildirim gereksinimleri
- Çoklu özel watchlist ve scanner universe desteği
- Notification Center ve kullanıcı tercihleri
- Alert evaluation ve notification delivery runtime mimarileri
- Alerts, watchlists ve notifications veri/API tasarımları
- TASK-031–TASK-040

## v0.5 geçiş kuralı

TASK-031, TASK-030D GO sonucuna bağlıdır. TASK-031 tamamlanmadan TASK-032 başlatılmaz.

TASK-040 Alerts and Watchlists milestone audit sonucu GO olmadan sonraki pakete geçilmez.

## v0.6.1 Portfolio/Risk Remediation

TASK-050 sonucu NO-GO:

- PERF-PORT-006 gerçek application/API cursor pagination yolu eksik
- Watchlist market summary p95, 750 ms eşiğini aşıyor

Görev sırası: TASK-050A → TASK-050B → TASK-050C.

TASK-050C GO olmadan sonraki pakete geçilmez.

## v0.7 Market Intelligence, Symbol Detail and Advanced Charting

Belgeler:

- DOC-025–DOC-029
- ARCH-010–ARCH-012
- Market Intelligence Decision Proposal
- DB-007
- API-007
- Market Intelligence Test/Performance/Chart guides

Görev sırası: TASK-051 → TASK-060.

TASK-060 GO olmadan sonraki pakete geçilmez.

## v0.8 Strategy Lab, Backtesting and Research Experiments

Belgeler:

- DOC-030–DOC-034 backtesting, strategy versioning, execution/cost/data integrity, research experiments ve UX gereksinimleri
- ARCH-013–ARCH-015 deterministic engine, worker/results ve experiment runtime mimarileri
- Backtesting Policies Decision Proposal
- DB-008 Strategies, Backtests and Experiments persistence tasarımı
- API-008 Strategies, Backtests and Experiments API sözleşmesi
- Backtest Data Integrity, Test Matrix ve Performance Baseline rehberleri

Görev sırası: TASK-061 → TASK-070.

TASK-062 sırasında sabit ADR numarası kullanılmaz; repository'deki mevcut ADR kayıtları taranarak
sonraki boş ve benzersiz kimlikler seçilir.

TASK-070 Strategy Lab milestone audit sonucu GO olmadan sonraki pakete geçilmez.
