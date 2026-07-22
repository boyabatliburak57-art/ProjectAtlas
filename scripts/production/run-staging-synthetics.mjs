import { createServer } from 'node:http';
import process from 'node:process';
import { randomUUID } from 'node:crypto';

if (process.argv.includes('--self-test')) await selfTest();
else await runFromEnvironment();

async function runFromEnvironment() {
  const baseUrl = required('SYNTHETIC_BASE_URL');
  const token = required('SYNTHETIC_BEARER_TOKEN');
  const portfolioId = required('SYNTHETIC_PORTFOLIO_ID');
  const scannerPayload = JSON.parse(required('SYNTHETIC_SCANNER_PAYLOAD'));
  const backtestPayload = JSON.parse(required('SYNTHETIC_BACKTEST_PAYLOAD'));
  const experimentPayload = JSON.parse(
    required('SYNTHETIC_EXPERIMENT_PAYLOAD'),
  );
  const adminToken = required('SYNTHETIC_ADMIN_BEARER_TOKEN');
  await runChecks({
    adminToken,
    baseUrl,
    token,
    portfolioId,
    scannerPayload,
    backtestPayload,
    experimentPayload,
  });
}

async function runChecks(input) {
  const headers = { authorization: `Bearer ${input.token}` };
  await check('health-live', `${input.baseUrl}/health/live`);
  await check('health-startup', `${input.baseUrl}/health/startup`);
  await check('health-ready', `${input.baseUrl}/health/ready`);
  await check('login-session', `${input.baseUrl}/api/v1/portfolios`, {
    headers,
  });
  await check('market-overview', `${input.baseUrl}/api/v1/market/overview`, {
    headers,
  });
  await check('watchlist-list', `${input.baseUrl}/api/v1/watchlists`, {
    headers,
  });
  await check('alert-list', `${input.baseUrl}/api/v1/alerts`, { headers });
  const scan = await check(
    'scanner-create',
    `${input.baseUrl}/api/v1/scanner/runs`,
    {
      method: 'POST',
      headers: {
        ...headers,
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
      },
      body: JSON.stringify(input.scannerPayload),
    },
  );
  await check(
    'scanner-result',
    `${input.baseUrl}/api/v1/scanner/runs/${resourceId(scan)}`,
    { headers },
  );
  await check(
    'portfolio-valuation',
    `${input.baseUrl}/api/v1/portfolios/${input.portfolioId}/valuation`,
    { headers },
  );
  const backtest = await check(
    'backtest-create',
    `${input.baseUrl}/api/v1/backtests`,
    {
      method: 'POST',
      headers: {
        ...headers,
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
      },
      body: JSON.stringify(input.backtestPayload),
    },
  );
  await check(
    'backtest-status',
    `${input.baseUrl}/api/v1/backtests/${resourceId(backtest)}`,
    { headers },
  );
  const experiment = await check(
    'experiment-create',
    `${input.baseUrl}/api/v1/experiments`,
    {
      method: 'POST',
      headers: {
        ...headers,
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
      },
      body: JSON.stringify(input.experimentPayload),
    },
  );
  await check(
    'experiment-status',
    `${input.baseUrl}/api/v1/experiments/${resourceId(experiment)}`,
    { headers },
  );
  await check(
    'admin-operations-access',
    `${input.baseUrl}/api/v1/admin/operations/overview`,
    { headers: { authorization: `Bearer ${input.adminToken}` } },
  );
  process.stdout.write(
    'Staging synthetic journeys passed (8 journeys, 15 HTTP checks).\n',
  );
}

async function check(code, url, init) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw new Error(`${code} failed with HTTP ${response.status}`);
  const body = await response.json();
  process.stdout.write(`${code}: PASS\n`);
  return body;
}

function resourceId(body) {
  const id = body?.data?.id ?? body?.data?.run?.id;
  if (typeof id !== 'string' || id.length === 0)
    throw new Error('Synthetic create response has no resource ID');
  return id;
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function selfTest() {
  const server = createServer((request, response) => {
    const body = request.url?.includes('/scanner/runs')
      ? { data: { id: 'scan-synthetic-id' } }
      : request.url === '/api/v1/backtests'
        ? { data: { id: 'backtest-synthetic-id' } }
        : request.url === '/api/v1/experiments'
          ? { data: { id: 'experiment-synthetic-id' } }
          : { data: { status: 'ok' } };
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Synthetic self-test server did not bind');
  try {
    await runChecks({
      adminToken: 'self-test-admin-token-not-logged',
      baseUrl: `http://127.0.0.1:${address.port}`,
      token: 'self-test-token-not-logged',
      portfolioId: 'portfolio-synthetic-id',
      scannerPayload: { fixture: true },
      backtestPayload: { fixture: true },
      experimentPayload: { fixture: true },
    });
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
