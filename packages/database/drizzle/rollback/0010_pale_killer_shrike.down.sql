DROP TRIGGER IF EXISTS incident_timeline_events_immutable ON incident_timeline_events;
DROP FUNCTION IF EXISTS prevent_incident_timeline_mutation();
DROP TABLE IF EXISTS incident_timeline_events;
DROP TABLE IF EXISTS incidents;
