# TASK-008 — Market Data Provider Abstraction

**Durum:** Hazır  
**Bağımlılık:** TASK-006, TASK-007

## Amaç

Piyasa veri sağlayıcılarını domain modelinden ayıran provider sözleşmesini ve adapter registry temelini oluşturmak.

## Kapsam

- provider capability modeli
- instrument DTO
- bar DTO
- fetch request/response
- provider error taxonomy
- provider registry
- fake provider test adapter
- schema validation
- unit tests

## Kapsam dışı

- gerçek ticari provider entegrasyonu
- scraping
- API anahtarı
- production ingest schedule

## Güvenlik

- provider response güvenilmeyen input kabul edilir
- secret contract içinde taşınmaz
- ham provider error kullanıcıya gösterilmez

## Kabul kriterleri

- fake provider ile instrument ve bar alınabilir
- unsupported timeframe hatası normalize edilir
- malformed bar reddedilir
- provider registry code ile adapter çözer
- domain modeli provider alanlarına bağımlı değildir

## T3 Code prompt

```text
TASK-008 görevini uygula.
ARCH-002, ADR-002, DB-002 ve DOC-006 belgelerini oku.
Market data provider abstraction, capabilities, normalized DTO'lar, error taxonomy ve fake provider oluştur.
Gerçek internet servisine bağlanma.
Unit testlerle malformed data ve unsupported capability senaryolarını doğrula.
```
