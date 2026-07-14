# TASK-040 — Alerts and Watchlists Milestone Audit

**Bağımlılık:** TASK-032–TASK-039

Doğrula:

- migrations
- watchlist IDOR/XSS/duplicate/reorder/snapshot
- alert lifecycle/revision/repeat policies
- afterReset/newMatch
- evaluation/trigger/delivery dedup
- retry/catch-up
- in-app/unread/quiet hours
- API/OpenAPI
- Playwright E2E
- format/ADR/lint/typecheck/test/build
- secret/dependency audit
- Scanner Runtime baseline regresyonu

Ayrıca ölç:

- 1000 aktif alarm candidate filtering
- 500 evaluation batch
- unread count
- notification pagination
- watchlist market summary

Çıktı: `reports/alerts-watchlists-milestone-audit.md`

GO koşulu: failed=0, critical deviation=0, duplicate=0, IDOR/XSS/E2E/performance PASS.
