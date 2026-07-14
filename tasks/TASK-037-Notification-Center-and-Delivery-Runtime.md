# TASK-037 — Notification Center and Delivery Runtime

**Bağımlılık:** TASK-036

ARCH-007'ye göre oluştur:

- notification orchestrator
- preference resolver
- quiet hours
- in-app writer
- delivery outbox
- e-mail adapter contract
- fake e-mail adapter
- retry taxonomy
- idempotency

Gerçek production e-mail provider ekleme.

## Kabul kriterleri

Trigger→in-app, unread veri yolu, e-mail suppression, quiet hours defer, duplicate prevention ve fake adapter retry testleri geçer.
