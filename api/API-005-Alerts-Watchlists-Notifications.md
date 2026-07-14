# API-005 — Alerts, Watchlists and Notifications API

**Base:** `/api/v1`

## Watchlists

- `GET /watchlists`
- `POST /watchlists`
- `GET/PATCH/DELETE /watchlists/{id}`
- `POST /watchlists/{id}/restore`
- `POST /watchlists/{id}/items`
- `PATCH/DELETE /watchlists/{id}/items/{itemId}`
- `POST /watchlists/{id}/reorder`
- `GET /watchlists/{id}/market-summary`

## Alerts

- `GET/POST /alerts`
- `GET/PATCH/DELETE /alerts/{id}`
- `POST /alerts/{id}/pause`
- `POST /alerts/{id}/resume`
- `GET /alerts/{id}/revisions`
- `GET /alerts/{id}/evaluations`
- `GET /alerts/{id}/triggers`
- `POST /alerts/{id}/test` — dry-run

## Notifications

- `GET /notifications`
- `GET /notifications/unread-count`
- `POST /notifications/{id}/read`
- `POST /notifications/{id}/unread`
- `POST /notifications/mark-all-read`
- `GET/PUT /notification-preferences`

## Hata kodları

- `WATCHLIST_NOT_FOUND`
- `WATCHLIST_ACCESS_DENIED`
- `WATCHLIST_ITEM_EXISTS`
- `WATCHLIST_LIMIT_REACHED`
- `ALERT_NOT_FOUND`
- `ALERT_ACCESS_DENIED`
- `ALERT_SOURCE_INVALID`
- `ALERT_LIMIT_REACHED`
- `ALERT_REVISION_CONFLICT`
- `NOTIFICATION_NOT_FOUND`
- `NOTIFICATION_ACCESS_DENIED`
- `NOTIFICATION_PREFERENCE_INVALID`

## Güvenlik

- tüm kaynaklarda ownership
- note XSS testi
- saved scan alarmında source ownership
- dry-run dış bildirim göndermez
- metadata provider raw payload içermez
