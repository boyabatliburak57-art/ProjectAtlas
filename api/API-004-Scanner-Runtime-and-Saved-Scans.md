# API-004 — Scanner Runtime and Saved Scans API

**Sürüm:** 1.0  
**Base:** `/api/v1`

## Run oluşturma

`POST /scanner/runs`

`Idempotency-Key` zorunlu veya sunucu politikasınca zorunlu tutulur.

TASK-025 uygulamasında zorunludur. Yeni run `201`, aynı normalize istek replay'i `200`
yanıtında `meta.replayed` alanıyla ayrılır. Oluşturulan run deterministik BullMQ job kimliğiyle
scanner queue'ya gönderilir.

- 201: yeni run
- 200: idempotent replay
- 409: key farklı request ile yeniden kullanıldı
- 422: invalid rule
- 429: quota/complexity.

## Run status

`GET /scanner/runs/{runId}` — ownership zorunlu.

## Results

`GET /scanner/runs/{runId}/results`

Cursor pagination; status, sort, direction ve includeExplanation parametreleri. Detaylı explanation varsayılan olarak lazy yüklenebilir.

- `limit`: 1–100, varsayılan 25
- `status`: `matched` veya `notEvaluable`
- `sort`: `createdAt` veya `rank`
- `direction`: `asc` veya `desc`
- `includeExplanation`: varsayılan `false`
- `cursor`: opaque base64url cursor; geçersiz cursor `SCAN_RESULTS_CURSOR_INVALID`

## Cancel

`POST /scanner/runs/{runId}/cancel`

İdempotent. Terminal run için `SCAN_RUN_NOT_CANCELLABLE`.

Run, result ve cancel endpointleri authenticated user kimliğini yalnızca güvenilir backend auth
context'inden alır. İstemci tarafından gönderilen user ID ownership kanıtı olarak kullanılmaz.

## Progress

İlk sürüm polling. Gerekli görülürse SSE eklenir; WebSocket zorunlu değildir.

## Saved scans

- GET/POST `/saved-scans`
- GET/PATCH/DELETE `/saved-scans/{id}`
- POST `/saved-scans/{id}/clone`
- POST `/saved-scans/{id}/restore`
- GET `/saved-scans/{id}/revisions`

PATCH `expectedRevision` taşır; conflict 409.

## Presets

- GET `/preset-scan-categories`
- GET `/preset-scans`
- GET `/preset-scans/{code}`
- POST `/preset-scans/{code}/runs`

Admin write/publish ayrı permission grubudur.

## Hata kodları

- IDEMPOTENCY_KEY_REQUIRED
- IDEMPOTENCY_KEY_REUSED
- SCAN_RUN_NOT_FOUND
- SCAN_RUN_ACCESS_DENIED
- SCAN_RUN_NOT_CANCELLABLE
- SCAN_RUN_EXPIRED
- SAVED_SCAN_NOT_FOUND
- SAVED_SCAN_ACCESS_DENIED
- SAVED_SCAN_CONFLICT
- SAVED_SCAN_DELETED
- PRESET_SCAN_NOT_FOUND
- PRESET_SCAN_NOT_PUBLISHED

## Güvenlik testleri

Başka kullanıcı run status/result/cancel ve saved scan erişimi reddedilir. Admin preset write permission ile sınırlandırılır.
