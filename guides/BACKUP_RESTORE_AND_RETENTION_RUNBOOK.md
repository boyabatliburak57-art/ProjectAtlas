# Backup, Restore and Retention Runbook

## Scope and targets

The authoritative production adapter is declared in `deploy/recovery/capabilities.yaml`. PostgreSQL backups are encrypted with managed KMS keys, retained for 35 days, copied to a separate failure domain, and support PITR with an archive interval no greater than 15 minutes. The initial targets are RPO <= 15 minutes and RTO <= 120 minutes. A successful backup is not release-eligible until an isolated restore rehearsal has passed.

Runtime database credentials cannot restore or destroy backups. `atlas-runtime-secrets` is used by the application; `atlas-restore-secrets` is restricted to the recovery service account and the manual recovery workflow. Never print either value.

## Backup monitoring

`atlas-backup-status-monitor` polls the configured infrastructure adapter every 15 minutes and persists only normalized metadata in `backup_status_checks`. Encryption, PITR, retention, failure-domain, freshness, and provider status must all pass. `AtlasPostgresBackupFailed` pages Platform Operations and links back to this runbook. Raw provider payloads and credentials are never persisted.

## Isolated restore rehearsal

1. Select an immutable backup reference or PITR timestamp within the recovery window.
2. Create an isolated recovery database and network boundary using restore-only credentials.
3. Restore the encrypted backup and verify its checksum.
4. Run `node scripts/recovery/run-restore-drill.mjs` in the approved test adapter, or run the suspended `atlas-restore-drill-template` job with equivalent provider inputs.
5. Verify schema migration count/version, exact non-recovery table row counts, validated foreign keys, ownership, terminal run states, result/fill deduplication, portfolio projection ledger versions, feature flags, and audit records.
6. Start the real API composition root against the restored database and require `/health/ready` to pass.
7. Persist achieved RPO/RTO and the validation summary in `recovery_drills`.
8. Mark cleanup evidence, terminate connections, destroy the isolated database and temporary plaintext, and retain only encrypted evidence.

Local evidence commands:

```sh
pnpm recovery:validate
pnpm recovery:restore-drill
pnpm recovery:object-drill
pnpm recovery:redis-drill
```

Production release requires a recent passed drill ID. The workflow validates that persisted record, its RPO/RTO, application smoke, and cleanup before migration or rollout.

## Object and artifact recovery

Backtest series, imports, and exports use versioned encrypted objects with a SHA-256 checksum and KMS key reference. Restore verifies authenticated encryption and checksum before returning bytes. Lifecycle deletion operates only after retention expiry, skips Legal hold subjects, is batch-limited, and records an audit event. Orphan cleanup removes unreferenced object keys but never a referenced version.

## Redis loss

PostgreSQL remains authoritative. After Redis restart/loss, run reconciliation with deterministic job IDs, verify durable scan/backtest fingerprints did not change, rebuild caches from PostgreSQL, and assert duplicate job/result counts remain zero. Do not restore Redis snapshots over newer PostgreSQL state.

## Retention and account deletion

The `retention-v1` policy runs idempotent batches of at most 500 records (hard maximum 1,000). Active Legal hold records always win over lifecycle deletion. Notifications, detailed scan/backtest results, exports, import artifacts, operational logs, audit records, incidents, and deleted-account tombstones have explicit policy windows in the domain registry.

Account deletion is self-service or operations-admin only: disable immediately, revoke sessions, observe the grace period, purge encrypted artifacts before private resources, preserve a non-reversible subject hash/audit tombstone, and retry through reconciliation. A hold pauses purge without re-enabling the account.

## Failure and rollback

If restore, checksum, invariant, smoke, cleanup, RPO, or RTO fails, mark the drill failed, page the owner, stop release, and preserve sanitized evidence. Database recovery uses Forward-fix after an expand migration; destructive contract migrations require a validated rollback artifact and a fresh restore rehearsal. Never point production traffic at a recovery database during a drill.
