# TASK-020 — Scanner Execution Planner

**Bağımlılık:** TASK-016, TASK-018, TASK-019

## Kapsam

- universe request
- unique indicator extraction
- data requirement
- warm-up aggregation
- timeframe set
- operator history requirement
- complexity score
- sync/async decision
- entitlement port
- plan serialization
- tests.

## Kabul kriterleri

- Duplicate indicator request tekilleştirilir.
- Cross için previous bar ihtiyacı eklenir.
- Aynı AST aynı planı üretir.
- Complexity limit uygulanır.
- Entitlement violation ayrı hatadır.

## T3 Code prompt

```text
TASK-020'yi uygula. DOC-009 ve ARCH-004'ü oku. Deterministic planner oluştur; henüz scan run execution/persistence ekleme.
```
