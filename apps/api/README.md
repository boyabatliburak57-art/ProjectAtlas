# API

Project Atlas NestJS REST API uygulaması.

## Yerel geliştirme

Repository kökündeki `.env.example` dosyasını `.env` olarak kopyalayın veya API environment
değişkenlerini shell üzerinden sağlayın.

```bash
pnpm --filter api dev
```

Varsayılan adresler:

- Liveness: `http://localhost:3001/health/live`
- Readiness: `http://localhost:3001/health/ready`
- Swagger UI: `http://localhost:3001/api/v1/docs`
- OpenAPI JSON: `http://localhost:3001/api/v1/openapi.json`

## Scanner Runtime

Scanner Runtime API; run oluşturma/replay, owner-only status, cursor tabanlı result listesi ve
cooperative cancellation endpointlerini `/api/v1/scanner/runs` altında sunar. Run oluşturma
isteklerinde `Idempotency-Key` zorunludur. Controller iş kuralı içermez; domain application
service, PostgreSQL read adapter ve BullMQ dispatcher portlarını kullanır.

Scanner endpointleri kullanıcı kimliğini trusted authentication context üzerinden bekler.
Doğrudan istemci user ID header'ı kabul edilmez. Authentication modülü bağlanana kadar bu
context'i sağlamayan istekler `AUTHENTICATION_REQUIRED` ile reddedilir.

## Kontroller

```bash
pnpm --filter api lint
pnpm --filter api typecheck
pnpm --filter api test
pnpm --filter api openapi:check
pnpm --filter api build
```

Readiness şu anda yalnızca uygulama başlangıcını doğrular; PostgreSQL ve Redis health probe'ları
ayrı health-check geliştirmesinde eklenmelidir.
