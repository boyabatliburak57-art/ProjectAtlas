import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const errors = [];
const requiredFiles = [
  'apps/api/src/security/auth-session.service.ts',
  'apps/api/src/security/authentication.middleware.ts',
  'apps/api/src/security/abuse-prevention.middleware.ts',
  'apps/api/src/security/security-headers.ts',
  'apps/api/src/security/security.integration.database.test.ts',
  'apps/api/src/operations/operational-controls.controller.ts',
  'packages/database/src/schema/security.ts',
  'security/license-policy.json',
  'guides/SECRET_ROTATION_AND_SUPPLY_CHAIN_RESPONSE.md',
];
for (const file of requiredFiles) {
  try {
    statSync(file);
  } catch {
    errors.push(`missing required security artifact: ${file}`);
  }
}

const auth = read('apps/api/src/security/authentication.middleware.ts');
for (const token of [
  'SESSION_INVALID',
  'CSRF_VALIDATION_FAILED',
  'constantTimeTokenMatch',
  'allowedOrigins',
])
  requireText(auth, token, 'authentication middleware');

const limiter = read('apps/api/src/security/abuse-prevention.middleware.ts');
for (const limitClass of [
  'normal_read',
  'write',
  'scanner_create',
  'portfolio_recalculate',
  'import_export',
  'backtest',
  'experiment',
  'admin',
])
  requireText(limiter, limitClass, 'rate-limit policy');
for (const token of ['request.ip', 'authenticatedUserId', 'Retry-After'])
  requireText(limiter, token, 'rate-limit context');

const headers = read('apps/api/src/security/security-headers.ts');
for (const token of [
  'Content-Security-Policy',
  'Strict-Transport-Security',
  'X-Content-Type-Options',
  'Referrer-Policy',
  'Permissions-Policy',
  "frame-ancestors 'none'",
])
  requireText(headers, token, 'security headers');

const environment = read('apps/api/src/config/environment.ts');
requireText(environment, "origin === '*'", 'credential wildcard rejection');
requireText(
  environment,
  'SECURITY_RATE_LIMIT_ENABLED',
  'production rate limiter',
);

const dockerfile = read('Dockerfile');
if (!/^ARG NODE_IMAGE=.*@sha256:[a-f0-9]{64}$/mu.test(dockerfile))
  errors.push('Dockerfile base image is not digest pinned');
for (const token of ['USER node', 'NODE_OPTIONS=--disable-proto=throw'])
  requireText(dockerfile, token, 'container hardening');
for (const buildConfig of [
  'apps/api/tsconfig.build.json',
  'apps/worker/tsconfig.build.json',
])
  requireText(
    read(buildConfig),
    'src/performance/**',
    `${buildConfig} production artifact boundary`,
  );

const productionSources = sourceFiles(['apps', 'packages']).filter(
  (file) =>
    !file.includes('/performance/') &&
    !file.includes('/e2e/') &&
    !/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(file),
);
for (const file of productionSources) {
  const source = read(file);
  if (/\beval\s*\(|\bnew\s+Function\s*\(/u.test(source))
    errors.push(`arbitrary code primitive in production source: ${file}`);
  if (/from ['"]node:child_process['"]/u.test(source))
    errors.push(`command execution primitive in production source: ${file}`);
}

const ownershipEvidence = [
  [
    'saved scans',
    'packages/domain/src/scanner/saved-scans/saved-scan-application-service.test.ts',
  ],
  ['scanner runs', 'apps/api/src/scanner/scanner-runtime.integration.test.ts'],
  [
    'alerts and notifications',
    'apps/api/src/alerts/alerts-notifications.integration.test.ts',
  ],
  ['watchlists', 'apps/api/src/watchlists/watchlists.integration.test.ts'],
  [
    'portfolios and transactions',
    'apps/api/src/portfolios/portfolios.integration.test.ts',
  ],
  [
    'imports and exports',
    'apps/api/src/portfolios/portfolio-imports.integration.test.ts',
  ],
  [
    'strategies, backtests and experiments',
    'apps/api/src/backtests/backtests.integration.test.ts',
  ],
  [
    'admin, flags, incidents and releases',
    'apps/api/src/security/security.integration.database.test.ts',
  ],
];
for (const [resource, file] of ownershipEvidence) {
  const source = read(file);
  if (
    !/owner|ownership|IDOR|access denied|denies caller-asserted/iu.test(source)
  )
    errors.push(`ownership evidence missing for ${resource}: ${file}`);
}

if (errors.length > 0) {
  process.stderr.write(`${errors.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Security control validation PASS (${productionSources.length} production source files scanned; 8 ownership groups).\n`,
  );
}

function read(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function requireText(source, token, scope) {
  if (!source.includes(token)) errors.push(`${scope} is missing ${token}`);
}

function sourceFiles(roots) {
  const result = [];
  for (const root of roots) visit(root, result);
  return result;
}

function visit(path, result) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const candidate = join(path, entry.name);
    if (entry.isDirectory()) {
      if (!['dist', '.next', 'node_modules'].includes(entry.name))
        visit(candidate, result);
    } else if (/\.[cm]?[jt]sx?$/u.test(entry.name)) result.push(candidate);
  }
}
