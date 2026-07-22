# TASK-076 Backup, DR and Retention Gap Analysis

Date: 2026-07-21  
Decision baseline: ADR-023, RPO <= 15 minutes, RTO <= 2 hours

## Initial result

**NO-GO before remediation.** The deployment boundary correctly treats PostgreSQL and object storage as durable and Redis as ephemeral, while the production release workflow requires a restore-drill reference. The repository did not yet contain an executable backup/restore drill, DB-009 recovery/retention persistence, retention/account-purge runtime, backup failure alert, or object restore evidence.

## Findings

| ID         | Severity | Gap                                                                                                                                   | Evidence                                         | Required remediation                                                                               | Owner                   |
| ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ----------------------- |
| DR-076-001 | High     | Restore-drill references are accepted as non-empty strings rather than verified successful, current, environment-scoped records.      | `.github/workflows/production-release.yml`       | Persist recovery drills and validate status, environment, RPO/RTO and recency before release.      | Platform / Release      |
| DR-076-002 | High     | No isolated restore automation validates schema, row counts, referential integrity, business invariants and application startup.      | ADR-023 requirements have no executable adapter. | Add provider-neutral PostgreSQL dump/PITR restore orchestration and deterministic validation.      | Database Reliability    |
| DR-076-003 | Medium   | Managed PostgreSQL PITR/encryption/retention/separate-domain expectations are documentation only.                                     | `deploy/README.md`                               | Add a machine-validated platform capability contract, monitoring and separate restore credentials. | Platform                |
| DR-076-004 | Medium   | DB-009 `recovery_drills` and `retention_job_runs` tables are absent.                                                                  | Migration 0011/schema                            | Add migration, constraints, immutable completed-drill protection and integration tests.            | Database                |
| DR-076-005 | Medium   | Artifact storage has endpoint configuration but no checksum/version/lifecycle/restore/orphan contract.                                | Runtime environment and ConfigMap                | Add durable artifact metadata, encrypted versioned store port and restore drill.                   | Storage                 |
| DR-076-006 | Medium   | Redis-loss reconciliation is distributed across runtimes and has no unified drill proving durable-loss and duplicate counts are zero. | Existing worker catch-up/reconcile paths         | Add controlled loss/restart drill with PostgreSQL before/after invariants and cache/queue rebuild. | Runtime                 |
| DR-076-007 | High     | No legal-hold-aware, batch-limited, idempotent and audited retention runtime exists.                                                  | DB-009 retention design only                     | Add versioned policies, durable run state and scheduled application service.                       | Privacy / Data Platform |
| DR-076-008 | High     | Account deletion has no disable/grace/async purge/tombstone workflow or deletion IDOR boundary.                                       | Security user/session tables                     | Add deletion state machine, storage cleanup, retry/reconciliation and ownership tests.             | Identity / Privacy      |
| DR-076-009 | Medium   | No backup failure/restore-rehearsal expiry alert exists.                                                                              | Prometheus rules                                 | Add status/age metrics and actionable alerts with owner/runbook/recovery metadata.                 | SRE                     |

## Existing controls retained

- PostgreSQL is authoritative; Redis is explicitly non-authoritative.
- Production workloads are stateless and use immutable image digests.
- Migration policy requires a restore-drill reference for destructive changes.
- Runtime and restore credentials are supplied by the external secret-manager adapter; secrets are not committed.
- Scanner/backtest idempotency and unique constraints, portfolio replay, worker catch-up and Redis fallback suites already provide component-level recovery invariants.
- Production deployment is not authorized by this task; all destructive validation must use isolated local/staging recovery resources.

The final gate can become GO only after restore, RPO/RTO, application smoke, Redis durable-loss, object restore, retention and account-deletion security checks all pass.
