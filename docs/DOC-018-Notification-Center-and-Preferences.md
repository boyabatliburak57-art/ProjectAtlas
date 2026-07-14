# DOC-018 — Notification Center and Preferences

**Sürüm:** 1.0  
**Durum:** Uygulamaya hazır

## 1. Notification Center

- liste
- unread count
- read/unread
- mark all read
- tür/tarih filtresi
- ilgili symbol/scan/alert bağlantısı
- cursor pagination
- retention

## 2. Türler

- `alertTriggered`
- `alertDeliveryFailed`
- `dataStaleWarning`
- `scanCompleted`
- `systemAnnouncement`
- güvenlik bildirimi, ayrı policy

## 3. Tercihler

- timezone
- e-mail alarms
- daily digest
- quiet hours
- scan completion notification

Güvenlik bildirimleri finansal alarm tercihlerinden ayrıdır.

## 4. E-mail

Şablon:

- alarm adı
- sembol
- koşul özeti
- veri zamanı
- stale/gecikme
- uygulama bağlantısı
- yatırım tavsiyesi uyarısı

Ham AST kullanıcı e-postasında gösterilmez.

## 5. Delivery durumları

- pending
- processing
- delivered
- failed
- suppressed
- cancelled

## 6. Retry

Geçici timeout/5xx/rate limit retry edilir. Invalid recipient ve permanent bounce retry edilmez.

## 7. Kabul kriterleri

- Unread count doğrudur.
- Read işlemi idempotenttir.
- Mark-all-read user scoped'dur.
- Quiet hours/defer testlidir.
- Delivery idempotency testlidir.
- Template veri zamanı ve uyarı içerir.
