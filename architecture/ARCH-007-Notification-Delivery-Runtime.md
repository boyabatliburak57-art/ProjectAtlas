# ARCH-007 — Notification Delivery Runtime

**Durum:** Uygulamaya hazır

```mermaid
flowchart LR
    T[Alert Trigger] --> O[Orchestrator]
    O --> P[Preference Resolver]
    O --> I[In-App Writer]
    O --> X[(Delivery Outbox)]
    X --> Q[Delivery Queue]
    Q --> W[Delivery Worker]
    W --> E[Email Adapter]
    W --> H[(Delivery History)]
```

## İlkeler

- In-app notification ve dış delivery ayrıdır.
- Dış kanallar DB outbox üzerinden güvenilir biçimde gönderilir.
- Queue at-least-once olabilir; delivery idempotency duplicate'i engeller.
- Template code/version ve locale saklanır.
- Quiet hours delivery zamanını erteler.
- Provider secret ve ham yanıt loglanmaz.
