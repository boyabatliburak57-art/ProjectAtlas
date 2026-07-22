DROP TRIGGER IF EXISTS retention_job_runs_terminal_immutable ON retention_job_runs;
DROP FUNCTION IF EXISTS prevent_retention_run_terminal_rewrite();
CREATE OR REPLACE FUNCTION prevent_incident_timeline_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'incident timeline events are immutable';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS recovery_drills_terminal_immutable ON recovery_drills;
DROP FUNCTION IF EXISTS prevent_recovery_drill_terminal_rewrite();
DROP TABLE IF EXISTS account_deletion_requests;
DROP TABLE IF EXISTS stored_artifacts;
DROP TABLE IF EXISTS legal_holds;
DROP TABLE IF EXISTS retention_job_runs;
DROP TABLE IF EXISTS recovery_drills;
DROP TABLE IF EXISTS backup_status_checks;
