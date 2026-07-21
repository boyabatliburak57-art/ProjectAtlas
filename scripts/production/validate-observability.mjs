import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const dashboardDirectory = resolve(root, 'observability/grafana/dashboards');
const dashboardFiles = (await readdir(dashboardDirectory))
  .filter((file) => file.endsWith('.json'))
  .sort();
if (dashboardFiles.length < 10)
  fail(`expected at least 10 dashboards, found ${dashboardFiles.length}`);

const dashboardTitles = [];
for (const file of dashboardFiles) {
  const dashboard = JSON.parse(
    await readFile(resolve(dashboardDirectory, file), 'utf8'),
  );
  if (typeof dashboard.uid !== 'string' || typeof dashboard.title !== 'string')
    fail(`${file}: uid and title are required`);
  if (!Array.isArray(dashboard.panels) || dashboard.panels.length === 0)
    fail(`${file}: at least one panel is required`);
  for (const panel of dashboard.panels) {
    if (
      !Array.isArray(panel.targets) ||
      panel.targets.some(
        (target) => typeof target.expr !== 'string' || target.expr.length === 0,
      )
    )
      fail(`${file}: every panel requires a non-empty metrics expression`);
  }
  dashboardTitles.push(dashboard.title);
}

for (const topic of [
  'Platform',
  'API',
  'PostgreSQL',
  'Queue',
  'Market Data',
  'Scanner',
  'Alerts',
  'Portfolio',
  'Backtests',
  'Release',
])
  if (!dashboardTitles.some((title) => title.includes(topic)))
    fail(`dashboard topic is missing: ${topic}`);

const alertRules = await readFile(
  resolve(root, 'observability/alerts/prometheus-rules.yaml'),
  'utf8',
);
const blocks = alertRules.split(/\n\s+- alert: /u).slice(1);
if (blocks.length < 6) fail('at least six actionable alert rules are required');
for (const block of blocks) {
  for (const field of [
    'expr:',
    'severity:',
    'owner:',
    'runbook_url:',
    'dedup_key:',
    'cooldown:',
    'recovery_notification: required',
  ])
    if (!block.includes(field)) fail(`alert rule is missing ${field}`);
  if (/user_id|instrument_id|symbol|request_id|run_id/iu.test(block))
    fail('alert rule contains a high-cardinality grouping label');
}

const alertmanager = await readFile(
  resolve(root, 'observability/alerts/alertmanager.yaml'),
  'utf8',
);
for (const field of [
  'group_by:',
  'group_wait:',
  'group_interval:',
  'repeat_interval:',
  'receivers:',
  'inhibit_rules:',
])
  if (!alertmanager.includes(field))
    fail(`Alertmanager routing is missing ${field}`);

const metrics = JSON.parse(
  await readFile(resolve(root, 'observability/metrics/catalog.json'), 'utf8'),
);
if (metrics.policyVersion !== 'telemetry-v1')
  fail('telemetry policy version mismatch');
for (const forbidden of metrics.forbiddenLabels)
  if (metrics.labelAllowlist.includes(forbidden))
    fail(`forbidden metric label is allowlisted: ${forbidden}`);

const slo = JSON.parse(
  await readFile(resolve(root, 'observability/slo/definitions.json'), 'utf8'),
);
if (
  slo.availability.target !== 0.999 ||
  slo.workerTerminalRate.target !== 0.995
)
  fail('initial SLO targets differ from ADR-022');
for (const contract of slo.preservedPerformanceContracts)
  await readFile(resolve(root, contract), 'utf8');

const synthetics = JSON.parse(
  await readFile(
    resolve(root, 'observability/synthetics/journeys.json'),
    'utf8',
  ),
);
for (const code of [
  'login-session',
  'market-overview',
  'scanner-create-result',
  'portfolio-valuation',
  'backtest-create-status',
  'health-live',
  'health-ready',
  'health-startup',
])
  if (!synthetics.checks.some((check) => check.code === code))
    fail(`synthetic journey is missing: ${code}`);

const collector = await readFile(
  resolve(root, 'observability/otel-collector.yaml'),
  'utf8',
);
for (const key of [
  'authorization',
  'cookie',
  'db.connection_string',
  'enduser.id',
])
  if (!collector.includes(key)) fail(`collector redaction is missing: ${key}`);

process.stdout.write(
  `Observability provisioning validation passed (${dashboardFiles.length} dashboards, ${blocks.length} alerts, ${synthetics.checks.length} synthetic checks).\n`,
);

function fail(message) {
  throw new Error(`Observability validation failed: ${message}`);
}
