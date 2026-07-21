-- Destructive rollback for TASK-075 security and operational control persistence.
-- Stop API writers, preserve audit/release evidence, run in a transaction and
-- prefer a forward-fix outside an isolated rollback rehearsal.
DROP TRIGGER IF EXISTS feature_flag_versions_immutable ON feature_flag_versions;
DROP TRIGGER IF EXISTS operational_audit_events_immutable ON operational_audit_events;
DROP FUNCTION IF EXISTS prevent_immutable_operational_record_mutation();

DROP TABLE IF EXISTS release_records;
DROP TABLE IF EXISTS operational_audit_events;
DROP TABLE IF EXISTS feature_flag_versions;
DROP TABLE IF EXISTS feature_flags;
DROP TABLE IF EXISTS security_rate_limit_buckets;
DROP TABLE IF EXISTS password_reset_tokens;
DROP TABLE IF EXISTS auth_sessions;
DROP TABLE IF EXISTS security_users;
