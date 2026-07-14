# TASK-036 — Alert Evaluation Worker

**Bağımlılık:** TASK-035

ARCH-006'ya göre BullMQ worker oluştur:

- market data/scan completion events
- candidate lookup
- idempotent evaluation
- Scanner/Indicator integration
- state persistence
- trigger creation
- retry/catch-up
- metrics/logging

## Kabul kriterleri

Duplicate event duplicate trigger üretmez; afterReset, newMatch, notEvaluable, retry ve worker catch-up integration testleri geçer.
