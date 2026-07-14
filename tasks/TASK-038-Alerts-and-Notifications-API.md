# TASK-038 — Alerts and Notifications API

**Bağımlılık:** TASK-035–TASK-037

API-005'e göre:

- alert CRUD/revision/pause/resume/history/dry-run
- notification list/unread/read/mark-all-read
- notification preferences

endpointlerini oluştur.

## Kabul kriterleri

IDOR, source ownership, dry-run no-delivery, read idempotency, user-scoped mark-all-read, timezone validation ve OpenAPI testleri geçer.
