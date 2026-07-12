# TASK-018 — Scanner AST and Validation

**Durum:** Tamamlandı
**Bağımlılık:** TASK-016

## Kapsam

- nodeId
- group/condition
- operand types
- universe filter
- operator enum
- depth/node limits
- compatibility validation
- stable normalization
- error paths
- tests.

## Güvenlik

Eval, SQL, serbest function name ve unknown field yasaktır.

## Kabul kriterleri

- Boş group ve duplicate nodeId reddedilir.
- Derinlik/node limit testlidir.
- Uyumsuz operand reddedilir.
- Aynı anlamlı AST aynı normalize sonucu üretir.

## T3 Code prompt

```text
TASK-018'i uygula. DOC-009, ARCH-004 ve ADR-003'ü oku. Sadece AST, validation ve normalization geliştir; execution/persistence ekleme.
```
