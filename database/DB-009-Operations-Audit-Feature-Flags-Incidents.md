# DB-009 — Operations, Audit, Feature Flags and Incidents

**Sürüm:** 1.0  
**Durum:** Uygulamaya hazır

## Feature flags

### `feature_flags`

- id uuid
- key varchar unique
- description text
- flag_type varchar
- default_enabled boolean
- owner varchar nullable
- expires_at timestamptz nullable
- created_at/updated_at

### `feature_flag_versions`

- flag_id uuid
- version integer
- environment varchar
- enabled boolean
- rollout_percentage numeric nullable
- targeting_rules jsonb
- reason text
- changed_by uuid
- created_at timestamptz

Unique: `flag_id + version + environment`.

## Operational audit

### `operational_audit_events`

- id uuid
- actor_user_id uuid nullable
- actor_type varchar
- action varchar
- resource_type varchar
- resource_id varchar nullable
- environment varchar
- reason text nullable
- before_state jsonb nullable
- after_state jsonb nullable
- request_id varchar nullable
- correlation_id varchar nullable
- created_at timestamptz

Audit event immutable olmalıdır.

## Releases

### `release_records`

- id uuid
- version varchar
- commit_sha varchar
- image_digest varchar
- environment varchar
- status varchar
- migrations jsonb
- feature_flags jsonb
- validation_summary jsonb
- started_by uuid nullable
- started_at/completed_at
- rollback_of uuid nullable
- rollback_reason text nullable

## Incidents

### `incidents`

- id uuid
- severity varchar
- status varchar
- title varchar
- summary text
- impact text nullable
- commander_user_id uuid nullable
- detected_at/acknowledged_at/resolved_at
- root_cause text nullable
- follow_up_summary jsonb

### `incident_timeline_events`

- incident_id uuid
- sequence bigint
- event_type varchar
- message text
- actor_user_id uuid nullable
- created_at timestamptz

Unique: `incident_id + sequence`.

## Restore drills

### `recovery_drills`

- id uuid
- drill_type varchar
- environment varchar
- backup_reference varchar nullable
- target_rpo_seconds integer nullable
- achieved_rpo_seconds integer nullable
- target_rto_seconds integer nullable
- achieved_rto_seconds integer nullable
- status varchar
- validation_summary jsonb
- started_at/completed_at
- executed_by uuid nullable

## Retention jobs

### `retention_job_runs`

- id uuid
- policy_code varchar
- status varchar
- scanned_count bigint
- deleted_count bigint
- skipped_count bigint
- error_summary jsonb
- started_at/completed_at

## Index ve güvenlik

- admin query indexes,
- immutable audit/incident timeline,
- JSON payload size limits,
- no secret/raw token storage,
- environment and status indexes.
