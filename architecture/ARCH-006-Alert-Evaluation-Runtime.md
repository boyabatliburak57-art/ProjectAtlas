# ARCH-006 — Alert Evaluation Runtime

**Durum:** Uygulamaya hazır

```mermaid
flowchart LR
    MD[Market Data Updated] --> D[Evaluation Dispatcher]
    SR[Scan Run Completed] --> D
    D --> Q[Alert Queue]
    Q --> W[Evaluation Worker]
    W --> A[(Alert Repository)]
    W --> I[Indicator Engine]
    W --> S[Scanner Runtime]
    W --> ST[(Alert State)]
    W --> T[(Alert Trigger)]
    T --> NQ[Notification Queue]
```

## Temel kararlar

- Dispatcher ilgili alarm adaylarını instrument/timeframe/source indeksleriyle seçer.
- Evaluation identity: `alertId + revision + sourceEventId + cutoff`.
- State için PostgreSQL kaynaktır; Redis yalnız optimizasyon olabilir.
- Saved scan alarmı ortak Scanner Runtime kullanır.
- Worker kesintisi sonrası catch-up yapılır; notification flood engellenir.
- Deterministic invalid alarm retry edilmez; geçici altyapı hatası retry edilir.
