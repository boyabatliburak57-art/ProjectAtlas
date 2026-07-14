# TASK-032 — Alerts, Watchlists and Notifications Database Migrations

**Bağımlılık:** TASK-031

DB-005'e göre migration oluştur:

- watchlists/items/tags
- alerts/revisions/evaluations/states/triggers
- notifications/preferences/deliveries/outbox

## Kabul kriterleri

- clean migration
- foreign keys ve unique constraints
- evaluation/trigger/delivery dedup
- ownership indeksleri
- forward/rollback stratejisi
- integration tests

## T3 Code prompt

```text
TASK-032 görevini uygula.
DB-005'i oku. Yalnız migration ve integration testlerini oluştur.
Henüz domain service, worker veya endpoint ekleme.
```
