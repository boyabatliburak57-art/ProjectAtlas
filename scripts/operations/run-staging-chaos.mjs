import process from 'node:process';

import {
  CHAOS_SCENARIOS,
  assertStagingTarget,
  bearer,
  environmentEvidence,
  materializeCommand,
  parseArguments,
  readJson,
  requiredEnvironment,
  round,
  run,
  statistics,
  timedFetch,
  validateAdapter,
  writeReports,
} from './resilience-core.mjs';

const arguments_ = parseArguments(process.argv.slice(2));
const thresholds = await readJson(
  'performance/thresholds/production-resilience.json',
);
const fixturePath =
  arguments_.fixture ??
  process.env.ATLAS_RESILIENCE_FIXTURE ??
  'performance/fixtures/production-staging-v1.json';
const adapterPath =
  arguments_.adapter ??
  process.env.ATLAS_CHAOS_ADAPTER ??
  'deploy/chaos/staging-adapter.json';

let report;
try {
  const [fixture, adapter] = await Promise.all([
    readJson(fixturePath),
    readJson(adapterPath),
  ]);
  assertStagingTarget(fixture);
  const selected = arguments_.scenario ?? 'all';
  const scenarios = selected === 'all' ? CHAOS_SCENARIOS : [selected];
  if (scenarios.some((scenario) => !CHAOS_SCENARIOS.includes(scenario)))
    throw new Error(`UNKNOWN_CHAOS_SCENARIO:${selected}`);
  validateAdapter(adapter, scenarios);
  if (arguments_.validate === true) {
    process.stdout.write(`Staging chaos adapter is valid: ${adapterPath}\n`);
    process.exit(0);
  }
  if (
    requiredEnvironment('ATLAS_STAGING_CHAOS_APPROVAL') !==
    'TASK-078-STAGING-ONLY'
  )
    throw new Error('EXPLICIT_STAGING_CHAOS_APPROVAL_REQUIRED');
  await verifyKubectlContext(adapter);
  const tokens = {
    metrics: requiredEnvironment(
      fixture.diagnostics.tokenEnv ?? fixture.auth.metricsTokenEnv,
    ),
    primary: requiredEnvironment(fixture.auth.primaryTokenEnv),
  };
  const results = [];
  for (const scenario of scenarios) {
    results.push(await runScenario(scenario, fixture, adapter, tokens));
  }
  const evidence = await environmentEvidence(fixture.imageDigest);
  const failures = results.flatMap(({ failures }) => failures);
  report = {
    adapter: {
      adapterVersion: adapter.adapterVersion,
      context: adapter.context,
      namespace: adapter.namespace,
    },
    environment: evidence,
    generatedAt: new Date().toISOString(),
    policyVersion: thresholds.policyVersion,
    scenarios: results,
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    summary: { failed: failures.length, invariantFailures: failures.length },
  };
  await persist(report);
  if (failures.length > 0) {
    process.stderr.write(
      `Staging chaos validation FAIL: ${failures.join(', ')}\n`,
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `Staging chaos validation PASS (${scenarios.join(', ')}).\n`,
    );
  }
} catch (error) {
  report = {
    generatedAt: new Date().toISOString(),
    policyVersion: thresholds.policyVersion,
    scenarios: [],
    status: 'FAIL',
    summary: { failed: 1, invariantFailures: 1, reason: safeError(error) },
  };
  await persist(report);
  process.stderr.write(`Staging chaos validation FAIL: ${safeError(error)}\n`);
  process.exitCode = 1;
}

async function runScenario(name, fixture, adapter, tokens) {
  const definition = adapter.scenarios[name];
  const startedAt = new Date();
  const failures = [];
  const pre = await diagnosticSnapshot(fixture, tokens);
  await healthProbe(fixture, tokens, true);
  let faultApplied = false;
  let faultError;
  let recoveryError;
  let during;
  let after;
  const recoveryStarted = performance.now();
  try {
    await execute(definition.fault, adapter);
    faultApplied = true;
    during = await diagnosticSnapshot(fixture, tokens);
  } catch (error) {
    faultError = safeError(error);
    failures.push(`FAULT_EXECUTION:${name}`);
  } finally {
    try {
      await execute(definition.recovery, adapter);
    } catch (error) {
      recoveryError = safeError(error);
      failures.push(`RECOVERY_EXECUTION:${name}`);
    }
  }
  if (faultApplied && recoveryError === undefined) {
    after = await waitForRecovery(name, fixture, tokens);
    failures.push(...scenarioFailures(name, during, after));
  }
  const recoverySeconds = round((performance.now() - recoveryStarted) / 1000);
  if (recoverySeconds > thresholds.chaos.maximumRecoverySeconds[name])
    failures.push(`RECOVERY_TIME:${name}`);
  return {
    commandEvidence: {
      faultExecutable: definition.fault[0],
      recoveryExecutable: definition.recovery[0],
    },
    concurrency:
      during?.activeWorkloadConcurrency ?? pre.activeWorkloadConcurrency,
    cpu: {
      before: pre.cpuUtilization,
      during: during?.cpuUtilization,
      after: after?.cpuUtilization,
    },
    db: {
      before: pre.dbPoolActive,
      during: during?.dbPoolActive,
      after: after?.dbPoolActive,
      queryP95Ms: after?.dbQueryP95Ms,
      waitingAfter: after?.dbPoolWaiting,
    },
    durationSeconds: round((Date.now() - startedAt.getTime()) / 1000),
    errorRate: after?.errorRate ?? 1,
    failures,
    faultError,
    finishedAt: new Date().toISOString(),
    invariantFailures: failures.length,
    latency:
      after === undefined
        ? statistics([])
        : {
            count: after.apiLatencySampleCount,
            maxMs: after.apiMaxMs,
            p50Ms: after.apiP50Ms,
            p95Ms: after.apiP95Ms,
            p99Ms: after.apiP99Ms,
          },
    memoryBytes: {
      before: pre.memoryBytes,
      during: during?.memoryBytes,
      after: after?.memoryBytes,
    },
    name,
    queueLagMs: {
      before: pre.queueLagMs,
      during: during?.queueLagMs,
      after: after?.queueLagMs,
    },
    recoveryError,
    recoverySeconds,
    redis: {
      before: pre.redisSaturated,
      during: during?.redisSaturated,
      after: after?.redisSaturated,
      connectionsAfter: after?.redisConnections,
      memoryBytesAfter: after?.redisMemoryBytes,
      operationP95Ms: after?.redisOperationP95Ms,
    },
    startedAt: startedAt.toISOString(),
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    threshold: {
      maximumInvariantFailures: thresholds.chaos.maximumInvariantFailures,
      maximumRecoverySeconds: thresholds.chaos.maximumRecoverySeconds[name],
    },
    workload: during?.workload ?? pre.workload,
  };
}

async function execute(command, adapter) {
  const [executable, ...arguments_] = materializeCommand(command, adapter);
  await run(executable, arguments_, {
    env: {
      ...process.env,
      ATLAS_CHAOS_ENVIRONMENT: 'staging',
      ATLAS_CHAOS_NAMESPACE: adapter.namespace,
    },
    timeout: 10 * 60_000,
  });
}

async function waitForRecovery(name, fixture, tokens) {
  const timeoutSeconds = thresholds.chaos.maximumRecoverySeconds[name];
  const deadline = performance.now() + timeoutSeconds * 1000;
  let last;
  while (performance.now() <= deadline) {
    last = await diagnosticSnapshot(fixture, tokens);
    const healthy = await healthProbe(fixture, tokens, false);
    if (healthy && last.recovered === true && last.pendingSyntheticJobs === 0)
      return last;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return last ?? diagnosticSnapshot(fixture, tokens);
}

function scenarioFailures(name, during, after) {
  const failures = [];
  const expect = (condition, code) => {
    if (!condition) failures.push(code);
  };
  expect(after.recovered === true, 'RECOVERY_NOT_OBSERVED');
  expect(after.pendingSyntheticJobs === 0, 'NON_TERMINAL_JOB');
  expect(after.durableResultLoss === 0, 'DURABLE_RESULT_LOSS');
  expect(after.duplicateResults === 0, 'DUPLICATE_RESULT');
  expect(after.duplicateFills === 0, 'DUPLICATE_FILL');
  expect(after.databaseCorruption === 0, 'DATABASE_CORRUPTION');
  expect(
    after.errorRate < thresholds.chaos.maximumErrorRate,
    'ERROR_RATE_THRESHOLD',
  );
  if (name === 'redis-restart') {
    expect(during.apiFallback === true, 'API_FALLBACK');
    expect(after.workerReconciled === true, 'WORKER_RECONCILIATION');
    expect(after.cacheRebuilt === true, 'CACHE_REBUILD');
  } else if (name === 'worker-kill') {
    expect(after.checkpointRecovered === true, 'CHECKPOINT_RECOVERY');
    expect(after.terminalStateReached === true, 'TERMINAL_STATE');
  } else if (name === 'postgres-interruption') {
    expect(during.readinessFalseObserved === true, 'READINESS_DID_NOT_FAIL');
    expect(during.boundedRetry === true, 'UNBOUNDED_RETRY');
    expect(during.queueBackpressure === true, 'QUEUE_BACKPRESSURE');
  } else if (name === 'object-storage') {
    expect(during.userVisibleFailure === true, 'USER_STATUS_MISSING');
    expect(after.artifactRetrySucceeded === true, 'ARTIFACT_RETRY');
  } else if (name === 'rollback') {
    expect(during.rolloutStopped === true, 'ROLLOUT_NOT_STOPPED');
    expect(after.rollbackHealthy === true, 'ROLLBACK_UNHEALTHY');
    expect(after.migrationCompatible === true, 'MIGRATION_INCOMPATIBLE');
    expect(after.syntheticPassed === true, 'RECOVERY_SYNTHETIC');
  } else if (name === 'stale-market-data') {
    expect(during.freshnessAlertFired === true, 'FRESHNESS_ALERT');
    expect(during.staleBannerVisible === true, 'STALE_BANNER');
    expect(during.scannerStalePolicyApplied === true, 'SCANNER_STALE_POLICY');
    expect(during.alertStalePolicyApplied === true, 'ALERT_STALE_POLICY');
    expect(during.falseFreshness === 0, 'FALSE_FRESHNESS');
  }
  return failures;
}

async function diagnosticSnapshot(fixture, tokens) {
  const result = await timedFetch(
    fixture.diagnostics.snapshotUrl,
    { headers: bearer(tokens.metrics) },
    [200],
  );
  if (
    result.error !== null ||
    typeof result.body !== 'object' ||
    result.body === null
  )
    throw new Error(
      `DIAGNOSTICS_UNAVAILABLE:${result.error ?? 'INVALID_BODY'}`,
    );
  const snapshot = result.body.data ?? result.body;
  for (const field of [
    'apiP50Ms',
    'apiP95Ms',
    'apiP99Ms',
    'apiMaxMs',
    'apiLatencySampleCount',
    'errorRate',
    'queueLagMs',
    'dbPoolActive',
    'dbPoolWaiting',
    'dbQueryP95Ms',
    'cpuUtilization',
    'memoryBytes',
    'redisConnections',
    'redisMemoryBytes',
    'redisOperationP95Ms',
    'durableResultLoss',
    'duplicateResults',
    'duplicateFills',
    'databaseCorruption',
    'pendingSyntheticJobs',
    'activeWorkloadConcurrency',
  ]) {
    if (!Number.isFinite(snapshot[field]))
      throw new Error(`DIAGNOSTIC_FIELD_REQUIRED:${field}`);
  }
  if (typeof snapshot.redisSaturated !== 'boolean')
    throw new Error('DIAGNOSTIC_FIELD_REQUIRED:redisSaturated');
  return snapshot;
}

async function healthProbe(fixture, tokens, required) {
  const result = await timedFetch(
    `${fixture.baseUrl}/health/ready`,
    { headers: bearer(tokens.primary) },
    [200],
  );
  if (required && result.error !== null)
    throw new Error('PRE_CHAOS_READINESS_FAILED');
  return result.error === null;
}

async function verifyKubectlContext(adapter) {
  const usesKubectl = Object.values(adapter.scenarios).some(
    ({ fault, recovery }) =>
      [fault, recovery].some((command) => command?.[0] === 'kubectl'),
  );
  if (!usesKubectl) return;
  const result = await run('kubectl', ['config', 'current-context']);
  if (result.stdout.trim() !== adapter.context)
    throw new Error('KUBECTL_CONTEXT_MISMATCH');
}

async function persist(value) {
  await writeReports({
    jsonPath: 'reports/resilience/staging-chaos.json',
    markdownPath: 'reports/resilience/staging-chaos.md',
    markdown: markdown(value),
    report: value,
  });
}

function markdown(value) {
  const lines = [
    `# ${value.status} — Staging Chaos Validation`,
    '',
    `Generated: ${value.generatedAt}`,
    '',
    `Environment: ${value.environment === undefined ? 'not configured' : `staging; commit ${value.environment.commitSha}; image ${value.environment.imageDigest}; context ${value.adapter.context}; namespace ${value.adapter.namespace}`}`,
    '',
    '<!-- prettier-ignore -->',
    '| Scenario | Workload | Duration | Concurrency | p50 | p95 | p99 | Error rate | Queue lag after | Recovery | Invariant failures | Result |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  ];
  for (const scenario of value.scenarios) {
    lines.push(
      `| ${scenario.name} | ${scenario.workload ?? 'n/a'} | ${scenario.durationSeconds}s | ${scenario.concurrency ?? 'n/a'} | ${scenario.latency.p50Ms ?? 'n/a'} ms | ${scenario.latency.p95Ms ?? 'n/a'} ms | ${scenario.latency.p99Ms ?? 'n/a'} ms | ${(scenario.errorRate * 100).toFixed(3)}% | ${scenario.queueLagMs.after ?? 'n/a'} ms | ${scenario.recoverySeconds}s | ${scenario.invariantFailures} | ${scenario.status} |`,
    );
    lines.push(
      '',
      `Failures: ${scenario.failures.length === 0 ? 'none' : scenario.failures.join(', ')}`,
      '',
    );
  }
  if (value.scenarios.length === 0) lines.push('');
  if (value.summary.reason)
    lines.push(`Failure reason: ${value.summary.reason}`, '');
  lines.push(
    'The runner refuses non-staging targets, unresolved adapters, shell commands, mutable image references, and absent explicit approval. Recovery is attempted in a finally block.',
  );
  return `${lines.join('\n')}\n`;
}

function safeError(error) {
  if (
    error instanceof Error &&
    error.message.includes('production-staging-v1.json')
  )
    return 'STAGING_FIXTURE_NOT_CONFIGURED';
  if (error instanceof Error && error.message.includes('staging-adapter.json'))
    return 'STAGING_CHAOS_ADAPTER_NOT_CONFIGURED';
  return error instanceof Error
    ? error.message.replaceAll(
        /(?:postgres(?:ql)?|redis):\/\/[^\s]+/giu,
        '[REDACTED_CONNECTION_STRING]',
      )
    : 'UNKNOWN_ERROR';
}
