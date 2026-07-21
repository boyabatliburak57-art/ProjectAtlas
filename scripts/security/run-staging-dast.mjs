import { mkdir, writeFile } from 'node:fs/promises';

const apiBaseUrl = required('DAST_API_BASE_URL').replace(/\/$/u, '');
const webBaseUrl = required('DAST_WEB_BASE_URL').replace(/\/$/u, '');
const allowedOrigin = required('DAST_ALLOWED_ORIGIN');
const results = [];

await checkHealthAndHeaders();
await checkCors();
await checkUnauthenticatedAdmin();
await checkMalformedAndAbusiveInput();
await checkBruteForceAndForwardedIpBypass();
await checkWebHeaders();

const failed = results.filter((item) => item.status === 'FAIL');
await mkdir('reports/security', { recursive: true });
await writeFile(
  'reports/security/staging-dast.json',
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      profile: 'safe-staging-api-and-browser-smoke-v1',
      summary: {
        critical: 0,
        high: failed.length,
        passed: results.length - failed.length,
      },
      results,
    },
    null,
    2,
  )}\n`,
);
await writeFile(
  'reports/security/staging-dast.md',
  `# Staging DAST Smoke\n\nResult: **${failed.length === 0 ? 'PASS' : 'FAIL'}**\n\n| Check | Result | Evidence |\n| --- | --- | --- |\n${results.map((item) => `| ${item.code} | ${item.status} | ${item.evidence.replaceAll('|', '\\|')} |`).join('\n')}\n`,
);
if (failed.length > 0) {
  process.stderr.write(
    `Staging DAST failed: ${failed.map(({ code }) => code).join(', ')}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Staging DAST PASS (${results.length} checks; Critical 0; High 0).\n`,
  );
}

async function checkHealthAndHeaders() {
  const response = await fetchWithTimeout(`${apiBaseUrl}/health/live`);
  assert('DAST-API-HEALTH', response.ok, `HTTP ${response.status}`);
  assertHeader(
    response,
    'content-security-policy',
    "frame-ancestors 'none'",
    'DAST-API-CSP',
  );
  assertHeader(
    response,
    'strict-transport-security',
    'max-age=',
    'DAST-API-HSTS',
  );
  assertHeader(
    response,
    'x-content-type-options',
    'nosniff',
    'DAST-API-NOSNIFF',
  );
  assertHeader(response, 'referrer-policy', 'no-referrer', 'DAST-API-REFERRER');
  assertHeader(
    response,
    'permissions-policy',
    'camera=()',
    'DAST-API-PERMISSIONS',
  );
  assertHeader(response, 'x-frame-options', 'DENY', 'DAST-API-FRAME');
}

async function checkCors() {
  const denied = await fetchWithTimeout(`${apiBaseUrl}/api/v1/portfolios`, {
    method: 'OPTIONS',
    headers: {
      origin: 'https://attacker.invalid',
      'access-control-request-method': 'GET',
    },
  });
  assert(
    'DAST-CORS-DENY',
    denied.headers.get('access-control-allow-origin') === null,
    `HTTP ${denied.status}; allow-origin=${denied.headers.get('access-control-allow-origin') ?? 'absent'}`,
  );
  const allowed = await fetchWithTimeout(`${apiBaseUrl}/api/v1/portfolios`, {
    method: 'OPTIONS',
    headers: { origin: allowedOrigin, 'access-control-request-method': 'GET' },
  });
  assert(
    'DAST-CORS-ALLOWLIST',
    allowed.headers.get('access-control-allow-origin') === allowedOrigin &&
      allowed.headers.get('access-control-allow-credentials') === 'true',
    `HTTP ${allowed.status}; origin=${allowed.headers.get('access-control-allow-origin') ?? 'absent'}`,
  );
  assert(
    'DAST-CORS-NO-WILDCARD-CREDENTIALS',
    allowed.headers.get('access-control-allow-origin') !== '*',
    'credentialed response has an explicit origin',
  );
}

async function checkUnauthenticatedAdmin() {
  const response = await jsonRequest(
    '/api/v1/admin/incidents',
    {
      severity: 'SEV-4',
      summary: 'DAST must not create this incident',
      title: 'DAST authorization probe',
    },
    { 'x-atlas-admin-role': 'operations_admin' },
  );
  assert(
    'DAST-ADMIN-RBAC',
    [401, 403].includes(response.status),
    `spoofed admin header returned HTTP ${response.status}`,
  );
}

async function checkMalformedAndAbusiveInput() {
  const malformed = await fetchWithTimeout(`${apiBaseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"email":',
  });
  assert(
    'DAST-MALFORMED-JSON',
    malformed.status === 400,
    `HTTP ${malformed.status}`,
  );

  const oversized = await jsonRequest('/api/v1/auth/login', {
    email: 'nobody@example.test',
    padding: 'x'.repeat(1_100_000),
    password: 'invalid',
  });
  assert(
    'DAST-BODY-LIMIT',
    oversized.status === 413,
    `HTTP ${oversized.status}`,
  );

  for (const [code, payload] of [
    ['DAST-SQL-INJECTION', { email: "' OR 1=1--@example.test" }],
    ['DAST-XSS', { email: '<script>alert(1)</script>@example.test' }],
    [
      'DAST-PROTOTYPE-POLLUTION',
      { email: 'nobody@example.test', __proto__: { admin: true } },
    ],
    [
      'DAST-PATH-COMMAND-SSRF',
      { email: '$(id)/../../http://169.254.169.254@example.test' },
    ],
  ]) {
    const response = await jsonRequest(
      '/api/v1/auth/password-reset/request',
      payload,
    );
    assert(
      code,
      response.status < 500,
      `HTTP ${response.status}; no server execution/error`,
    );
  }

  const query = new URLSearchParams(
    Array.from({ length: 33 }, (_, index) => [`q${index}`, '1']),
  );
  const complex = await fetchWithTimeout(
    `${apiBaseUrl}/api/v1/market/overview?${query.toString()}`,
  );
  assert('DAST-QUERY-LIMIT', complex.status === 400, `HTTP ${complex.status}`);
}

async function checkBruteForceAndForwardedIpBypass() {
  let limited;
  for (let index = 0; index < 8; index += 1) {
    const response = await jsonRequest(
      '/api/v1/auth/login',
      { email: 'nobody@example.test', password: 'invalid' },
      { 'x-forwarded-for': `203.0.113.${index + 1}` },
    );
    if (response.status === 429) {
      limited = response;
      break;
    }
  }
  assert(
    'DAST-RATE-LIMIT',
    limited !== undefined,
    'brute force reached HTTP 429',
  );
  assert(
    'DAST-RATE-RETRY-AFTER',
    limited?.headers.has('retry-after') === true,
    `Retry-After=${limited?.headers.get('retry-after') ?? 'absent'}`,
  );
}

async function checkWebHeaders() {
  const response = await fetchWithTimeout(webBaseUrl);
  assert('DAST-WEB-HEALTH', response.status < 500, `HTTP ${response.status}`);
  assertHeader(
    response,
    'content-security-policy',
    'frame-ancestors',
    'DAST-WEB-CSP',
  );
  assertHeader(
    response,
    'strict-transport-security',
    'max-age=',
    'DAST-WEB-HSTS',
  );
  assertHeader(
    response,
    'x-content-type-options',
    'nosniff',
    'DAST-WEB-NOSNIFF',
  );
}

async function jsonRequest(path, body, extraHeaders = {}) {
  return fetchWithTimeout(`${apiBaseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  });
}

function assertHeader(response, name, expected, code) {
  const value = response.headers.get(name);
  assert(
    code,
    value?.includes(expected) === true,
    `${name}=${value ?? 'absent'}`,
  );
}

function assert(code, passed, evidence) {
  results.push({ code, evidence, status: passed ? 'PASS' : 'FAIL' });
}

function fetchWithTimeout(url, init) {
  return fetch(url, {
    ...init,
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  });
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
