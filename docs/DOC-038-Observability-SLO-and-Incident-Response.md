# DOC-038 — Observability, SLO and Incident Response

**Sürüm:** 1.0  
**Durum:** Uygulamaya hazır

## 1. Amaç

API, worker, veri tazeliği ve kullanıcı iş akışlarının sağlık durumunu ölçülebilir ve müdahale edilebilir hale getirir.

## 2. Telemetry

- structured logs,
- metrics,
- distributed traces,
- correlation/request IDs,
- job/run IDs,
- release/version labels,
- environment labels.

High-cardinality kullanıcı verisi metric label yapılmaz.

## 3. Başlangıç SLI/SLO seti

### API availability

Önerilen başlangıç hedefi:

```text
rolling 30 days ≥ 99.9%
```

Planlı bakım policy ile ayrılabilir.

### API latency

Endpoint sınıfına göre:

- read API p95,
- write API p95,
- heavy job create p95,
- result pagination p95.

Mevcut milestone threshold'ları alt SLI olarak korunur.

### Worker reliability

- successful terminal rate,
- retry rate,
- failed job rate,
- queue lag,
- stalled jobs,
- cancellation latency.

### Data freshness

- market data lag,
- fundamentals freshness,
- snapshot generation lag,
- stale response rate.

### User journey

- scanner completion,
- alert delivery,
- portfolio recalculation,
- backtest completion.

## 4. Error budget

SLO ihlalinde:

- release freeze veya risk review,
- reliability work priority,
- exception approval

policy'si uygulanır.

## 5. Logs

Loglar:

- JSON structured,
- level,
- event code,
- request/job/run ID,
- safe actor/resource IDs,
- duration,
- outcome,
- error category

taşır.

Yasak:

- password/token,
- cookie,
- connection string,
- raw provider payload,
- full uploaded file,
- gereksiz finansal kullanıcı notları.

## 6. Tracing

Kritik trace akışları:

- HTTP → DB/cache,
- scan create → worker → results,
- alert event → notification,
- backtest create → worker → persistence,
- experiment → child runs,
- import/export.

Trace sampling policy versioned ve maliyet kontrollüdür.

## 7. Dashboard

En az:

- platform overview,
- API latency/error,
- queue/worker,
- market data freshness,
- scanner/alerts,
- portfolio/risk,
- backtest/experiments,
- DB/Redis,
- deployment/release.

## 8. Alerts

Alert:

- actionable,
- severity,
- owner,
- runbook link,
- dedup/grouping,
- cooldown,
- recovery notification

taşır.

Alert fatigue önlenir.

## 9. Incident

Severity:

- SEV-1 critical outage/data/security,
- SEV-2 major degradation,
- SEV-3 limited degradation,
- SEV-4 low impact.

Incident kaydı:

- started/detected/acknowledged/resolved,
- commander,
- impact,
- timeline,
- mitigations,
- root cause,
- follow-ups.

## 10. Synthetic checks

- login/session,
- market overview,
- scanner create/result,
- portfolio valuation,
- backtest create/status,
- health endpoints.

Staging ve production güvenli synthetic kullanıcıları kullanır.

## 11. Kabul kriterleri

- Dashboard ve alerts provision edilir.
- Kritik trace zincirleri görülebilir.
- Secret redaction testlidir.
- SLO ve error budget raporu üretilebilir.
- En az bir incident game-day yapılır.
