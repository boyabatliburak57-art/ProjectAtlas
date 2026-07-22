# GO — TASK-076 Backup, Disaster Recovery and Retention

Date: 2026-07-21  
Baseline commit: `1f66fd30f46e719ebb79d73973986432074dd9e7`  
Decision baseline: ADR-023  
Environment: Node.js 22.14.0, pnpm 9.15.4, local Docker PostgreSQL and Redis, isolated recovery database

## Outcome

All mandatory repository-level recovery gates passed. The executable restore rehearsal restored an encrypted PostgreSQL backup into an isolated database, verified schema and exact table counts, ran referential and business invariant checks, started the real API composition root against the restored database, passed its readiness smoke, met RPO/RTO, persisted immutable evidence, and safely removed the recovery database. Redis loss produced no durable-state loss or duplicate job. Encrypted artifact restore, retention, account deletion, IDOR, format, ADR, build, secret and dependency gates passed.

No production deployment or production data operation was performed.

## PostgreSQL backup and PITR controls

| Control                             | Result | Evidence                                                                                                                                                                                   |
| ----------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Encrypted automated backup contract | PASS   | Managed-adapter policy requires encryption at rest/in transit and automated backup. Local rehearsal encrypts the custom-format dump with AES-256-GCM and removes plaintext before restore. |
| PITR/equivalent                     | PASS   | Provider contract requires PITR with a maximum 900-second archive interval.                                                                                                                |
| Retention                           | PASS   | 35-day PostgreSQL backup retention is machine-validated.                                                                                                                                   |
| Separate failure domain             | PASS   | Provider contract requires a domain separate from primary; local evidence copies the encrypted artifact outside the database container.                                                    |
| Credential separation               | PASS   | Runtime and restore credentials use separate secret references.                                                                                                                            |
| Status monitoring                   | PASS   | Normalized backup status, freshness, encryption, PITR, retention and failure-domain checks persist in `backup_status_checks`. Raw provider payload is not stored.                          |
| Failure alert                       | PASS   | `AtlasPostgresBackupFailed` and expired-rehearsal alert rules validate with owner, severity, grouping, cooldown, recovery notification and runbook metadata.                               |

The production adapter boundary is provider-neutral. A selected managed PostgreSQL platform must satisfy `deploy/recovery/capabilities.yaml`; the release workflow refuses rollout until its persisted full restore rehearsal passes. This task did not initiate a production restore or deploy.

## Restore rehearsal

Command: `pnpm recovery:restore-drill`

| Measurement or invariant              |               Target |                                 Actual | Result |
| ------------------------------------- | -------------------: | -------------------------------------: | ------ |
| Restore drill ID                      | persisted full drill | `6351b13d-41bc-4726-a9c6-a94a90f4c6d9` | PASS   |
| RPO                                   |       <= 900 seconds |                              0 seconds | PASS   |
| RTO                                   |     <= 7,200 seconds |                              8 seconds | PASS   |
| Migration count/version               |     source = restore |                             13 / match | PASS   |
| Exact non-recovery row counts         |         mismatch = 0 |                                      0 | PASS   |
| Foreign-key validation failures       |                    0 |                                      0 | PASS   |
| Ownership invariant failures          |                    0 |                                      0 | PASS   |
| Scan/backtest terminal-state failures |                    0 |                                      0 | PASS   |
| Duplicate scan-result failures        |                    0 |                                      0 | PASS   |
| Duplicate fill failures               |                    0 |                                      0 | PASS   |
| Portfolio ledger/projection failures  |                    0 |                                      0 | PASS   |
| Aggregate business invariant failures |                    0 |                                      0 | PASS   |
| Restored application readiness smoke  |                 PASS |                                   PASS | PASS   |
| Isolated database cleanup             |                 PASS |           PASS; target database absent | PASS   |

Backup checksum validation passed before restore. The terminal drill record is immutable except for the one-way cleanup timestamp. Execution errors are persisted as sanitized failed drill evidence. The release gate accepts only a recent `full` drill with cleanup and in-target RPO/RTO; a passed Redis-loss drill was explicitly tested and rejected as a release substitute.

Detailed evidence: `reports/recovery/restore-drill.json` and `reports/recovery/restore-drill.md`.

## Object and artifact storage

Command: `pnpm recovery:object-drill`

| Control                              | Result |
| ------------------------------------ | ------ |
| Versioned artifact                   | PASS   |
| AES-256-GCM authenticated encryption | PASS   |
| SHA-256 checksum                     | PASS   |
| Authorized restore                   | PASS   |
| Lifecycle enforcement                | PASS   |
| Orphan cleanup                       | PASS   |

Artifact metadata stores ownership, type, object key/version, checksum, encryption-key reference, size, state and retention time; it stores neither object payload nor provider credentials. Export/import/backtest artifacts share the versioned storage contract. Detailed evidence is in `reports/recovery/object-restore-drill.json` and `reports/recovery/object-restore-drill.md`.

## Redis loss and reconciliation

Command: `pnpm recovery:redis-drill`

| Invariant                        |    Actual | Result |
| -------------------------------- | --------: | ------ |
| PostgreSQL durable loss          |         0 | PASS   |
| Duplicate jobs                   |         0 | PASS   |
| Durable fingerprint before/after |     equal | PASS   |
| Queue reconciliation             | completed | PASS   |
| Cache rebuild                    | completed | PASS   |
| API PostgreSQL progress fallback | 5/5 tests | PASS   |

The drill restarted and cleared the real Redis container, used deterministic BullMQ job identity, compared durable scan/backtest PostgreSQL fingerprints, and rebuilt ephemeral state. PostgreSQL remains authoritative. Evidence: `reports/recovery/redis-loss-drill.json` and `reports/recovery/redis-loss-drill.md`.

## Retention runtime

Policy version: `retention-v1`. Default batch size is 500 and the hard maximum is 1,000. Every run has a durable execution key, idempotent replay, terminal immutability, legal/security-hold checks and an operational audit event.

| Category                   |                         Retention |
| -------------------------- | --------------------------------: |
| Notifications              |                          365 days |
| Detailed scan results      |                           90 days |
| Detailed backtest results  |                          365 days |
| Exports                    |                            7 days |
| Import files               |                           30 days |
| Operational logs           | 30 days, external backend-managed |
| Audit records              |                        2,555 days |
| Resolved incidents         |                        2,555 days |
| Deleted-account tombstones |                           30 days |

Normal incident timeline mutation remains blocked by its immutable-history trigger. The retention repository can delete expired resolved incident history only inside the transaction-scoped, audited retention context. Legal hold always takes precedence.

## Account deletion

The authenticated actor is authoritative at the HTTP boundary. The flow disables the account immediately, revokes sessions, applies a 30-day grace period, queues asynchronous purge, removes versioned files before private resources, persists a one-way subject-hash tombstone, and supports bounded retry/reconciliation. Self-service and operations-admin authorization are deny-by-default; another user's identifier in the request body cannot redirect deletion.

| Test area                                         | Result     |
| ------------------------------------------------- | ---------- |
| Domain state machine, idempotency, hold and retry | 12/12 PASS |
| PostgreSQL retention/deletion integration         | 4/4 PASS   |
| Recovery migration integration                    | 4/4 PASS   |
| API security/ownership/IDOR integration           | 12/12 PASS |
| Artifact deletion before resource purge           | PASS       |
| Tombstone and audit preservation                  | PASS       |

## Runtime and operations integration

- Migration `0012_recovery_retention` adds backup checks, recovery drills, retention runs, legal holds, artifact versions and account deletion requests with ownership, unique, FK and immutable-terminal constraints.
- Recovery jobs are registered in the production worker composition root with stable queue/job constants, scheduled retention/deletion reconciliation, heartbeat, retry and graceful shutdown.
- Kubernetes includes a dedicated recovery service account, 15-minute status monitor, suspended full-restore template and release-gate job. Workloads are non-root and read-only.
- Production release renders an immutable-digest gate and verifies backup/PITR plus the persisted restore rehearsal before migration or rollout.
- The recovery runbook documents backup failure, restore, Redis reconstruction, artifact restore, retention, account deletion, forward-fix and cleanup procedures.

## Verification record

| Command or suite                            | Result                                      |
| ------------------------------------------- | ------------------------------------------- |
| `pnpm recovery:validate`                    | PASS, 7/7 controls                          |
| `pnpm recovery:restore-drill`               | PASS                                        |
| persisted full-drill release gate           | PASS                                        |
| wrong drill-type release-gate negative test | PASS, rejected                              |
| `pnpm recovery:redis-drill`                 | PASS                                        |
| `pnpm recovery:object-drill`                | PASS                                        |
| recovery domain unit tests                  | 12/12 PASS                                  |
| recovery worker unit tests                  | 6/6 PASS                                    |
| recovery database integration tests         | 8/8 PASS                                    |
| security/IDOR database integration tests    | 12/12 PASS                                  |
| full repository unit/runtime tests          | PASS                                        |
| OpenAPI validation                          | PASS                                        |
| migration validation / Drizzle check        | PASS                                        |
| lint, cache disabled                        | PASS                                        |
| typecheck, cache disabled                   | PASS                                        |
| production build, cache disabled            | PASS                                        |
| alert/dashboard/workflow validation         | PASS                                        |
| `pnpm secret:scan`                          | PASS, working tree and 197 commits, 0 leaks |
| `pnpm audit --prod --audit-level high`      | PASS, no known vulnerabilities              |
| `pnpm format:check`                         | PASS                                        |
| `pnpm validate:adr`                         | PASS, 25 ADR files                          |
| `git diff --check`                          | PASS                                        |

## GO criteria

- Restore drill: PASS
- Achieved RPO within target: PASS
- Achieved RTO within target: PASS
- Restored application smoke: PASS
- Redis durable loss: 0
- Object restore: PASS
- Retention tests: PASS
- Account deletion security and IDOR: PASS
- Critical deviations: 0

TASK-076 is **GO**. Production remains protected by a manual deployment approval and the persisted full-restore release gate; no production deployment was performed.
