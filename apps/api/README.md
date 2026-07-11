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

## Kontroller

```bash
pnpm --filter api lint
pnpm --filter api typecheck
pnpm --filter api test
pnpm --filter api openapi:check
pnpm --filter api build
```

Readiness bu scaffold aşamasında yalnızca uygulama başlangıcını doğrular. PostgreSQL ve Redis
kontrolleri ilgili altyapı entegrasyonu görevlerinde eklenecektir.
