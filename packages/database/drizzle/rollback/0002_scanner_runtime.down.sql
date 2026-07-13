-- DESTRUCTIVE MANUAL ROLLBACK for 0002_scanner_runtime.sql.
-- Runtime data must be backed up before execution. Drizzle migrations remain forward-only;
-- after this rollback remove only the matching migration journal row before reapplying forward.

BEGIN;

DROP TABLE IF EXISTS scan_run_events;
DROP TABLE IF EXISTS scan_results;
DROP TABLE IF EXISTS scan_run_batches;
DROP TABLE IF EXISTS scan_runs;
DROP TABLE IF EXISTS preset_scan_revisions;
DROP TABLE IF EXISTS preset_scans;
DROP TABLE IF EXISTS saved_scan_tags;
DROP TABLE IF EXISTS saved_scan_revisions;
DROP TABLE IF EXISTS saved_scans;
DROP TABLE IF EXISTS scan_categories;
DROP FUNCTION IF EXISTS prevent_scan_run_identity_mutation();
DROP FUNCTION IF EXISTS prevent_scanner_revision_mutation();

COMMIT;
