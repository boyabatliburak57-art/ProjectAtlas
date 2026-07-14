# DB-005 — Alerts, Watchlists and Notifications

**Sürüm:** 1.0  
**Durum:** Uygulamaya hazır

## Watchlist tabloları

- `watchlists`
- `watchlist_items`
- `watchlist_item_tags`

Unique:

```text
watchlist_id + instrument_id
```

## Alert tabloları

- `alerts`
- `alert_revisions`
- `alert_evaluations`
- `alert_states`
- `alert_triggers`

Evaluation unique:

```text
alert_id + alert_revision + source_event_id + data_cutoff_at
```

Trigger unique:

```text
deduplication_key
```

## Notification tabloları

- `notifications`
- `notification_preferences`
- `notification_deliveries`
- `notification_outbox`

Delivery unique:

```text
channel + idempotency_key
```

## Zorunlu alan ilkeleri

- tüm zamanlar `timestamptz`
- revisions immutable
- soft delete timestamp
- ownership foreign key/index
- notification unread sorgusu için `(user_id, read_at, occurred_at desc)`
- outbox retry için `(status, available_at)`
