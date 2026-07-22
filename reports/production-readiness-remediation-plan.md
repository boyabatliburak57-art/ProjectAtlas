# Production Readiness Remediation Plan

Date: 2026-07-22  
Source audit: `reports/production-readiness-milestone-audit.md`

## Staging preflight

The preflight checks presence only and never prints secret values. No Kubernetes context is configured.
Docker Desktop is available locally, but local containers are not accepted as staging evidence.

| Required access                                                              | Preflight result                                          |
| ---------------------------------------------------------------------------- | --------------------------------------------------------- |
| Staging base/API URL (`STAGING_API_URL`)                                     | MISSING                                                   |
| Staging web URL / DNS / TLS target (`STAGING_WEB_URL`)                       | MISSING                                                   |
| Container registry authenticated write access                                | NOT VERIFIABLE; no scoped RC registry credential provided |
| Staging deployment access (`KUBE_CONFIG_STAGING` or current staging context) | MISSING                                                   |
| Staging PostgreSQL (`STAGING_DATABASE_URL`)                                  | MISSING                                                   |
| Staging Redis (`STAGING_REDIS_URL`)                                          | MISSING                                                   |
| Staging object storage (`STAGING_OBJECT_STORAGE_ENDPOINT`)                   | MISSING                                                   |
| Queue and worker deployment access                                           | MISSING with Kubernetes context                           |
| Synthetic user (`STAGING_SYNTHETIC_BEARER_TOKEN`)                            | MISSING                                                   |
| Admin user (`STAGING_OPERATIONS_BEARER_TOKEN`)                               | MISSING                                                   |
| Metrics access (`STAGING_METRICS_BEARER_TOKEN`)                              | MISSING                                                   |
| Isolated migration database (`STAGING_MIGRATION_DRY_RUN_DATABASE_URL`)       | MISSING                                                   |
| Critical alert test hook (`STAGING_CRITICAL_ALERT_TEST_URL`)                 | MISSING                                                   |
| Load fixture (`STAGING_FIXTURE_PATH`)                                        | MISSING                                                   |
| Chaos adapter (`STAGING_CHAOS_ADAPTER_PATH`)                                 | MISSING                                                   |
| Load/chaos authorization (`STAGING_LOAD_CHAOS_APPROVED`)                     | MISSING                                                   |
| Previous immutable digest (`STAGING_PREVIOUS_IMAGE_DIGEST`)                  | MISSING                                                   |
| DAST API/web/origin configuration                                            | MISSING                                                   |

## Findings and closure plan

| ID      | Initial finding                                    | Remediation                                                                                                                                                        | Required closure evidence                                                                | Current state                                                                             |
| ------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| PRD-001 | LOAD-OPS-001–003 have no real staging evidence     | Run the existing fail-closed production load runner against the authorized immutable staging RC, including the mandatory four-hour soak                            | Three RC-bound JSON artifacts and summary; 3/3 PASS                                      | BLOCKED by missing staging URL, fixture, metrics credentials and authorization            |
| PRD-002 | CHAOS-OPS-001–006 have no real staging evidence    | Run the provider-neutral chaos adapter only against authorized staging resources                                                                                   | Six RC-bound JSON artifacts and summary; 6/6 PASS                                        | BLOCKED by missing Kubernetes context, adapter, fixture and authorization                 |
| PRD-003 | Immutable staging RC and rollback rehearsal absent | Build/push digest images, deploy the RC, capture prior digest, exercise application/worker/flag rollback and redeploy RC                                           | Persisted release record, digest verification, synthetics and measured rollback          | BLOCKED by registry/staging access and previous digest                                    |
| PRD-004 | Legal-hold retention integration fails             | Make evaluation time deterministic and extend active/expired/released/batch/dry-run/concurrency/resume/authorization/audit coverage without weakening purge policy | Database integration failed = 0                                                          | CLOSED locally: focused 12/12 and database integration 63/63 PASS                         |
| PRD-005 | One High production dependency advisory, four CVEs | Upgrade compatible runtime dependency path, regenerate lockfile and rerun audit/build/image tests                                                                  | Critical 0, High 0 or genuinely approved exception                                       | CLOSED: production audit Critical 0 / High 0; build, sharp smoke and container smoke PASS |
| PRD-006 | Current RC SBOM/container scan/provenance absent   | Generate artifacts from the exact pushed digest and commit; verify cross-artifact identity                                                                         | Current digest-bound SBOM, scan, provenance, license, audit, metadata and release record | BLOCKED by current immutable registry image; local artifacts cannot close staging RC gate |
| PRD-007 | Current staging DAST absent                        | Run safe authenticated/unauthenticated DAST against the deployed RC                                                                                                | Current timestamp/version/digest report; Critical/High/IDOR/secret/stack failures 0      | BLOCKED by missing DAST URLs and test identities                                          |

## Decision discipline

PRD-001, PRD-002, PRD-003, PRD-006 and PRD-007 cannot be closed with mocks, no-op adapters, historical
artifacts or local container restarts. If these accesses remain unavailable, the final re-audit decision is
NO-GO even when all local remediation and regression gates pass.
