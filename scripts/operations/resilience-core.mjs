import { execFile as execFileCallback } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
export const ROOT = resolve(import.meta.dirname, '../..');
export const CHAOS_SCENARIOS = [
  'redis-restart',
  'worker-kill',
  'postgres-interruption',
  'object-storage',
  'rollback',
  'stale-market-data',
];
export const LOAD_SCENARIOS = ['read-load', 'mixed', 'soak'];

export function parseArguments(arguments_) {
  const parsed = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (!argument.startsWith('--'))
      throw new Error(`UNKNOWN_ARGUMENT:${argument}`);
    const equal = argument.indexOf('=');
    if (equal !== -1) {
      parsed[argument.slice(2, equal)] = argument.slice(equal + 1);
      continue;
    }
    const name = argument.slice(2);
    const value = arguments_[index + 1];
    if (value !== undefined && !value.startsWith('--')) {
      parsed[name] = value;
      index += 1;
    } else {
      parsed[name] = true;
    }
  }
  return parsed;
}

export async function readJson(path) {
  return JSON.parse(await readFile(resolve(ROOT, path), 'utf8'));
}

export function assertStagingTarget({ environment, baseUrl, imageDigest }) {
  if (environment !== 'staging')
    throw new Error('STAGING_ENVIRONMENT_REQUIRED');
  const hostname = new URL(baseUrl).hostname.toLowerCase();
  if (
    !hostname.includes('staging') &&
    !['127.0.0.1', 'localhost'].includes(hostname)
  )
    throw new Error('STAGING_HOST_REQUIRED');
  if (/\bprod(?:uction)?\b/u.test(hostname))
    throw new Error('PRODUCTION_TARGET_FORBIDDEN');
  if (!/^sha256:[a-f0-9]{64}$/u.test(imageDigest))
    throw new Error('IMMUTABLE_IMAGE_DIGEST_REQUIRED');
}

export function substitute(template, values) {
  return template.replaceAll(/\{([A-Za-z][A-Za-z0-9]*)\}/gu, (_, key) => {
    const value = values[key];
    if (typeof value !== 'string' || value.length === 0)
      throw new Error(`MISSING_FIXTURE_VALUE:${key}`);
    return encodeURIComponent(value);
  });
}

export function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(fraction * sorted.length) - 1);
  return round(sorted[index]);
}

export function statistics(values) {
  return {
    count: values.length,
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    p99Ms: percentile(values, 0.99),
    maxMs: values.length === 0 ? null : round(Math.max(...values)),
  };
}

export class LatencyHistogram {
  #buckets = new Uint32Array(30_001);
  #count = 0;
  #max = 0;

  add(durationMs) {
    const rounded = Math.min(30_000, Math.max(0, Math.ceil(durationMs)));
    this.#buckets[rounded] += 1;
    this.#count += 1;
    this.#max = Math.max(this.#max, durationMs);
  }

  snapshot() {
    return {
      count: this.#count,
      maxMs: this.#count === 0 ? null : round(this.#max),
      p50Ms: this.#quantile(0.5),
      p95Ms: this.#quantile(0.95),
      p99Ms: this.#quantile(0.99),
    };
  }

  #quantile(fraction) {
    if (this.#count === 0) return null;
    const target = Math.ceil(this.#count * fraction);
    let cumulative = 0;
    for (let index = 0; index < this.#buckets.length; index += 1) {
      cumulative += this.#buckets[index];
      if (cumulative >= target) return index;
    }
    return 30_000;
  }
}

export function round(value) {
  return Math.round(value * 100) / 100;
}

export function ratioGrowth(first, last) {
  if (!Number.isFinite(first) || !Number.isFinite(last)) return null;
  if (first === 0) return last === 0 ? 0 : Number.POSITIVE_INFINITY;
  return (last - first) / first;
}

export async function timedFetch(url, init = {}, expectedStatuses = [200]) {
  const startedAt = performance.now();
  try {
    const response = await fetch(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    return {
      body: parseMaybeJson(text),
      durationMs: performance.now() - startedAt,
      error: expectedStatuses.includes(response.status)
        ? null
        : `HTTP_${String(response.status)}`,
      status: response.status,
    };
  } catch (error) {
    return {
      body: null,
      durationMs: performance.now() - startedAt,
      error: error instanceof Error ? error.name : 'FETCH_ERROR',
      status: 0,
    };
  }
}

export function bearer(token) {
  return token === undefined ? {} : { authorization: `Bearer ${token}` };
}

export function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`MISSING_ENVIRONMENT:${name}`);
  return value;
}

export function idempotencyHeaders() {
  return { 'idempotency-key': randomUUID() };
}

export function validateFixture(fixture, thresholds) {
  assertStagingTarget(fixture);
  if (fixture.fixtureVersion !== 'production-staging-v1')
    throw new Error('UNSUPPORTED_FIXTURE_VERSION');
  const routeIds = new Set(fixture.readRequests?.map(({ id }) => id));
  for (const id of Object.keys(thresholds.readLoad.routes)) {
    if (!routeIds.has(id)) throw new Error(`MISSING_READ_ROUTE:${id}`);
  }
  const ownershipIds = new Set(
    fixture.ownershipChecks?.map(({ id }) => id) ?? [],
  );
  for (const resource of ['scanner', 'watchlist', 'portfolio', 'backtest']) {
    if (![...ownershipIds].some((id) => id.includes(resource)))
      throw new Error(`MISSING_OWNERSHIP_CHECK:${resource}`);
  }
  const mixedIds = new Set(fixture.mixedRequests?.map(({ id }) => id));
  for (const id of [
    'scannerCreate',
    'alertEvaluation',
    'portfolioRecalculate',
    'backtestCreate',
    'experimentCreate',
  ]) {
    if (!mixedIds.has(id)) throw new Error(`MISSING_MIXED_OPERATION:${id}`);
  }
  if (!fixture.diagnostics?.snapshotUrl)
    throw new Error('DIAGNOSTICS_SNAPSHOT_REQUIRED');
}

export async function environmentEvidence(imageDigest) {
  const [commit, pnpm, os, cpu, memory] = await Promise.all([
    run('git', ['rev-parse', 'HEAD']),
    run('pnpm', ['--version']),
    run('uname', ['-sr']),
    run('uname', ['-m']),
    Promise.resolve(process.memoryUsage().rss),
  ]);
  return {
    commitSha: commit.stdout.trim(),
    cpu: cpu.stdout.trim(),
    imageDigest,
    nodeVersion: process.version,
    operatingSystem: os.stdout.trim(),
    pnpmVersion: pnpm.stdout.trim(),
    runnerRssBytes: memory,
  };
}

export async function run(command, arguments_, options = {}) {
  return execFile(command, arguments_, {
    cwd: ROOT,
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  });
}

export function validateAdapter(adapter, scenarios = CHAOS_SCENARIOS) {
  if (adapter.adapterVersion !== 'atlas-staging-chaos-v1')
    throw new Error('UNSUPPORTED_CHAOS_ADAPTER_VERSION');
  if (adapter.environment !== 'staging')
    throw new Error('STAGING_ADAPTER_REQUIRED');
  if (!adapter.context || /prod(?:uction)?/iu.test(adapter.context))
    throw new Error('SAFE_STAGING_CONTEXT_REQUIRED');
  if (!adapter.namespace || /prod(?:uction)?/iu.test(adapter.namespace))
    throw new Error('SAFE_STAGING_NAMESPACE_REQUIRED');
  if (
    !Array.isArray(adapter.allowedExecutables) ||
    adapter.allowedExecutables.length === 0
  )
    throw new Error('CHAOS_EXECUTABLE_ALLOWLIST_REQUIRED');
  for (const scenario of scenarios) {
    const definition = adapter.scenarios?.[scenario];
    for (const phase of ['fault', 'recovery']) {
      const command = definition?.[phase];
      if (!Array.isArray(command) || command.length < 2)
        throw new Error(`MISSING_CHAOS_COMMAND:${scenario}:${phase}`);
      if (command.some((part) => /replace-with|\$\{|\n|\r/u.test(part)))
        throw new Error(`UNRESOLVED_CHAOS_COMMAND:${scenario}:${phase}`);
      if (['sh', 'bash', 'zsh'].includes(command[0]))
        throw new Error(`SHELL_CHAOS_COMMAND_FORBIDDEN:${scenario}:${phase}`);
      if (!adapter.allowedExecutables.includes(command[0]))
        throw new Error(`CHAOS_EXECUTABLE_NOT_ALLOWED:${scenario}:${phase}`);
    }
  }
}

export function materializeCommand(command, adapter) {
  return command.map((part) =>
    part
      .replaceAll('{context}', adapter.context)
      .replaceAll('{namespace}', adapter.namespace),
  );
}

export async function writeReports({
  jsonPath,
  markdownPath,
  report,
  markdown,
}) {
  const absoluteJson = resolve(ROOT, jsonPath);
  const absoluteMarkdown = resolve(ROOT, markdownPath);
  await Promise.all([
    mkdir(dirname(absoluteJson), { recursive: true }),
    mkdir(dirname(absoluteMarkdown), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(absoluteJson, `${JSON.stringify(report, null, 2)}\n`),
    writeFile(absoluteMarkdown, markdown),
  ]);
}

export function stableHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function parseMaybeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
