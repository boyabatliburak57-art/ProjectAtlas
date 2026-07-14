# TASK-023 — Scan Run Application Service

**Bağımlılık:** TASK-020, TASK-022

Run create, idempotency, request hash, entitlement, execution plan persistence, universe snapshot, data cutoff, ownership, cancellation ve state transitions application service'lerini oluştur.

## Kabul kriterleri

Aynı key/request aynı run; farklı request conflict; invalid transition reddedilir; owner-only cancel; terminal run iptal edilemez; rule/plan versions saklanır.

```text
TASK-023 görevini uygula. Queue processor veya HTTP controller ekleme. Unit ve DB integration testlerini çalıştır.
```
