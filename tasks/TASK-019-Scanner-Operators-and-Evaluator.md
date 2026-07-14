# TASK-019 — Scanner Operators and Evaluator

**Bağımlılık:** TASK-018

## Operatörler

EQ, NE, GT, GTE, LT, LTE, BETWEEN, OUTSIDE, CROSSES_ABOVE, CROSSES_BELOW, IS_TRUE, IS_FALSE, WITHIN_PERCENT_OF.

## Kabul kriterleri

- Cross yalnız transition barında true.
- Previous value eksikse notEvaluable.
- AND/OR truth table testli.
- Node result tree açıklama için üretilir.
- Zero denominator güvenli ele alınır.

## T3 Code prompt

```text
TASK-019'u uygula. ADR-005 ve DOC-009'u oku. Pure operator registry/evaluator oluştur; veri erişimi, queue ve database kodu ekleme.
```
