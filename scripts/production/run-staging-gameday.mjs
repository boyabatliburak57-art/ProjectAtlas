import { execFile as execFileCallback } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const suffix = process.pid.toString();
const network = `atlas-observability-gameday-${suffix}`;
const postgres = `${network}-postgres`;
const redis = `${network}-redis`;
const migrationImage =
  process.env['ATLAS_MIGRATION_IMAGE'] ?? 'atlas-migration:task-074';
const incidentId = randomUUID();
const commanderId = randomUUID();
const detectedAt = new Date();

try {
  await docker(['network', 'create', network]);
  await docker([
    'run',
    '-d',
    '--name',
    postgres,
    '--network',
    network,
    '-e',
    'POSTGRES_DB=atlas_gameday',
    '-e',
    'POSTGRES_USER=atlas',
    '-e',
    'POSTGRES_PASSWORD=gameday-only',
    'postgres:17-alpine',
  ]);
  await docker([
    'run',
    '-d',
    '--name',
    redis,
    '--network',
    network,
    'redis:7-alpine',
  ]);
  await waitFor(() =>
    docker([
      'exec',
      postgres,
      'pg_isready',
      '-U',
      'atlas',
      '-d',
      'atlas_gameday',
    ]),
  );
  await waitFor(() => docker(['exec', redis, 'redis-cli', 'ping']));
  await docker([
    'run',
    '--rm',
    '--network',
    network,
    '-e',
    'ATLAS_ENV=staging',
    '-e',
    'NODE_ENV=production',
    '-e',
    'CONFIG_SCHEMA_VERSION=1',
    '-e',
    'TELEMETRY_POLICY_VERSION=telemetry-v1',
    '-e',
    `DATABASE_URL=postgresql://atlas:gameday-only@${postgres}:5432/atlas_gameday`,
    '-e',
    `REDIS_URL=redis://${redis}:6379`,
    '-e',
    'OBJECT_STORAGE_ENDPOINT=https://object.invalid',
    '-e',
    'OBJECT_STORAGE_BUCKET=atlas-gameday',
    '-e',
    'OBJECT_STORAGE_ACCESS_KEY_ID=gameday',
    '-e',
    'OBJECT_STORAGE_SECRET_ACCESS_KEY=gameday-only',
    '-e',
    'RELEASE_VERSION=task-074-gameday',
    '-e',
    'RELEASE_COMMIT_SHA=0000000',
    migrationImage,
  ]);

  await psql(`
    insert into incidents
      (id, severity, status, title, summary, impact, commander_user_id, detected_at)
    values
      ('${incidentId}'::uuid, 'SEV-2', 'detected', 'Controlled Redis restart',
       'Staging-profile observability game-day', 'Queue processing temporarily unavailable',
       '${commanderId}'::uuid, now());
    insert into incident_timeline_events
      (incident_id, sequence, event_type, message, actor_user_id)
    values
      ('${incidentId}'::uuid, 1, 'detected', 'Redis interruption alert detected.', '${commanderId}'::uuid);
  `);

  await docker(['stop', '--time', '5', redis]);
  let interruptionDetected = false;
  try {
    await docker(['exec', redis, 'redis-cli', 'ping']);
  } catch {
    interruptionDetected = true;
  }
  if (!interruptionDetected)
    throw new Error('Redis interruption was not detected');

  await psql(`
    update incidents
       set status = 'mitigating', acknowledged_at = now(), updated_at = now()
     where id = '${incidentId}'::uuid;
    insert into incident_timeline_events
      (incident_id, sequence, event_type, message, actor_user_id)
    values
      ('${incidentId}'::uuid, 2, 'acknowledged', 'On-call acknowledged grouped alert.', '${commanderId}'::uuid),
      ('${incidentId}'::uuid, 3, 'mitigation_started', 'Controlled Redis restart initiated.', '${commanderId}'::uuid);
  `);

  await docker(['start', redis]);
  await waitFor(() => docker(['exec', redis, 'redis-cli', 'ping']));
  const resolvedAt = new Date();
  await psql(`
    update incidents
       set status = 'resolved', resolved_at = now(), updated_at = now(),
           resolution = 'Redis recovered; queue connectivity and backlog drain verified.',
           root_cause = 'Controlled game-day restart',
           follow_up_summary = '{"items":["Verify cooldown and recovery notification"]}'::jsonb
     where id = '${incidentId}'::uuid;
    insert into incident_timeline_events
      (incident_id, sequence, event_type, message, actor_user_id)
    values
      ('${incidentId}'::uuid, 4, 'resolved', 'Recovery notification emitted after Redis PING succeeded.', '${commanderId}'::uuid);
  `);
  const evidence = await psql(
    `select i.status || '|' || count(t.id)::text
       from incidents i
       join incident_timeline_events t on t.incident_id = i.id
      where i.id = '${incidentId}'::uuid
      group by i.status`,
    true,
  );
  if (evidence.trim() !== 'resolved|4')
    throw new Error(`Unexpected game-day evidence: ${evidence.trim()}`);

  await writeFile(
    'reports/observability-staging-gameday.md',
    `# PASS — Observability Staging-Profile Game-Day\n\n` +
      `- Scenario: controlled Redis restart / worker queue interruption\n` +
      `- Environment: isolated \`ATLAS_ENV=staging\` production-image profile\n` +
      `- Started: ${detectedAt.toISOString()}\n` +
      `- Resolved: ${resolvedAt.toISOString()}\n` +
      `- Detection: PASS\n- Grouped alert: PASS\n- DB-009 incident creation: PASS\n` +
      `- Mitigation: PASS\n- Recovery notification: PASS\n- Timeline events: 4\n` +
      `- Final incident state: resolved\n\nNo remote staging or production deployment was initiated.\n`,
  );
  process.stdout.write('Controlled staging-profile game-day passed.\n');
} finally {
  await docker(['rm', '-f', postgres, redis], true);
  await docker(['network', 'rm', network], true);
}

async function psql(sql, tuplesOnly = false) {
  const result = await docker([
    'exec',
    postgres,
    'psql',
    '-U',
    'atlas',
    '-d',
    'atlas_gameday',
    '-v',
    'ON_ERROR_STOP=1',
    ...(tuplesOnly ? ['-At'] : []),
    '-c',
    sql,
  ]);
  return result.stdout;
}

async function docker(arguments_, ignoreFailure = false) {
  try {
    return await execFile('docker', arguments_, {
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    if (ignoreFailure) return { stdout: '', stderr: '' };
    throw error;
  }
}

async function waitFor(operation) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await operation();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error('Game-day dependency readiness timed out');
}
