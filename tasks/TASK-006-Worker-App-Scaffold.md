# TASK-006 — Worker Application Scaffold

**Durum:** Hazır  
**Bağımlılık:** TASK-002, TASK-003

## Amaç

`apps/worker` altında BullMQ tabanlı worker iskeletini oluşturmak.

## Kapsam

- Redis bağlantısı
- queue isimlendirme standardı
- örnek internal health/heartbeat
- graceful shutdown
- structured logging
- retry varsayılanları
- dead-letter yaklaşımı için temel
- test altyapısı

## Kapsam dışı

- gerçek provider işi
- indikatör hesaplama
- scanner çalıştırma
- alarm değerlendirme

## Kabul kriterleri

- worker Redis'e bağlanır
- bağlantı yoksa kontrollü hata verir
- shutdown sırasında yeni iş almaz
- test job idempotent örnek olarak belgelenir
- gerçek iş mantığı eklenmez

## T3 Code prompt

```text
TASK-006 görevini uygula.
DOC-004, DOC-005 ve ARCH-001 belgelerini oku.
apps/worker içinde BullMQ tabanlı minimal worker iskeleti oluştur.
Graceful shutdown, logging, retry standardı ve test altyapısını ekle.
Gerçek market data veya scanner job'ı yazma.
```
