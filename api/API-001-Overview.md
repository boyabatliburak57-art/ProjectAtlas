# API-001 — API Genel İlkeleri

## 1. Stil

- REST/JSON
- Base path: `/api/v1`
- OpenAPI zorunlu
- ISO 8601 zaman formatı
- UTC timestamp
- camelCase JSON alanları
- cursor tabanlı sayfalama tercih edilir

## 2. Standart başarılı yanıt

```json
{
  "data": [],
  "meta": {
    "nextCursor": null,
    "requestId": "req_123"
  }
}
```

## 3. Standart hata yanıtı

```json
{
  "error": {
    "code": "SCAN_RULE_INVALID",
    "message": "Tarama kuralı geçersiz.",
    "details": [
      {
        "path": "root.children[1]",
        "reason": "Unsupported operator"
      }
    ],
    "requestId": "req_123"
  }
}
```

## 4. İlk endpoint grupları

### Health

- `GET /health/live`
- `GET /health/ready`

Health probe'ları altyapı tarafından sürümden bağımsız tüketilebilmesi için `/api/v1`
prefix'inin dışındadır. Swagger UI `/api/v1/docs`, OpenAPI JSON ise
`/api/v1/openapi.json` üzerinden sunulur.

### Auth

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET /api/v1/me`

### Instruments

- `GET /api/v1/instruments`
- `GET /api/v1/instruments/{symbol}`
- `GET /api/v1/instruments/{symbol}/bars`
- `GET /api/v1/instruments/{symbol}/fundamentals`

### Scans

- `POST /api/v1/scans/validate`
- `POST /api/v1/scans/run`
- `GET /api/v1/scans/runs/{runId}`
- `GET /api/v1/scans/runs/{runId}/results`
- `GET /api/v1/saved-scans`
- `POST /api/v1/saved-scans`
- `PATCH /api/v1/saved-scans/{id}`
- `DELETE /api/v1/saved-scans/{id}`

### Presets

- `GET /api/v1/preset-scan-categories`
- `GET /api/v1/preset-scans`
- `GET /api/v1/preset-scans/{id}`

### Alerts

- `GET /api/v1/alerts`
- `POST /api/v1/alerts`
- `PATCH /api/v1/alerts/{id}`
- `DELETE /api/v1/alerts/{id}`
- `GET /api/v1/alerts/{id}/history`

### Watchlists

- `GET /api/v1/watchlists`
- `POST /api/v1/watchlists`
- `POST /api/v1/watchlists/{id}/items`
- `DELETE /api/v1/watchlists/{id}/items/{instrumentId}`

## 5. Idempotency

Ödeme, dış bildirim, ağır tarama ve dışa aktarma başlatma işlemlerinde `Idempotency-Key` desteklenmelidir.

## 6. Rate limit

Limitler kullanıcı, IP, endpoint sınıfı ve plan bazında uygulanabilir. Limit aşıldığında `429 Too Many Requests` döner.

## 7. Sürümleme

Kırıcı değişiklikler yeni major API sürümü gerektirir. Tarama AST ve indikatör tanımı ayrıca şema sürümü taşır.

## 8. Request ve correlation id

- İstemci güvenli formatta `x-request-id` ve `x-correlation-id` gönderebilir.
- Eksik veya geçersiz değerler sunucu tarafından yeniden üretilir.
- Her iki değer response header'larında döndürülür.
- Standart hata yanıtı `requestId` taşır; production yanıtı stack trace içermez.
