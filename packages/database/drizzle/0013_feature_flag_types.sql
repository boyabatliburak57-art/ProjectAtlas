ALTER TABLE "feature_flags" DROP CONSTRAINT "feature_flags_type_check";--> statement-breakpoint
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_type_check" CHECK ("feature_flags"."flag_type" in ('release', 'experiment', 'kill_switch', 'entitlement', 'maintenance'));--> statement-breakpoint
INSERT INTO "feature_flags" ("id", "key", "description", "flag_type", "default_enabled", "owner") VALUES
  ('00000000-0000-4000-8000-000000007701', 'scanner.new-runs.disabled', 'Stop creation of new scanner runs', 'kill_switch', false, 'scanner-runtime'),
  ('00000000-0000-4000-8000-000000007702', 'alerts.evaluation.disabled', 'Stop alert evaluation at worker boundaries', 'kill_switch', false, 'alerts-runtime'),
  ('00000000-0000-4000-8000-000000007703', 'notifications.email-delivery.disabled', 'Stop outbound e-mail delivery', 'kill_switch', false, 'notification-runtime'),
  ('00000000-0000-4000-8000-000000007704', 'portfolios.imports.disabled', 'Stop portfolio import preview and commit', 'kill_switch', false, 'portfolio-runtime'),
  ('00000000-0000-4000-8000-000000007705', 'backtests.creation.disabled', 'Stop creation of new backtest runs', 'kill_switch', false, 'backtest-runtime'),
  ('00000000-0000-4000-8000-000000007706', 'experiments.creation.disabled', 'Stop creation of new research experiments', 'kill_switch', false, 'experiment-runtime'),
  ('00000000-0000-4000-8000-000000007707', 'exports.disabled', 'Stop creation of new export resources', 'kill_switch', false, 'platform-runtime'),
  ('00000000-0000-4000-8000-000000007708', 'fundamentals.refresh.disabled', 'Stop fundamentals refresh jobs', 'kill_switch', false, 'market-data-runtime'),
  ('00000000-0000-4000-8000-000000007709', 'patterns.refresh.disabled', 'Stop pattern refresh jobs', 'kill_switch', false, 'market-data-runtime')
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
INSERT INTO "feature_flag_versions"
  ("flag_id", "version", "environment", "enabled", "rollout_percentage", "targeting_rules", "reason", "changed_by")
SELECT f."id", 1, e."environment", false, NULL, '{}'::jsonb,
       'Safe initial operational state', '00000000-0000-4000-8000-000000000000'::uuid
FROM "feature_flags" f
CROSS JOIN (VALUES ('test'), ('staging'), ('production')) AS e("environment")
WHERE f."key" IN (
  'scanner.new-runs.disabled',
  'alerts.evaluation.disabled',
  'notifications.email-delivery.disabled',
  'portfolios.imports.disabled',
  'backtests.creation.disabled',
  'experiments.creation.disabled',
  'exports.disabled',
  'fundamentals.refresh.disabled',
  'patterns.refresh.disabled'
)
ON CONFLICT ("flag_id", "version", "environment") DO NOTHING;
