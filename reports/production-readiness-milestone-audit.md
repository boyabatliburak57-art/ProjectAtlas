# NO-GO — Production Readiness Milestone Audit

Date: 2026-07-22  
Audited repository commit: `93f9bab4bd43ce0695442973f1c808ba1c9f2fdf` plus the uncommitted TASK-079 working tree  
Toolchain: Node.js `22.14.0`, pnpm `9.15.4`

## Executive decision

**NO-GO.** The repository's unit, build, deployment-contract, observability, recovery-drill and historical
milestone evidence is substantial, but the mandatory production-readiness conditions are not all satisfied.
The following independent release blockers exist:

1. `LOAD-OPS-001`–`003` and `CHAOS-OPS-001`–`006` have no real staging execution; all nine mandatory
   scenarios remain FAIL/not measured.
2. No immutable v0.9 staging RC was deployed. There is no RC digest, staging release record, operational
   exercise evidence or controlled rollback rehearsal.
3. The current production dependency audit reports one unresolved **High** advisory affecting
   `next@16.2.10 > sharp@0.34.5`, covering CVE-2026-33327, CVE-2026-33328, CVE-2026-35590 and
   CVE-2026-35591. The patched boundary reported by the audit is `sharp >=0.35.0`; there is no approved,
   owned and expiring exception.
4. The database integration suite is **54/55**, not PASS. The retention/legal-hold test deletes two rows
   instead of deleting one and skipping the held row. Its fixture creates the hold with database `now()`
   but evaluates retention at fixed `2026-07-21T12:00:00Z`; on this audit date the hold has not started at
   the supplied evaluation instant.

No v1.0 release candidate or production launch is recommended. No production deployment was initiated.

## 1. Repository quality gates

| Gate                                | Result                 | Evidence                                                                      |
| ----------------------------------- | ---------------------- | ----------------------------------------------------------------------------- |
| Node / pnpm                         | PASS                   | `22.14.0` / `9.15.4`                                                          |
| `pnpm format:check`                 | PASS                   | Repository-wide Prettier check                                                |
| `pnpm validate:adr`                 | PASS                   | 25 ADR files                                                                  |
| Lint, cache disabled                | PASS                   | 8/8 workspaces; `TURBO_FORCE=true`, cached 0                                  |
| Typecheck, cache disabled           | PASS                   | 8/8 workspaces; cached 0                                                      |
| Unit/runtime, cache disabled        | PASS                   | 609/609: domain 398, web 13, database 21, worker 47, API 130                  |
| Database integration                | **FAIL**               | 54/55; legal-hold retention assertion failed                                  |
| API database/security integration   | PASS                   | 18/18                                                                         |
| Worker PostgreSQL/Redis integration | PASS after correct env | 68/68; initial invocation correctly failed closed when `REDIS_URL` was absent |
| Production build, cache disabled    | PASS                   | 8/8 workspaces; cached 0                                                      |
| OpenAPI validation                  | PASS                   | 1/1                                                                           |
| Migration/schema validation         | PASS                   | Drizzle check; migration artifacts validate                                   |
| Skip/only/fixme scan                | PASS                   | 0 markers                                                                     |
| `git diff --check`                  | PASS                   | No whitespace error                                                           |

The first database integration invocation also failed closed because `TEST_DATABASE_URL` was absent. It was
rerun against isolated PostgreSQL 17 and Redis 7 containers. The resulting 54/55 assertion result above is
the authoritative audit result and is not an environment skip.

## 2. Artifact and supply chain

| Control                   | Result                       | Evidence / limitation                                                                           |
| ------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------- |
| Immutable image digest    | **FAIL for RC**              | Manifests/workflows enforce `@sha256`; no current deployed RC digest exists                     |
| Pinned base image         | PASS                         | Node 22.14.0 Alpine 3.21 pinned to SHA-256 in `Dockerfile`                                      |
| Non-root runtime          | PASS                         | API, worker, migration and web use UID 1000 / `USER node`                                       |
| Production dependency set | PASS structurally            | Frozen lockfile and production-only dependency stage                                            |
| SBOM                      | Historical PASS / RC missing | TASK-075 API and worker SPDX 2.3, 216 packages each; no current RC SBOM                         |
| Container scan            | Historical PASS / RC missing | 2026-07-21 API and worker Critical 0 / High 0; no current RC image scan                         |
| Dependency audit          | **FAIL**                     | One unresolved High advisory, four CVEs, no exception                                           |
| Secret scan               | PASS                         | Working tree and 204 commits, leakage 0                                                         |
| License policy            | PASS                         | 9 allowed expressions, 173 production packages                                                  |
| OCI image labels          | PASS                         | created, revision, source and version labels                                                    |
| Build provenance          | READY / RC missing           | Staging workflow requests BuildKit provenance and SBOM attestations; no RC attestation produced |

### Security findings register

| Severity            |               Count | Finding                                                          | Disposition                |
| ------------------- | ------------------: | ---------------------------------------------------------------- | -------------------------- |
| Critical            |                   0 | None found in current dependency audit or historical image scans | Closed                     |
| High                | 1 advisory / 4 CVEs | `sharp@0.34.5` inherited libvips vulnerabilities through Next.js | **Open; release blocking** |
| Approved exceptions |                   0 | No approved and expiring exception was found                     | None                       |

Historical container results do not override the newer dependency advisory and cannot substitute for a scan
of the final immutable RC image.

## 3. Deployment and CI/CD

Configuration schema validation, production fail-fast rules, secret references, separate API/web/migration
and seven worker roles, startup/readiness/liveness probes, API shutdown hooks, worker single-shot drain,
immutable migration job rendering and expand/contract policy are implemented and validated. Staging and
production manifests reject mutable/placeholder images. Production deployment is manual, confirmation
gated, restore-drill gated and supports controlled deploy/rollback actions. Release-record persistence is
admin RBAC protected and audited.

Status distinctions:

- Environment/config validation, startup fail-fast, secret injection interface, roles, probes, API shutdown,
  worker drain/requeue contract, migration job and expand/contract policy: **PASS**.
- Controlled production workflow and rollback implementation: **PASS as contract**, not executed.
- Staging deployment and persisted RC release record: **FAIL/not executed**.
- Controlled application/worker rollback with post-rollback synthetics: **FAIL/not rehearsed**.

## 4. Health

`/health/live`, `/health/ready` and `/health/startup` are implemented outside the versioned API prefix.
Focused tests pass. Liveness reports process state; startup remains 503 until bootstrap; readiness returns 503
during startup, shutdown/drain or database ping failure. Staging/production configuration requires database
health checks. Responses expose only bounded status and request ID—no credential, connection string,
provider payload or internal topology. Dependency degradation and traffic-acceptance semantics are **PASS**.

## 5. Observability

Structured JSON logs, request/correlation/trace/job context, HTTP-to-queue trace propagation, recursive
redaction, bounded metric labels and telemetry-unavailable fallback are implemented and tested.
Provisioning validation reports 10 dashboards, 9 actionable Prometheus alerts and 8 synthetic definitions;
all alert expressions validate and carry runbook ownership/link metadata. High-cardinality identifiers are
rejected from labels. The stored SLO window reports API availability 99.95%, worker terminal success 99.7%,
50% API error budget remaining and `ALLOW_CONTROLLED_ROLLOUT`. The controlled staging-profile Redis game-day
contains detection, mitigation, recovery notification and a four-event incident timeline.

Observability contract: **PASS**. RC-specific remote staging SLO/dashboard inspection, alert delivery and
synthetics are **not run** and therefore remain part of the RC blocker.

## 6. Security

Authentication uses durable hashed sessions, rotation/replay rejection, logout invalidation, idle/absolute
expiry, account disable/lock checks, password-reset family revocation and brute-force limits. Private-resource
authorization covers saved scans, scanner runs, alerts, watchlists, notifications, portfolios,
transactions, imports/exports, strategies, backtests and experiments. Admin identity is server resolved,
recent-auth and role gated. Queue payloads retain bounded actor/resource context and reload authoritative
ownership from PostgreSQL.

Rate classes cover auth, reads, writes, scanner, portfolio recalculation, import/export, backtest,
experiment and admin operations; authenticated-user and login-identity dimensions prevent IP rotation
bypass. Domain/API limits cover concurrent heavy jobs, body/query, pagination, universe/date range,
experiment combinations and file/row counts. Static/dynamic coverage includes CORS, CSRF, CSP/HSTS and
security headers, XSS, SQL/command injection, SSRF-shaped input, path traversal, prototype pollution, CSV
formula injection, safe errors/stack suppression and log/trace redaction.

| Required count               |                       Result |
| ---------------------------- | ---------------------------: |
| Critical security findings   |                            0 |
| High security findings       | **1 open advisory / 4 CVEs** |
| Approved exceptions          |                            0 |
| IDOR failures                |                            0 |
| Admin authorization failures |                            0 |
| Secret leakage               |                            0 |
| Rate-limit bypass            |                            0 |

The stored staging-profile DAST artifact dated 2026-07-21 is 24/24 PASS with Critical 0 / High 0. A current
DAST rerun was attempted but failed closed before testing because `DAST_API_BASE_URL` was not configured;
therefore the historical artifact is retained as evidence but is not described as a current RC DAST run.

## 7. Backup and recovery

The repository defines encrypted automated backup/PITR monitoring, separate failure-domain and restore
credential policies, backup status alerts and a production release recovery gate. Backup job status alone
was not accepted. The isolated restore drill is PASS with drill ID
`6351b13d-41bc-4726-a9c6-a94a90f4c6d9`, achieved RPO 0 seconds, achieved RTO 8 seconds, migration/schema
compatibility PASS, row mismatch 0, business invariant failures 0, application smoke PASS and cleanup PASS.
Object restore verifies AES-256-GCM, versioning, lifecycle and SHA-256 checksum. Redis-loss reconciliation
reports durable loss 0, duplicate jobs 0, queue reconciliation and cache rebuild PASS. Drill records are
persistable and admin-visible.

Restore drill, RPO and RTO: **PASS**. This does not cure the independent retention integration regression or
the missing RC recovery/rollback gate execution.

## 8. Retention and deletion

Versioned retention policies, batch limits, execution-key idempotency, audit records, legal holds,
export/import cleanup, detailed-result retention, account disable/grace/purge/tombstone, purge retry and
ownership/IDOR controls exist. Domain recovery tests are 12/12 and prior TASK-076 evidence was PASS.

Current milestone result: **FAIL**. The real PostgreSQL retention suite is 54/55 because the legal-hold test
does not preserve the held notification at its fixed evaluation time. Until the time semantics are made
deterministic and the full integration suite passes, batch/hold-aware retention cannot be accepted.

## 9. Feature flags and operations

Versioned environment flags, deterministic SHA-256 percentage buckets, targeting validation, optimistic
concurrency, Redis invalidation/PostgreSQL fallback, safe unavailable defaults and expiry reporting are
implemented. Scanner, alert evaluation, e-mail, portfolio import, backtest, experiment, export,
fundamentals and pattern switches are wired at request/worker boundaries. Queue pause/resume and controlled
job retry/cancel use allowlists, expected versions, exact confirmation text and immutable audit records.
Admin RBAC/IDOR, maintenance banner and recovery/release/incident summaries are present.

Contract and local tests: **PASS**. Real RC exercises for percentage rollout/rollback, scanner and backtest
kill switches, queue pause/resume, failed-job retry and maintenance banner: **FAIL/not run on staging**.

## 10. Load and resilience

The runner contract preserves every historical feature threshold, rejects production targets, requires
immutable digests and enforces a four-hour minimum soak. Contract tests are 5/5 and three load plus six
chaos definitions validate. Contract validation is not scenario execution.

| Scenario      | Required evidence                                                                   | Audit result                    |
| ------------- | ----------------------------------------------------------------------------------- | ------------------------------- |
| LOAD-OPS-001  | Read workload, feature p95, error rate, cross-user isolation                        | **FAIL — not run/not measured** |
| LOAD-OPS-002  | Mixed workload, API latency, queue lag, throughput, DB/Redis saturation, duplicates | **FAIL — not run/not measured** |
| LOAD-OPS-003  | >=4h soak, memory/connection/queue/latency drift                                    | **FAIL — not run/not measured** |
| CHAOS-OPS-001 | Redis restart, <=120s recovery, durable loss 0, duplicates 0                        | **FAIL — not run/not measured** |
| CHAOS-OPS-002 | Worker termination, checkpoint/retry, duplicates 0                                  | **FAIL — not run/not measured** |
| CHAOS-OPS-003 | PostgreSQL interruption, readiness, bounded retry, integrity                        | **FAIL — not run/not measured** |
| CHAOS-OPS-004 | Object storage failure, retry/status, integrity                                     | **FAIL — not run/not measured** |
| CHAOS-OPS-005 | Bad release rollback <=300s, recovery, migration compatibility                      | **FAIL — not run/not measured** |
| CHAOS-OPS-006 | Stale market data, freshness alert, user warning, false freshness 0                 | **FAIL — not run/not measured** |

Mandatory scenario result: **0/9 PASS, 9/9 FAIL**.

## 11. Release candidate

The TASK-079 implementation can generate `0.9.0-rc.N`, digest-addressed web/API/worker/migration images,
provenance/SBOM attestations, scan gates, migration list, config schema version, flag snapshot, release notes
and validation summary. The synthetic self-test passes all requested eight journeys using 15 HTTP checks.
The admin browser suite exercises RBAC denial, audited kill switch, queue confirmation, percentage rollout,
version conflict, focus visibility and operations summaries.

Actual RC evidence is absent:

- RC version, deployed commit/image digests and immutable release record: **missing**.
- Staging deploy/migrations/worker health: **not run**.
- Remote synthetic journeys and SLO/dashboard/alert delivery: **not run**.
- Flag rollout/rollback, kill switches, queue operations and maintenance banner: **not run**.
- Application/worker/flag rollback and migration compatibility rehearsal: **not run**.
- RC incident game-day: **not run**.
- Operational E2E against staging: **not run**.
- Local full Playwright including keyboard/accessibility: **18/18 PASS**.

Release candidate gate: **FAIL**.

## 12. Previous milestone regressions

| Baseline            | Historical baseline                                   | Current verification                                                       | Result                                                                    |
| ------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Scanner Runtime     | 181 unit, 24 integration, 3 E2E, PERF-SCN 6/6         | Relevant tests retained; full unit 609, E2E 18/18; stored performance PASS | PASS subject to global blockers                                           |
| Alerts/Watchlists   | 223 unit, 41 integration, 5 E2E, PERF-AWN 5/5         | Ownership/XSS/dedup paths retained; E2E 18/18; stored performance PASS     | PASS subject to global blockers                                           |
| Portfolio/Risk      | 347 unit, 55 integration, 8 E2E, PERF-PORT 6/6        | Financial/risk/CSV/IDOR E2E retained; stored performance PASS              | PASS subject to global blockers                                           |
| Market Intelligence | 446 unit, 68 integration, 11 E2E, PERF-MKT 6/6        | No-look-ahead/cache/IDOR/accessibility retained; worker integration 68/68  | PASS subject to global blockers                                           |
| Strategy Lab        | 554 unit, database 42, worker 67, 15 E2E, PERF-BT 6/6 | Unit 609, worker 68, full E2E 18/18; bias/financial tests retained         | **FAIL globally: database integration 54/55 and High dependency finding** |

Historical p95 threshold files and reports were not modified or relaxed. This audit did not rerun the
expensive feature benchmark suites; it verified their canonical reports and threshold preservation through
the resilience contract. No assertion was reduced and no skip/fixme/only marker was introduced.

## Final GO matrix

| GO condition                                     | Result                                                                 |
| ------------------------------------------------ | ---------------------------------------------------------------------- |
| Failed = 0                                       | **FAIL**                                                               |
| Critical deviations = 0                          | **FAIL** — missing mandatory staging evidence and retention regression |
| Critical security findings = 0                   | PASS                                                                   |
| High security findings = 0 or approved exception | **FAIL**                                                               |
| IDOR/admin authorization failures = 0            | PASS                                                                   |
| Secret leakage = 0                               | PASS                                                                   |
| Rate-limit bypass = 0                            | PASS                                                                   |
| Restore drill / RPO / RTO                        | PASS                                                                   |
| Mandatory load scenarios                         | **FAIL — 0/3**                                                         |
| Mandatory chaos scenarios                        | **FAIL — 0/6**                                                         |
| Rollback rehearsal                               | **FAIL — not run**                                                     |
| SLO dashboards, alerts and synthetics            | Contract PASS; **RC staging validation missing**                       |
| Operational E2E and accessibility                | Local 18/18 PASS; **remote operational exercise missing**              |
| Previous milestone regressions = 0               | **FAIL — retention integration regression**                            |
| Format/ADR/lint/typecheck/test/build             | **FAIL overall because integration is 54/55**                          |

**Final decision: NO-GO.** Resolve the High dependency advisory (or create a rigorously approved, owned and
expiring exception), make retention/legal-hold time semantics deterministic and restore 55/55 integration,
execute all nine load/chaos scenarios on an authorized immutable staging deployment, then produce and fully
exercise the v0.9 RC including rollback. Until all evidence is PASS, neither a v1.0 release candidate nor a
production launch should be proposed.
