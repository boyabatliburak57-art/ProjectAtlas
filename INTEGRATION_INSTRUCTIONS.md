# v0.5 Delta Entegrasyon Talimatı

Bu paket yalnız v0.5 ile gelen yeni dosyaları içerir. Mevcut README, ATLAS_INDEX,
CHANGELOG, ADR numaraları ve daha önce T3 Code tarafından düzeltilmiş belgeleri
ezmez.

## Kopyalama

```bash
cd ~/Documents/project-atlas
cp -R ~/Downloads/project-atlas-blueprint-v0.5-alerts-watchlists-delta/. .
```

## Mevcut indekslere eklenecek bölüm

ATLAS_INDEX.md sonuna:

```markdown
## v0.5 Alerts, Watchlists and Notifications

Belgeler:

- `docs/DOC-016-Alert-and-Notification-Requirements.md`
- `docs/DOC-017-Watchlist-Requirements.md`
- `docs/DOC-018-Notification-Center-and-Preferences.md`
- `architecture/ARCH-006-Alert-Evaluation-Runtime.md`
- `architecture/ARCH-007-Notification-Delivery-Runtime.md`
- `database/DB-005-Alerts-Watchlists-Notifications.md`
- `api/API-005-Alerts-Watchlists-Notifications.md`
- `guides/ALERT_NOTIFICATION_TEST_MATRIX.md`

Görev sırası: TASK-031 → TASK-040.

TASK-040 sonucu GO olmadan sonraki pakete geçilmez.
```

CHANGELOG.md üstüne:

```markdown
## 0.5.0-alerts-watchlists — 2026-07-14

### Eklendi

- DOC-016–DOC-018
- ARCH-006–ARCH-007
- DB-005
- API-005
- Alert/Notification Test Matrix
- TASK-031–TASK-040
```

## Doğrulama

```bash
pnpm format:check
pnpm validate:adr
git status
git diff --check
```
