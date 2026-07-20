# TASK-077 — Feature Flags and Admin Operations

**Bağımlılık:** TASK-072, TASK-074, TASK-075

## Kapsam

- DB-009 migrations
- flag domain/versioning
- deterministic percentage rollout
- targeting validation
- cache/fallback
- kill switches
- admin API
- operations overview
- queue pause/resume
- controlled job retry/cancel
- maintenance banner
- release/incident/recovery summaries
- operational audit
- admin web UI, minimal

## Kabul

- production paths respect kill switches
- rollout deterministic
- fallback safe
- admin RBAC/IDOR pass
- dangerous action confirmation
- audit complete
- no arbitrary queue/DB operation
- expired flag report
