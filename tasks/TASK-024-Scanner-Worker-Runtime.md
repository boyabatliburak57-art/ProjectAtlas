# TASK-024 — Scanner Worker Runtime

**Bağımlılık:** TASK-016, TASK-019, TASK-020, TASK-023

BullMQ üzerinde execution plan'ı batch'lerle çalıştır; market data load, indicator batch, evaluator, explanation, result upsert, progress, cancellation, retry, timeout ve telemetry ekle.

## Kabul kriterleri

Queue-to-result E2E; retry duplicate üretmez; progress monoton; cancellation cooperative; Redis kaybı kalıcı sonucu bozmaz; terminal state doğru; correlation IDs loglanır.

```text
TASK-024 görevini uygula. Fake fixture ve gerçek test PostgreSQL/Redis ile integration test ekle. Gerçek piyasa sağlayıcısı ekleme.
```
