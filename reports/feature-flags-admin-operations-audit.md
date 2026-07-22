# TASK-077 Feature Flags and Admin Operations — PASS

Date: 2026-07-22

## Scope and database

DB-009's eight operational tables are present across the existing forward-only
operations migrations: `feature_flags`, `feature_flag_versions`,
`operational_audit_events`, `release_records`, `incidents`,
`incident_timeline_events`, `recovery_drills`, and `retention_job_runs`.
Migration `0013_feature_flag_types.sql` extends the flag type constraint and
idempotently installs environment-specific safe initial versions for the nine
required kill switches. Operational audit events and feature flag versions
remain protected by immutable database triggers. The destructive rollback
temporarily disables only the version immutability trigger while removing the
seeded runtime records, restores the trigger immediately, then restores the
previous type constraint.

Clean migration and rollback/forward integration: PASS (55/55 database
integration tests). Database schema/unit checks: PASS (21/21).

## Flag runtime

- Versioned environment configuration, owner, expiry/review date, targeting,
  percentage rollout, history, and optimistic concurrency are implemented.
- Rollout selection uses a SHA-256 stable bucket over flag key, version,
  environment, and subject. The same context therefore receives a stable
  result.
- Redis is a shared accelerator; PostgreSQL is authoritative. Cache failure
  falls back to PostgreSQL. Staging/production configuration failure applies
  the type-specific safe default, which enables kill switches.
- Admin changes invalidate the shared Redis key used by API and workers.
- Unit fixtures cover deterministic rollout, 0/100 boundaries, targeting
  mismatch, cache invalidation, PostgreSQL fallback, and unavailable-config
  safe default: PASS (5/5).
- Stale `expectedVersion` returns `FEATURE_FLAG_VERSION_CONFLICT` (HTTP 409).

## Kill-switch policy and wiring

The following gates are connected to real request or production worker
boundaries: new custom and preset scanner runs, alert evaluation, e-mail
delivery, portfolio import preview/commit, backtest creation, experiment
creation, exports, fundamentals refresh, and pattern refresh.

Create requests are evaluated before durable work is created. Worker-controlled
operations re-evaluate when a queued job begins. An already-running batch uses
the version observed at its start and reaches its normal checkpoint; completed
read results remain available. This avoids partially applying a flag change in
the middle of a deterministic batch.

The real API integration prewarms the old cached version, changes the flag,
observes cache invalidation, and verifies `POST /backtests` changes from normal
validation to HTTP 503. The production BullMQ alert processor rejects an event
at its processor boundary without writing an evaluation. Alert deduplication,
retry, and restart/catch-up remain green: PASS (9/9).

## Admin operations and security

API-009 endpoints cover feature flag CRUD/version/history, operational
overview, allowlisted queue status/pause/resume, controlled retry/cancel, data
freshness, releases, incidents, recovery status/drills, maintenance banner,
and allowlisted kill switches. Queue names and payloads are closed allowlists;
raw provider payloads, arbitrary queries, and secrets are not exposed.

Dangerous commands require a reason, exact confirmation text, and expected
version. Audit rows include actor, action, target, before/after state, reason,
request ID, correlation ID, environment, and time. Admin role plus recent
authentication is enforced by the existing deny-by-default principal resolver;
CSRF and the admin rate-limit class remain active.

Security/database integration: PASS (13/13). API database suite: PASS (18/18).
OpenAPI route validation: PASS. Admin queue allowlist/confirmation unit tests:
PASS (2/2).

## Admin web

`/admin/operations` provides platform health, queue state, data freshness,
versioned flags, kill-switch controls, maintenance banner publishing, releases,
incidents, and recovery drill status. It uses the existing Atlas high-density
operations visual system, visible focus behavior, responsive layout, and safe
authorization error states. Non-admin responses render no operational table.

Playwright Chromium, normal parallel workers: PASS (2/2, 35.8 seconds).

## Quality gates

| Gate                        | Result                |
| --------------------------- | --------------------- |
| Node / pnpm                 | 22.14.0 / 9.15.4 PASS |
| `pnpm format:check`         | PASS                  |
| `pnpm validate:adr`         | PASS, 25 ADR files    |
| cache-free lint             | PASS, 8/8 workspaces  |
| cache-free typecheck        | PASS, 8/8 workspaces  |
| root unit/application tests | PASS, 609 tests       |
| database integration        | PASS, 55/55           |
| API database/security       | PASS, 18/18           |
| alert worker integration    | PASS, 9/9             |
| Admin Playwright E2E        | PASS, 2/2             |
| production build            | PASS, 8/8 workspaces  |
| `git diff --check`          | PASS                  |

The production build was run with the required public API URL configuration;
running without it correctly failed the existing startup/configuration
fail-fast gate.

## Result

Admin authorization failures: 0. Kill-switch failures: 0. Optimistic
concurrency failures: 0. Cache/fallback failures: 0. Mandatory TASK-077 gates:
PASS.
