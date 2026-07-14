# TASK-022 — Scanner Runtime Database Migrations

**Bağımlılık:** TASK-021

DB-003 ve DB-004'e göre scan categories, saved scans/revisions/tags, preset scans/revisions, scan runs, batches, results ve events migration'larını oluştur.

## Kabul kriterleri

Clean migration, integration tests, immutable revision constraints, duplicate result/idempotency guards, soft delete behavior, idempotent seed ve rollback/forward plan.

```text
TASK-022 görevini uygula. Yalnız migration, repository schema ve integration testleri ekle; runtime business logic ekleme.
```
