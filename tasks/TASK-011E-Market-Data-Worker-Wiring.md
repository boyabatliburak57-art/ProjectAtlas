# TASK-011E — Market Data Worker Composition Root Wiring

**Durum:** Tamamlandı
**Bağımlılık:** TASK-011D

## Amaç

TASK-009 ve TASK-010 kapsamında oluşturulan market-data handler'larını gerçek BullMQ worker composition root'una bağlamak.

## Kapsam

- queue name/constants
- job name/version
- processor registration
- dependency composition
- fake provider adapter injection
- database repository adapter injection
- instrument import job wiring
- OHLCV ingestion job wiring
- graceful shutdown
- retry classification
- job idempotency
- worker smoke/integration tests
- documentation.

## Kapsam dışı

- gerçek ticari provider
- production schedule
- cron
- indicator calculation
- scanner execution.

## Test senaryoları

1. Instrument import job queue'ya eklenir ve processor tarafından çalıştırılır.
2. Aynı job idempotency key ile duplicate üretmez.
3. OHLCV job geçerli barları kaydeder.
4. Invalid bar quality issue üretir.
5. Unsupported timeframe retry edilmez.
6. Geçici provider hatası retry politikasına girer.
7. Shutdown sırasında worker yeni iş almaz.
8. Queue/processor adı uyuşmazlığı testte yakalanır.

## Kabul kriterleri

- Handler'lar composition root'tan erişilebilir
- Queue üzerinden uçtan uca fake provider testi geçer
- Job isimleri merkezi tanımlı
- Retry/non-retry error taxonomy uygulanmış
- Job loglarında correlation/job id var
- Worker shutdown testi başarılı
- `pnpm` integration suite geçiyor.

## T3 Code prompt

```text
TASK-011E görevini uygula.

TASK-009 ve TASK-010 implementasyonlarını incele.
Mevcut instrument import ve OHLCV ingestion handler'larını BullMQ market-data worker composition root'una bağla.
Fake provider ve gerçek PostgreSQL/Redis test ortamıyla queue-to-handler integration testi ekle.
Gerçek provider veya cron ekleme.
Retry classification, idempotency ve graceful shutdown davranışını doğrula.
```
