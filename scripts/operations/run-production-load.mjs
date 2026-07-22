import process from 'node:process';

import {
  LatencyHistogram,
  LOAD_SCENARIOS,
  bearer,
  environmentEvidence,
  idempotencyHeaders,
  parseArguments,
  percentile,
  ratioGrowth,
  readJson,
  requiredEnvironment,
  round,
  statistics,
  substitute,
  timedFetch,
  validateFixture,
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
let report;

try {
  const fixture = await readJson(fixturePath);
  validateFixture(fixture, thresholds);
  if (arguments_.validate === true) {
    process.stdout.write(
      `Production resilience fixture is valid: ${fixturePath}\n`,
    );
    process.exit(0);
  }
  const selected = arguments_.scenario ?? 'all';
  const scenarios = selected === 'all' ? LOAD_SCENARIOS : [selected];
  if (scenarios.some((scenario) => !LOAD_SCENARIOS.includes(scenario)))
    throw new Error(`UNKNOWN_LOAD_SCENARIO:${selected}`);
  const runtime = resolveRuntime(fixture);
  const evidence = await environmentEvidence(fixture.imageDigest);
  const results = [];
  for (const scenario of scenarios) {
    results.push(await runScenario(scenario, fixture, runtime, thresholds));
  }
  const failures = results.flatMap((result) => result.failures);
  report = {
    environment: evidence,
    fixture: {
      environment: fixture.environment,
      fixtureVersion: fixture.fixtureVersion,
      resourceNames: Object.keys(fixture.resources).sort(),
    },
    generatedAt: new Date().toISOString(),
    policyVersion: thresholds.policyVersion,
    scenarios: results,
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    summary: { failed: failures.length, invariantFailures: failures.length },
  };
  await persist(report);
  if (failures.length > 0) {
    process.stderr.write(
      `Production load validation FAIL: ${failures.join(', ')}\n`,
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `Production load validation PASS (${scenarios.join(', ')}).\n`,
    );
  }
} catch (error) {
  report = {
    generatedAt: new Date().toISOString(),
    policyVersion: thresholds.policyVersion,
    scenarios: [],
    status: 'FAIL',
    summary: {
      failed: 1,
      invariantFailures: 1,
      reason: safeError(error),
    },
  };
  await persist(report);
  process.stderr.write(
    `Production load validation FAIL: ${safeError(error)}\n`,
  );
  process.exitCode = 1;
}

async function runScenario(name, fixture, runtime, contracts) {
  const contract =
    name === 'read-load'
      ? contracts.readLoad
      : name === 'mixed'
        ? contracts.mixed
        : contracts.soak;
  const durationSeconds = durationFor(name, contract.minimumDurationSeconds);
  const concurrency = concurrencyFor(name, contract.minimumConcurrency);
  const startedAt = new Date();
  const deadline = performance.now() + durationSeconds * 1000;
  const routes = fixture.readRequests;
  const mixed = name === 'mixed' ? fixture.mixedRequests : [];
  const requests = [...routes, ...mixed];
  const histograms = new Map(
    requests.map(({ id }) => [id, new LatencyHistogram()]),
  );
  const errorsByRequest = new Map(requests.map(({ id }) => [id, 0]));
  const firstWindow = new LatencyHistogram();
  const lastWindow = new LatencyHistogram();
  let total = 0;
  let errors = 0;
  const snapshots = [await diagnosticSnapshot(fixture, runtime)];
  const ownershipFailures = await checkOwnership(fixture, runtime);
  let nextSnapshotAt = performance.now() + 15_000;

  await Promise.all(
    Array.from({ length: concurrency }, (_, worker) =>
      workerLoop(worker, async (request, elapsedRatio) => {
        const result = await executeRequest(request, fixture, runtime);
        histograms.get(request.id).add(result.durationMs);
        if (elapsedRatio <= 0.1) firstWindow.add(result.durationMs);
        if (elapsedRatio >= 0.9) lastWindow.add(result.durationMs);
        total += 1;
        if (result.error !== null) {
          errors += 1;
          errorsByRequest.set(
            request.id,
            (errorsByRequest.get(request.id) ?? 0) + 1,
          );
        }
        if (performance.now() >= nextSnapshotAt) {
          nextSnapshotAt += 15_000;
          snapshots.push(await diagnosticSnapshot(fixture, runtime));
        }
      }),
    ),
  );
  snapshots.push(await waitForQueueRecovery(fixture, runtime, contracts.mixed));
  const routeResults = Object.fromEntries(
    [...histograms].map(([id, histogram]) => {
      const snapshot = histogram.snapshot();
      const routeErrors = errorsByRequest.get(id) ?? 0;
      return [
        id,
        {
          ...snapshot,
          errorCount: routeErrors,
          errorRate: snapshot.count === 0 ? 1 : routeErrors / snapshot.count,
        },
      ];
    }),
  );
  const errorRate = total === 0 ? 1 : errors / total;
  const failures = [...ownershipFailures];
  const readContract = contracts.readLoad.routes;
  for (const [id, routeContract] of Object.entries(readContract)) {
    const measured = routeResults[id];
    if (!measured || measured.count === 0) failures.push(`NO_REQUESTS:${id}`);
    else if (measured.p95Ms > routeContract.p95Ms)
      failures.push(`P95_THRESHOLD:${id}`);
  }
  if (errorRate >= contract.maximumErrorRate)
    failures.push('ERROR_RATE_THRESHOLD');
  for (const [id, measured] of Object.entries(routeResults)) {
    if (measured.errorRate >= contract.maximumErrorRate)
      failures.push(`ROUTE_ERROR_RATE:${id}`);
  }
  failures.push(...diagnosticFailures(name, snapshots, contracts));
  if (name === 'soak') {
    const first = firstWindow.snapshot().p95Ms;
    const last = lastWindow.snapshot().p95Ms;
    if (ratioGrowth(first, last) > contract.maximumLatencyDriftRatio)
      failures.push('LATENCY_DRIFT');
  }
  return {
    concurrency,
    diagnostics: summarizeDiagnostics(snapshots),
    durationSeconds: round((Date.now() - startedAt.getTime()) / 1000),
    errorCount: errors,
    errorRate: round(errorRate),
    failures,
    finishedAt: new Date().toISOString(),
    name,
    requestCount: total,
    routes: routeResults,
    startedAt: startedAt.toISOString(),
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    threshold: { ...contract, routes: readContract },
    warmCold:
      name === 'read-load'
        ? 'cold start followed by sustained warm traffic'
        : 'sustained mixed traffic',
  };

  async function workerLoop(worker, operation) {
    let iteration = worker;
    while (performance.now() < deadline) {
      const request = requests[iteration % requests.length];
      const elapsedRatio =
        1 -
        Math.max(0, deadline - performance.now()) / (durationSeconds * 1000);
      await operation(request, elapsedRatio);
      iteration += concurrency;
    }
  }
}

async function executeRequest(request, fixture, runtime) {
  const method = request.method ?? 'GET';
  const token = runtime.tokens[request.token ?? 'primary'];
  const headers = {
    ...bearer(token),
    ...(method === 'GET'
      ? {}
      : { 'content-type': 'application/json', ...idempotencyHeaders() }),
  };
  let body;
  if (request.bodyEnv !== undefined)
    body = requiredEnvironment(request.bodyEnv);
  const url =
    request.urlEnv === undefined
      ? `${fixture.baseUrl}${substitute(request.path, fixture.resources)}`
      : safeStagingWorkloadUrl(requiredEnvironment(request.urlEnv));
  return timedFetch(
    url,
    { body, headers, method },
    request.expectedStatuses ?? (method === 'GET' ? [200] : [200, 201, 202]),
  );
}

async function checkOwnership(fixture, runtime) {
  const failures = [];
  for (const check of fixture.ownershipChecks) {
    const token = runtime.tokens[check.token ?? 'secondary'];
    const result = await timedFetch(
      `${fixture.baseUrl}${substitute(check.path, fixture.resources)}`,
      { headers: bearer(token) },
      [401, 403, 404],
    );
    if (result.error !== null) failures.push(`CROSS_USER_LEAKAGE:${check.id}`);
  }
  return failures;
}

async function diagnosticSnapshot(fixture, runtime) {
  const result = await timedFetch(
    fixture.diagnostics.snapshotUrl,
    { headers: bearer(runtime.tokens.metrics) },
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
  for (const name of [
    'queueLagMs',
    'dbPoolActive',
    'dbPoolMax',
    'dbPoolWaiting',
    'cpuUtilization',
    'memoryBytes',
    'connectionCount',
    'cacheBytes',
    'openFileDescriptors',
    'logBytes',
    'metricSamples',
    'workerThroughputPerSecond',
    'redisConnections',
    'redisMemoryBytes',
    'dbQueryP95Ms',
    'redisOperationP95Ms',
    'duplicateResults',
    'duplicateFills',
    'duplicateChildRuns',
    'durableResultLoss',
    'pendingSyntheticJobs',
    'cancellationLatencyP95Ms',
  ]) {
    if (!Number.isFinite(snapshot[name]))
      throw new Error(`DIAGNOSTIC_FIELD_REQUIRED:${name}`);
  }
  if (typeof snapshot.redisSaturated !== 'boolean')
    throw new Error('DIAGNOSTIC_FIELD_REQUIRED:redisSaturated');
  return { ...snapshot, capturedAt: new Date().toISOString() };
}

async function waitForQueueRecovery(fixture, runtime, contract) {
  const started = performance.now();
  while (
    performance.now() - started <=
    contract.maximumQueueRecoverySeconds * 1000
  ) {
    const snapshot = await diagnosticSnapshot(fixture, runtime);
    if (
      snapshot.queueLagMs <= contract.maximumQueueLagMs &&
      snapshot.pendingSyntheticJobs === 0
    )
      return {
        ...snapshot,
        queueRecoverySeconds: round((performance.now() - started) / 1000),
      };
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  const snapshot = await diagnosticSnapshot(fixture, runtime);
  return { ...snapshot, queueRecoverySeconds: Number.POSITIVE_INFINITY };
}

function diagnosticFailures(name, snapshots, contracts) {
  const failures = [];
  const mixed = contracts.mixed;
  const maximumLag =
    name === 'soak'
      ? contracts.soak.maximumQueueLagMs
      : mixed.maximumQueueLagMs;
  if (Math.max(...snapshots.map(({ queueLagMs }) => queueLagMs)) > maximumLag)
    failures.push('QUEUE_LAG_UNBOUNDED');
  if (snapshots.some(({ redisSaturated }) => redisSaturated))
    failures.push('REDIS_SATURATION');
  if (
    Math.max(...snapshots.map(({ dbPoolWaiting }) => dbPoolWaiting)) >
    mixed.maximumDbPoolWaiting
  )
    failures.push('DB_POOL_WAITING');
  if (
    Math.max(...snapshots.map((item) => item.dbPoolActive / item.dbPoolMax)) >=
    mixed.maximumDbPoolUtilization
  )
    failures.push('DB_POOL_SATURATION');
  const last = snapshots.at(-1);
  if (!Number.isFinite(last.queueRecoverySeconds))
    failures.push('QUEUE_RECOVERY_TIMEOUT');
  if (last.duplicateResults !== 0) failures.push('DUPLICATE_RESULT');
  if (last.duplicateFills !== 0) failures.push('DUPLICATE_FILL');
  if (last.duplicateChildRuns !== 0) failures.push('DUPLICATE_CHILD_RUN');
  if (last.durableResultLoss !== 0) failures.push('DURABLE_RESULT_LOSS');
  if (last.pendingSyntheticJobs !== 0) failures.push('NON_TERMINAL_WORKLOAD');
  if (last.cancellationLatencyP95Ms > mixed.maximumCancellationP95Ms)
    failures.push('CANCELLATION_LATENCY');
  if (name === 'soak') {
    const first = snapshots[0];
    for (const [field, threshold, code] of [
      ['memoryBytes', contracts.soak.maximumMemoryGrowthRatio, 'MEMORY_LEAK'],
      [
        'connectionCount',
        contracts.soak.maximumConnectionGrowthRatio,
        'CONNECTION_LEAK',
      ],
      ['cacheBytes', contracts.soak.maximumCacheGrowthRatio, 'CACHE_GROWTH'],
      [
        'openFileDescriptors',
        contracts.soak.maximumFileDescriptorGrowthRatio,
        'FILE_DESCRIPTOR_LEAK',
      ],
    ]) {
      if (ratioGrowth(first[field], last[field]) > threshold)
        failures.push(code);
    }
  }
  return failures;
}

function summarizeDiagnostics(snapshots) {
  const first = snapshots[0];
  const last = snapshots.at(-1);
  return {
    cacheGrowthRatio: roundFinite(
      ratioGrowth(first.cacheBytes, last.cacheBytes),
    ),
    cancellationLatencyP95Ms: last.cancellationLatencyP95Ms,
    cpu: statistics(snapshots.map(({ cpuUtilization }) => cpuUtilization)),
    dbPool: {
      maximumActive: Math.max(
        ...snapshots.map(({ dbPoolActive }) => dbPoolActive),
      ),
      maximumUtilization: round(
        Math.max(
          ...snapshots.map((item) => item.dbPoolActive / item.dbPoolMax),
        ),
      ),
      maximumWaiting: Math.max(
        ...snapshots.map(({ dbPoolWaiting }) => dbPoolWaiting),
      ),
    },
    dbQueryP95Ms: statistics(snapshots.map(({ dbQueryP95Ms }) => dbQueryP95Ms)),
    duplicateResults: last.duplicateResults,
    duplicateFills: last.duplicateFills,
    duplicateChildRuns: last.duplicateChildRuns,
    durableResultLoss: last.durableResultLoss,
    fileDescriptorGrowthRatio: roundFinite(
      ratioGrowth(first.openFileDescriptors, last.openFileDescriptors),
    ),
    logBytes: { first: first.logBytes, last: last.logBytes },
    memoryGrowthRatio: roundFinite(
      ratioGrowth(first.memoryBytes, last.memoryBytes),
    ),
    memoryBytes: {
      first: first.memoryBytes,
      maximum: Math.max(...snapshots.map(({ memoryBytes }) => memoryBytes)),
      last: last.memoryBytes,
    },
    metricSamples: { first: first.metricSamples, last: last.metricSamples },
    queueLagMs: statistics(snapshots.map(({ queueLagMs }) => queueLagMs)),
    queueRecoverySeconds: last.queueRecoverySeconds,
    redisSaturated: snapshots.some(({ redisSaturated }) => redisSaturated),
    redis: {
      connections: statistics(
        snapshots.map(({ redisConnections }) => redisConnections),
      ),
      memoryBytes: {
        first: first.redisMemoryBytes,
        last: last.redisMemoryBytes,
        maximum: Math.max(
          ...snapshots.map(({ redisMemoryBytes }) => redisMemoryBytes),
        ),
      },
      operationP95Ms: statistics(
        snapshots.map(({ redisOperationP95Ms }) => redisOperationP95Ms),
      ),
      saturated: snapshots.some(({ redisSaturated }) => redisSaturated),
    },
    samples: snapshots.length,
    workerThroughputPerSecond: statistics(
      snapshots.map(
        ({ workerThroughputPerSecond }) => workerThroughputPerSecond,
      ),
    ),
  };
}

function resolveRuntime(fixture) {
  return {
    tokens: {
      metrics: requiredEnvironment(
        fixture.diagnostics.tokenEnv ?? fixture.auth.metricsTokenEnv,
      ),
      operations: requiredEnvironment(fixture.auth.operationsTokenEnv),
      primary: requiredEnvironment(fixture.auth.primaryTokenEnv),
      secondary: requiredEnvironment(fixture.auth.secondaryTokenEnv),
    },
  };
}

function durationFor(name, minimum) {
  const configured =
    process.env[
      `ATLAS_${name.replaceAll('-', '_').toUpperCase()}_DURATION_SECONDS`
    ];
  if (configured === undefined) return minimum;
  const value = Number(configured);
  if (!Number.isInteger(value) || value < minimum)
    throw new Error(`DURATION_BELOW_CONTRACT:${name}`);
  return value;
}

function concurrencyFor(name, minimum) {
  const configured =
    process.env[`ATLAS_${name.replaceAll('-', '_').toUpperCase()}_CONCURRENCY`];
  if (configured === undefined) return minimum;
  const value = Number(configured);
  if (!Number.isInteger(value) || value < minimum)
    throw new Error(`CONCURRENCY_BELOW_CONTRACT:${name}`);
  return value;
}

async function persist(value) {
  await writeReports({
    jsonPath: 'reports/performance/production-load.json',
    markdownPath: 'reports/performance/production-load.md',
    markdown: markdown(value),
    report: value,
  });
}

function markdown(value) {
  const lines = [
    `# ${value.status} — Production Load Validation`,
    '',
    `Generated: ${value.generatedAt}`,
    '',
    `Environment: ${value.environment === undefined ? 'not configured' : `${value.fixture.environment}; commit ${value.environment.commitSha}; image ${value.environment.imageDigest}; Node ${value.environment.nodeVersion}; pnpm ${value.environment.pnpmVersion}`}`,
    '',
    '<!-- prettier-ignore -->',
    '| Scenario | Duration | Concurrency | Requests | p50 | p95 | p99 | Error rate | Queue lag p95 | DB pool max | Redis saturation | Result |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |',
  ];
  for (const scenario of value.scenarios) {
    const aggregate = aggregateRouteStats(scenario.routes);
    lines.push(
      `| ${scenario.name} | ${scenario.durationSeconds}s | ${scenario.concurrency} | ${scenario.requestCount} | ${aggregate.p50Ms ?? 'n/a'} ms | ${aggregate.p95Ms ?? 'n/a'} ms | ${aggregate.p99Ms ?? 'n/a'} ms | ${(scenario.errorRate * 100).toFixed(3)}% | ${scenario.diagnostics.queueLagMs.p95Ms ?? 'n/a'} ms | ${(scenario.diagnostics.dbPool.maximumUtilization * 100).toFixed(2)}% | ${String(scenario.diagnostics.redisSaturated)} | ${scenario.status} |`,
    );
    lines.push(
      '',
      '<!-- prettier-ignore -->',
      '| Route | Requests | p50 | p95 | p99 | Max | Threshold | Result |',
      '| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
    );
    for (const [id, route] of Object.entries(scenario.routes)) {
      const configuredThreshold =
        scenario.threshold.routes[id] === undefined
          ? 'error rate/invariants'
          : `${scenario.threshold.routes[id].p95Ms} ms`;
      const pass =
        !scenario.failures.includes(`P95_THRESHOLD:${id}`) &&
        !scenario.failures.includes(`ROUTE_ERROR_RATE:${id}`);
      lines.push(
        `| ${id} | ${route.count} | ${route.p50Ms ?? 'n/a'} ms | ${route.p95Ms ?? 'n/a'} ms | ${route.p99Ms ?? 'n/a'} ms | ${route.maxMs ?? 'n/a'} ms | ${configuredThreshold} | ${pass ? 'PASS' : 'FAIL'} |`,
      );
    }
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
    'Threshold and fixture reductions are rejected by the runner. Missing diagnostics, scenarios, or invariants return a non-zero exit.',
  );
  return `${lines.join('\n')}\n`;
}

function aggregateRouteStats(routes) {
  const values = Object.values(routes ?? {});
  return {
    p50Ms: percentile(
      values.map(({ p50Ms }) => p50Ms).filter(Number.isFinite),
      0.5,
    ),
    p95Ms: percentile(
      values.map(({ p95Ms }) => p95Ms).filter(Number.isFinite),
      0.95,
    ),
    p99Ms: percentile(
      values.map(({ p99Ms }) => p99Ms).filter(Number.isFinite),
      0.99,
    ),
  };
}

function roundFinite(value) {
  return Number.isFinite(value) ? round(value) : 'Infinity';
}

function safeError(error) {
  if (
    error instanceof Error &&
    error.message.includes('production-staging-v1.json')
  )
    return 'STAGING_FIXTURE_NOT_CONFIGURED';
  return error instanceof Error
    ? error.message.replaceAll(
        /(?:postgres(?:ql)?|redis):\/\/[^\s]+/giu,
        '[REDACTED_CONNECTION_STRING]',
      )
    : 'UNKNOWN_ERROR';
}

function safeStagingWorkloadUrl(value) {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  if (
    (!hostname.includes('staging') &&
      !['127.0.0.1', 'localhost'].includes(hostname)) ||
    /\bprod(?:uction)?\b/u.test(hostname)
  )
    throw new Error('STAGING_WORKLOAD_URL_REQUIRED');
  return url.toString();
}
