# Alert, Watchlist and Notification Test Matrix

## Watchlist

- CRUD, soft delete/restore
- duplicate instrument
- reorder
- note XSS
- tag normalization
- ownership/IDOR
- quota
- universe snapshot
- deleted list rejection

## Alert

- lifecycle
- immutable revision
- once/oncePerBar/oncePerDay
- afterReset
- everyNewMatch
- duplicate event/cutoff
- notEvaluable
- catch-up
- retry taxonomy

## Notification

- in-app creation
- unread/read/mark-all-read
- ownership
- quiet hours
- e-mail disabled
- temporary retry/permanent failure
- delivery idempotency
- template version

## E2E

- watchlist oluştur/symbol ekle
- fiyat alarmı oluştur
- fixture event ile tetikle
- notification unread/read
- saved scan newMatch alarmı
- pause/resume
