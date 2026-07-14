# TASK-010 — OHLCV Ingestion Core

**Durum:** Hazır  
**Bağımlılık:** TASK-008, TASK-009

## Amaç

Normalize edilmiş OHLCV barlarını doğrulayan ve idempotent şekilde saklayan ingest çekirdeğini oluşturmak.

## Kapsam

- fetch range command
- normalization boundary
- bar validation
- quality issue üretimi
- ingestion run
- upsert/revision policy
- closed/open bar ayrımı
- metrics
- fake provider integration test

## Kapsam dışı

- gerçek provider
- cron schedule
- indicator calculation
- timeframe aggregation
- corporate action adjustment

## Validasyon

- OHLC ilişkisi
- negatif hacim
- tarih aralığı
- duplicate
- timeframe
- future timestamp
- mapping varlığı
- sayı parse hatası

## Kabul kriterleri

- geçerli bar kaydedilir
- invalid bar quality issue oluşturur
- aynı batch tekrar çalışınca duplicate oluşmaz
- açık bar güncellenebilir
- kapalı bar revision politikası testlidir
- ingestion sayıları doğru kaydedilir

## T3 Code prompt

```text
TASK-010 görevini uygula.
ARCH-002 ve DB-002 belgelerini oku.
Fake provider ile çalışan OHLCV ingestion application service oluştur.
Validasyon, quality issue, ingestion run ve idempotent persistence ekle.
Indicator veya scanner kodu ekleme.
Integration testleri çalıştır.
```
