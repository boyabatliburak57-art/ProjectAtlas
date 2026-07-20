# ARCH-017 — Observability and Incident Runtime

**Durum:** Uygulamaya hazır

```mermaid
flowchart LR
    API[API] --> OTEL[Telemetry SDK/Collector]
    W[Workers] --> OTEL
    WEB[Web] --> RUM[Safe Frontend Telemetry]
    OTEL --> LOG[Logs]
    OTEL --> MET[Metrics]
    OTEL --> TRACE[Traces]
    MET --> ALERT[Alert Rules]
    ALERT --> INC[Incident Workflow]
    LOG --> DASH[Dashboards]
    TRACE --> DASH
    MET --> DASH
```

## İlkeler

- OpenTelemetry-compatible abstraction tercih edilir.
- Business metric ve infrastructure metric ayrılır.
- Metric label cardinality sınırlıdır.
- Trace context HTTP ve queue job üzerinden taşınır.
- Log redaction merkezi ve testlidir.
- Alert rule source controlled/versioned olabilir.
- Runbook linki olmayan kritik alert kabul edilmez.
