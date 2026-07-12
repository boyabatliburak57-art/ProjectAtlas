# TASK-012 — Indicator Domain Contracts

**Durum:** Tamamlandı
**Bağımlılık:** TASK-011

## Amaç

Framework bağımsız Indicator Engine sözleşmelerini oluşturmak.

## Kapsam

- IndicatorDefinition
- IndicatorInput
- scalar/multi output
- warm-up requirement
- request/result metadata
- error taxonomy
- stable parameter hash
- output validator
- unit tests.

## Kabul kriterleri

- Domain paketi NestJS import etmez.
- Sırasız/duplicate timestamp reddedilir.
- Parametre hash deterministiktir.
- NaN/Infinity output reddedilir.
- Scalar ve multi-output desteklenir.

## T3 Code prompt

```text
DOC-008, ARCH-003 ve ADR-004 belgelerini oku. TASK-012'yi uygula. Henüz formül, Redis, database veya API endpoint ekleme.
```
