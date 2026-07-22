Decision: NO-GO

# Production Readiness Milestone Re-Audit

Date: 2026-07-22  
Audited revision: `93f9bab4bd43ce0695442973f1c808ba1c9f2fdf` plus the uncommitted TASK-079/TASK-080R/TASK-080S working tree  
Scope: TASK-073 through TASK-080S and the five prior milestone baselines

## 1. Executive decision

The repository-level legal-hold and High production dependency blockers are remediated. Production
readiness remains **NO-GO** because no real staging identity, deployment credentials, test users,
load/chaos authorization, rollback digest, or DAST target was supplied. Registry authentication alone is
available but insufficient. Consequently the current source was
not pushed as an immutable RC, deployed to staging, exercised by mandatory load/chaos scenarios, rolled
back, or scanned by DAST. Local container evidence is explicitly not counted as staging evidence.

Failed mandatory gates: 5 finding groups (PRD-001, PRD-002, PRD-003, PRD-006, PRD-007). Critical
deviations: real staging evidence absent. Production launch and a v1.0 RC must not proceed.

## 2. Initial NO-GO findings

| ID      | Finding                                            | Re-audit state |
| ------- | -------------------------------------------------- | -------------- |
| PRD-001 | LOAD-OPS-001–003 real staging evidence absent      | OPEN           |
| PRD-002 | CHAOS-OPS-001–006 real staging evidence absent     | OPEN           |
| PRD-003 | Immutable staging RC and rollback rehearsal absent | OPEN           |
| PRD-004 | Legal-hold retention integration failure           | CLOSED         |
| PRD-005 | High production dependency advisory                | CLOSED         |
| PRD-006 | Current RC SBOM/container scan/provenance absent   | OPEN           |
| PRD-007 | Current staging DAST absent                        | OPEN           |

## 3. Remediation changes

- Legal-hold evaluation now supports category, generic resource, user, run and export scopes; active-time
  windows and expiry are evaluated against the retention run time.
- Candidate deletion rechecks the hold within the delete transaction, preserving a concurrent hold update.
- Retention dry-run counts eligible candidates but performs no deletion; replay keys remain idempotent and
  audit metadata includes dry-run and hold-skipped counts.
- Legal-hold create/release operations require an operations administrator, a reason, and audit records.
- Next.js was upgraded from `16.2.10` to `16.2.11`; `sharp` is pinned by pnpm override to compatible safe
  version `0.35.3`; the lockfile was regenerated.

No test was skipped, changed to fixme/only, or weakened. No advisory was ignored and no threshold or load
fixture was reduced.

## 4. Staging preflight

The TASK-080S preflight printed presence/status only and never secret values.

| Access                                     | Status      |
| ------------------------------------------ | ----------- |
| `STAGING_BASE_URL` / `STAGING_API_URL`     | unavailable |
| `STAGING_WEB_URL`                          | unavailable |
| Container registry authentication          | available   |
| Staging deployment / `KUBE_CONFIG_STAGING` | unavailable |
| Kubernetes current context                 | unavailable |
| Staging PostgreSQL                         | unavailable |
| Staging Redis                              | unavailable |
| Staging object storage                     | unavailable |
| DNS/TLS target validation                  | unavailable |
| Synthetic user                             | unavailable |
| Synthetic admin                            | unavailable |
| DAST authorization                         | unavailable |
| Load authorization and fixture             | unavailable |
| Chaos authorization and adapter            | unavailable |
| Previous known-good image digest           | unavailable |
| Migration dry-run database                 | unavailable |
| Alert delivery endpoint                    | unavailable |
| Rollback workflow definition               | available   |
| Clean current-commit source                | invalid     |

Registry access and a workflow definition do not authorize or enable a staging deployment. DNS/TLS,
backup/PITR, queue/worker health and rollback execution cannot be verified without the unavailable target and
deployment context. Docker Desktop remains a local build environment only.

## 5. Legal-hold retention

The original failure was the test `retention excludes legal holds, supports replay-safe execution keys and
records audit evidence`; its fixture used database `now()` while the service evaluated a fixed application
time, causing an active hold to be treated as not yet started and yielding `expected 2 to be 1`.

Results after remediation and the TASK-080S regression rerun:

- Focused legal-hold/recovery integration: **12/12 PASS**.
- Full database integration: **63/63 PASS** (initial audit: 54/55).
- Active, absent, expired and released holds; batch boundary; multiple scopes; dry-run; replay/idempotency;
  administrator authorization; audit; concurrent activation; and retention resume are covered.
- An initial worker integration run reused dirty Redis queue state and produced 3/68 failures. After `FLUSHALL`
  on the isolated test Redis, the unchanged suite passed **68/68**, identifying fixture isolation rather than a
  product-code regression.

## 6. Dependency audit

Clean frozen installation completed with Node `22.14.0` and pnpm `9.15.4`. Native sharp smoke loaded
`sharp 0.35.3` / libvips `8.18.3` and produced a PNG. `pnpm audit --prod --audit-level high` reports no known
vulnerabilities: Critical **0**, High **0**. The all-dependency audit has one Moderate finding, which is not a
GO-blocking production High/Critical result. No exception was created or required.

## 7. RC image and immutable digest

No registry-backed RC exists and no image digest was deployed to staging. A local packaging candidate named
`0.9.0-rc.801-local` was built for web, API, worker and migration. Its local Docker image IDs are not a
registry manifest digest and are not release evidence. The source tree also contains uncommitted TASK-079
and TASK-080R changes, so revision `93f9bab...` alone does not identify the built source.

The Dockerfile base is pinned to
`node:22.14.0-alpine3.21@sha256:9bef0ef1e268f60627da9ba7d7605e8831d5b56ad07487d24d1aa386336d1944`,
uses non-root `node`, production-only dependency installation and OCI labels.

## 8. SBOM, container scan and provenance

Local package validation produced:

- `reports/security/task-080r-local-api.spdx.json` (353 indexed packages)
- `reports/security/task-080r-local-api-container.sarif` (Critical/High 0)
- `reports/security/task-080r-local-worker-container.sarif` (Critical/High 0)
- Docker BuildKit local attestations and OCI labels for the four local images

These artifacts are not tied to a pushed immutable RC digest and are therefore **not** current staging RC
SBOM/scan/provenance. No registry attestation/signature or RC release record was produced. Secret scan found
zero leaks; license policy passed for 173 production packages.

## 9. Staging deployment

NOT RUN. There was no authorized deployment target. Backup/PITR, migration dry-run/job, API and eight worker
role rollouts, probes, queue health, freshness, dashboards, alerts, flags and release-record update could not
be executed. No production action was attempted.

## 10. Synthetic journeys

Current RC staging synthetics: **NOT RUN**. Session/login, market, symbol/chart, scanner, watchlist/alert,
portfolio, strategy/backtest, experiment and admin/non-admin journeys have no current staging evidence.
Local Playwright is reported only under repository regression.

## 11. LOAD-OPS-001–003

Result: **0/3 PASS**. `pnpm perf:production --scenario read-load` failed closed with
`STAGING_FIXTURE_NOT_CONFIGURED` (exit 1). Read-load, mixed and the mandatory four-hour soak were not run.
No requests, latency percentiles, error rate, saturation, leakage, pagination, duplicate-result, memory,
connection or drift measurements exist for this RC. No files under `reports/load/<rc-version>` were fabricated.

## 12. CHAOS-OPS-001–006

Result: **0/6 PASS**. `pnpm chaos:staging --scenario redis-restart` failed closed with
`STAGING_FIXTURE_NOT_CONFIGURED` (exit 1). Redis restart, worker kill, PostgreSQL interruption, object-storage
failure, bad-release rollback and stale-market-data faults were not injected. No local restart was counted and
no files under `reports/chaos/<rc-version>` were fabricated.

## 13. Rollback rehearsal

NOT RUN. Neither a current staging digest nor `STAGING_PREVIOUS_IMAGE_DIGEST` was available. Application,
worker and flag rollback; migration compatibility; queue recovery; post-rollback synthetics; data integrity;
and measured rollback time remain unverified. RPO/RTO impact is unknown; no new recovery measurement exists.

## 14. Current DAST

NOT RUN. `pnpm dast:staging` failed closed because `DAST_API_BASE_URL` is required (exit 1); web URL, allowed
origin and test identities are also absent. The historical 24/24 artifact remains historical only. Current RC
Critical/High, IDOR, secret/stack leakage, CORS and CSRF outcomes are unverified.

## 15. Observability and incident game-day

Repository observability controls exist, but no load/chaos telemetry was generated against staging. Release
labels, trace propagation, DB/Redis/queue metrics, alert firing/recovery delivery, runbook links and incident
timeline were not observed for a deployed RC. No chaos scenario could serve as the required incident game-day.

## 16. Repository quality gates

| Gate                                                | Result                                          |
| --------------------------------------------------- | ----------------------------------------------- |
| Node / pnpm                                         | PASS — 22.14.0 / 9.15.4                         |
| Clean frozen install                                | PASS — `pnpm install --force --frozen-lockfile` |
| Format / ADR                                        | PASS / PASS (25 ADR files)                      |
| Lint / typecheck, cache bypassed                    | PASS 8/8 / PASS 8/8                             |
| Unit tests, cache bypassed                          | PASS 609/609                                    |
| PostgreSQL database integration                     | PASS 63/63                                      |
| Worker Redis/PostgreSQL integration, isolated rerun | PASS 68/68                                      |
| Production build                                    | PASS 8/8; Next 16.2.11                          |
| OpenAPI / migration validation                      | PASS 1/1 / PASS                                 |
| Security controls / secret scan / license           | PASS / 0 leaks / PASS                           |
| Production dependency audit                         | PASS — Critical 0, High 0                       |
| Local four-target container build and smoke         | PASS                                            |
| Local API/worker container Critical/High scan       | PASS / PASS                                     |
| Skip/fixme/only scan                                | PASS — 0 matches                                |
| Git diff check                                      | PASS                                            |
| Playwright run 1 / run 2, four workers              | PASS 18/18 / PASS 18/18                         |
| Playwright retries / skipped / not-run              | 0 / 0 / 0                                       |

The migration schema was validated with `drizzle-kit check`; the repository database integration exercised
real isolated PostgreSQL 17 and Redis 7 containers. The isolated services were removed after testing.

## 17. Previous milestone regressions

Scanner Runtime, Alerts/Watchlists, Portfolio/Risk, Market Intelligence and Strategy Lab are represented in
the 609 unit tests and both complete 18-test Playwright runs. Their UI workflows, IDOR coverage, cursor and
financial/bias invariants passed locally. No test-count reduction or repository regression was observed.
However, the milestone cannot be declared regression-free in production-readiness terms while mandatory
staging performance, resilience and security gates remain unexecuted.

## 18. Exceptions

No approved security exception exists and none was auto-approved. No open production High/Critical dependency
finding requires an exception. Missing staging evidence is not exception-eligible and remains blocking.

## 19. Remaining risks

- Current code has never run as an immutable image in the target staging environment.
- Capacity, four-hour stability, dependency failure recovery and duplicate/durable-result invariants are unknown.
- Rollback compatibility and measured recovery time are unknown.
- Current authenticated and unauthenticated DAST posture is unknown.
- Synthetics, dashboards, alert delivery, incident workflow, backup/PITR and all eight worker digests are unverified.
- There is no current RC release record, registry provenance/signature or digest-bound artifact set.

## 20. GO/NO-GO decision

| Gate                 | Before |      Final |
| -------------------- | -----: | ---------: |
| Load                 |    0/3 |   0/3 FAIL |
| Chaos                |    0/6 |   0/6 FAIL |
| DB integration       |  63/63 | 63/63 PASS |
| Dependency Critical  |      0 |     0 PASS |
| Dependency High      |      0 |     0 PASS |
| Immutable staging RC |   None |       FAIL |
| Digest-bound SBOM    |   None |       FAIL |
| Container scan       |  Local |       FAIL |
| Provenance           |   None |       FAIL |
| Staging synthetics   |   None |       FAIL |
| Rollback rehearsal   |   None |       FAIL |
| Current DAST         |   None |       FAIL |
| Incident game-day    |   None |       FAIL |

Final decision: **NO-GO**. Load 3/3, chaos 6/6, immutable staging RC, digest-bound SBOM/scan/provenance,
rollback, current DAST, staging synthetics, observability/incident evidence and release record are mandatory
and absent. Do not create or recommend a v1.0 release candidate and do not launch production.
