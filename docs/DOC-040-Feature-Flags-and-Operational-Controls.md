# DOC-040 — Feature Flags and Operational Controls

**Sürüm:** 1.0  
**Durum:** Uygulamaya hazır

## 1. Amaç

Riskli özellikleri kontrollü yayınlamak, iş akışlarını güvenli biçimde durdurmak ve operasyon ekibine sınırlı yönetim kontrolleri sağlamak.

## 2. Flag türleri

- release flag,
- experiment flag,
- operational kill switch,
- entitlement flag,
- maintenance flag.

## 3. Flag özellikleri

- key,
- description,
- type,
- enabled state,
- environment,
- targeting rules,
- rollout percentage,
- owner,
- expiry/review date,
- version,
- audit history.

## 4. Evaluation

- deterministic,
- user/resource context sınırlı,
- default güvenli,
- cache invalidation,
- config unavailable fallback,
- no secret targeting values.

Percentage rollout stable hash kullanır.

## 5. Kill switches

En az:

- new scanner runs,
- alert evaluation,
- e-mail delivery,
- portfolio imports,
- backtest creation,
- experiment creation,
- exports,
- fundamentals/pattern refresh.

Kill switch mevcut tamamlanmış verilere read erişimini gereksiz yere kapatmamalıdır.

## 6. Admin operations

Admin-only:

- flag list/update,
- queue pause/resume,
- job retry/cancel, kontrollü,
- incident maintenance banner,
- release status,
- data freshness summary,
- failed job summary,
- backup/restore status summary,
- user/account disable, policy varsa.

## 7. Dangerous actions

- explicit confirmation,
- reason,
- actor,
- target,
- before/after,
- request ID,
- timestamp,
- audit log.

Bulk destructive action ilk sürümde kapsam dışı veya güçlü confirmation gerektirir.

## 8. Güvenlik

- separate admin scope,
- IDOR/RBAC,
- CSRF,
- rate limit,
- no raw secret,
- no arbitrary DB query,
- no arbitrary queue payload,
- audit tamlığı.

## 9. Flag lifecycle

- created,
- active,
- fully rolled out,
- deprecated,
- removed.

Expired flag CI veya runtime warning üretir.

## 10. Kabul kriterleri

- Deterministic rollout testlidir.
- Kill switches gerçek production yollarına bağlıdır.
- Admin RBAC/IDOR geçer.
- Dangerous actions auditlidir.
- Flag unavailable fallback testlidir.
- Stale/expired flag raporu üretilebilir.
