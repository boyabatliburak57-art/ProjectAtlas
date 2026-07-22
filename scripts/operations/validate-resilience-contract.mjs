import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  CHAOS_SCENARIOS,
  LOAD_SCENARIOS,
  ROOT,
  readJson,
} from './resilience-core.mjs';

const [
  contract,
  scanner,
  alerts,
  portfolio,
  market,
  backtest,
  fixture,
  adapter,
  packageJson,
] = await Promise.all([
  readJson('performance/thresholds/production-resilience.json'),
  readJson('performance/thresholds/scanner-runtime.json'),
  readJson('performance/thresholds/alerts-watchlists.json'),
  readJson('performance/thresholds/portfolio-risk.json'),
  readJson('performance/thresholds/market-intelligence.json'),
  readJson('performance/thresholds/backtest.json'),
  readJson('performance/fixtures/production-staging-v1.example.json'),
  readJson('deploy/chaos/staging-adapter.example.json'),
  readJson('package.json'),
]);

assert.equal(contract.policyVersion, 'production-resilience-v1');
assert.deepEqual(Object.keys(contract.readLoad.routes).sort(), [
  'backtestSummary',
  'backtestTrades',
  'marketOverview',
  'portfolioPositions',
  'scannerResults',
  'symbolChart',
  'symbolDetail',
  'watchlistMarketSummary',
]);
assert.equal(
  contract.readLoad.routes.marketOverview.p95Ms,
  market['PERF-MKT-001'].warmP95Ms,
);
assert.equal(
  contract.readLoad.routes.symbolDetail.p95Ms,
  market['PERF-MKT-003'].p95Ms,
);
assert.equal(
  contract.readLoad.routes.symbolChart.p95Ms,
  market['PERF-MKT-004'].p95Ms,
);
assert.equal(
  contract.readLoad.routes.scannerResults.p95Ms,
  scanner['PERF-SCN-004'].p95Ms,
);
assert.equal(
  contract.readLoad.routes.watchlistMarketSummary.p95Ms,
  alerts['PERF-AWN-005'].p95Ms,
);
assert.equal(
  contract.readLoad.routes.portfolioPositions.p95Ms,
  portfolio['PERF-PORT-006'].p95Ms,
);
assert.equal(
  contract.readLoad.routes.backtestSummary.p95Ms,
  backtest['PERF-BT-004-summary'].p95Ms,
);
assert.equal(
  contract.readLoad.routes.backtestTrades.p95Ms,
  backtest['PERF-BT-004-trades'].p95Ms,
);
assert.equal(contract.readLoad.maximumErrorRate, 0.01);
assert.ok(contract.soak.minimumDurationSeconds >= 4 * 60 * 60);
assert.deepEqual(LOAD_SCENARIOS, ['read-load', 'mixed', 'soak']);
assert.deepEqual(
  Object.keys(adapter.scenarios).sort(),
  [...CHAOS_SCENARIOS].sort(),
);
assert.equal(fixture.environment, 'staging');
assert.equal(fixture.readRequests.length, 8);
assert.equal(fixture.ownershipChecks.length, 4);
assert.equal(fixture.mixedRequests.length, 5);
assert.equal(
  packageJson.scripts['perf:production'],
  'node scripts/operations/run-production-load.mjs',
);
assert.equal(
  packageJson.scripts['chaos:staging'],
  'node scripts/operations/run-staging-chaos.mjs',
);

for (const script of [
  'scripts/operations/run-production-load.mjs',
  'scripts/operations/run-staging-chaos.mjs',
]) {
  const source = await readFile(`${ROOT}/${script}`, 'utf8');
  assert.doesNotMatch(
    source,
    /--insecure|rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED/u,
  );
}

process.stdout.write(
  'Production load/chaos contract PASS: 3 load scenarios, 6 chaos scenarios, preserved feature thresholds, four-hour soak minimum.\n',
);
