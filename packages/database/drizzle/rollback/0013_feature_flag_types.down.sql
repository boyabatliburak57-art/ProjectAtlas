ALTER TABLE "feature_flag_versions"
  DISABLE TRIGGER "feature_flag_versions_immutable";
DELETE FROM "feature_flag_versions"
WHERE "flag_id" IN (
  SELECT "id" FROM "feature_flags"
  WHERE "id" BETWEEN '00000000-0000-4000-8000-000000007701'::uuid
                 AND '00000000-0000-4000-8000-000000007709'::uuid
);
ALTER TABLE "feature_flag_versions"
  ENABLE TRIGGER "feature_flag_versions_immutable";
DELETE FROM "feature_flags"
WHERE "id" BETWEEN '00000000-0000-4000-8000-000000007701'::uuid
               AND '00000000-0000-4000-8000-000000007709'::uuid;
ALTER TABLE "feature_flags" DROP CONSTRAINT "feature_flags_type_check";
ALTER TABLE "feature_flags"
  ADD CONSTRAINT "feature_flags_type_check"
  CHECK ("flag_type" IN ('release', 'experiment', 'kill_switch'));
