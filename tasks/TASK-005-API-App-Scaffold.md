# TASK-005 — API Application Scaffold

**Durum:** Tamamlandı
**Bağımlılık:** TASK-002, TASK-003

## Amaç

`apps/api` altında NestJS tabanlı API iskeletini oluşturmak.

## Kapsam

- global config
- environment validation
- `/health/live`
- `/health/ready`
- global error filter
- request/correlation id
- structured logger
- OpenAPI temel yapı
- versioned `/api/v1`
- graceful shutdown
- test altyapısı

## Kapsam dışı

- auth
- instrument endpointleri
- database domain modeli
- market data provider

## Kabul kriterleri

- API local çalışır
- liveness ve readiness ayrıdır
- invalid env ile fail-fast
- OpenAPI dokümanı oluşur
- production response stack trace içermez
- unit/integration testleri geçer

## T3 Code prompt

```text
TASK-005 görevini uygula.
Önce DOC-004, DOC-005, DOC-006 ve ARCH-001 belgelerini oku.
apps/api içinde minimal NestJS API iskeleti oluştur.
Health endpointleri, environment validation, structured logging, correlation id ve global hata standardını ekle.
Henüz business endpoint geliştirme.
Testleri ve OpenAPI doğrulamasını çalıştır.
```

## Tamamlanma notu

- **Tarih:** 2026-07-11
- **Durum:** Tamamlandı
- **Değişiklik:** NestJS, health probe'ları, environment validation, JSON logging,
  correlation id, global error filter, OpenAPI ve test altyapısı eklendi.
- **Migration:** Yok.
- **Bilinen sınırlama:** Readiness henüz PostgreSQL ve Redis bağlantısını kontrol etmiyor.
- **Sonraki görev:** TASK-006
