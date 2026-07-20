# API-009 — Operations, Admin and Health API

**Sürüm:** 1.0  
**Durum:** Uygulamaya hazır

## Public/safe health

- `GET /health/live`
- `GET /health/ready`
- `GET /health/startup`, gerekiyorsa

Secret ve internal topology dönmez.

## Admin base

```text
/api/v1/admin
```

Admin scope zorunludur.

## Feature flags

- `GET /admin/feature-flags`
- `GET /admin/feature-flags/{key}`
- `POST /admin/feature-flags`
- `POST /admin/feature-flags/{key}/versions`
- `GET /admin/feature-flags/{key}/history`

## Operations

- `GET /admin/operations/overview`
- `GET /admin/operations/queues`
- `POST /admin/operations/queues/{queue}/pause`
- `POST /admin/operations/queues/{queue}/resume`
- `POST /admin/operations/jobs/{jobId}/retry`, allowlist/policy
- `POST /admin/operations/jobs/{jobId}/cancel`, allowlist/policy
- `GET /admin/operations/data-freshness`
- `GET /admin/operations/releases`
- `GET /admin/operations/incidents`

## Maintenance

- `POST /admin/maintenance/banner`
- `DELETE /admin/maintenance/banner`
- `POST /admin/maintenance/kill-switches/{key}/enable`
- `POST /admin/maintenance/kill-switches/{key}/disable`

## Recovery summary

- `GET /admin/recovery/status`
- `GET /admin/recovery/drills`

Gerçek restore başlatma endpoint'i ilk sürümde eklenmeyebilir; eklenirse güçlü ayrı confirmation ve scope gerekir.

## Dangerous action request

```json
{
  "reason": "Incident mitigation",
  "expectedVersion": 12,
  "confirmation": "PAUSE_BACKTEST_QUEUE"
}
```

## Güvenlik

- admin RBAC,
- CSRF/CORS,
- rate limit,
- audit,
- no arbitrary queue name/job payload,
- no raw DB query,
- no secret/provider payload,
- IDOR/resource allowlist.
