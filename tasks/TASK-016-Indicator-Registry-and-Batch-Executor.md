# TASK-016 — Indicator Registry and Batch Executor

**Bağımlılık:** TASK-014, TASK-015

## Kapsam

- registry
- duplicate definition guard
- catalog DTO
- request deduplication
- warm-up aggregation
- per-request result
- memory cache adapter
- metrics port
- tests.

## Kabul kriterleri

- Aynı request batch içinde bir kez hesaplanır.
- Code/version lookup çalışır.
- Tek indikatör hatası tüm batch'i düşürmez.
- Catalog parameter/output metadata üretir.

## T3 Code prompt

```text
TASK-016'yı uygula. ARCH-003 ve DOC-008'i oku. Memory cache adapter kullan; Scanner veya production Redis kodu ekleme.
```
