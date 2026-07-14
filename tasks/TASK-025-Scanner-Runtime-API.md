# TASK-025 — Scanner Runtime API

**Bağımlılık:** TASK-023, TASK-024

Run create/status/results/cancel endpointlerini API-004'e göre oluştur. Idempotency, pagination, ownership, error mapping, OpenAPI ve API testleri ekle.

## Kabul kriterleri

IDOR testleri, replay/conflict, pagination, cancel idempotency, terminal response, OpenAPI ve production-safe errors.

```text
TASK-025 görevini uygula. Controller içinde business logic yazma; application service kullan.
```
