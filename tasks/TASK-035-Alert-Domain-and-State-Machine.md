# TASK-035 — Alert Domain and State Machine

**Bağımlılık:** TASK-032, TASK-033

Framework bağımsız olarak oluştur:

- source types
- immutable revision
- lifecycle transitions
- repeat policies
- evaluation identity
- trigger dedup key
- afterReset state
- newMatch set comparison

## Kabul kriterleri

Invalid transition, once, oncePerBar, afterReset, newMatch, same-event dedup ve revision değişimi testlidir.
