# GO — TASK-075 Security Hardening and Abuse Prevention

Date: 2026-07-21  
Baseline commit: `f55ce25cce9b4973e4259458cee2b76ad5c02483`  
Environment: macOS arm64, Node.js 22.14.0, pnpm 9.15.4, PostgreSQL 17, Redis 7

## Executive result

**GO.** The initial gap analysis in `reports/security-gap-analysis-task-075.md` identified two High, five Medium and one Low finding. All blocking findings were remediated and verified. Final mandatory counts are:

| Gate                               | Result |
| ---------------------------------- | -----: |
| Unresolved Critical findings       |      0 |
| Unresolved High findings           |      0 |
| IDOR failures                      |      0 |
| Admin RBAC failures                |      0 |
| Secret leakages                    |      0 |
| Rate-limit bypasses                |      0 |
| CORS/CSRF failures                 |      0 |
| Security-header failures           |      0 |
| Container Critical vulnerabilities |      0 |
| Container High vulnerabilities     |      0 |
| DAST failures                      |   0/24 |

No production deployment was started. DAST used production builds under the staging configuration profile with the repository PostgreSQL and Redis test infrastructure. The scheduled/manual staging workflow is the controlled remote-staging execution point.

## Gap closure

| ID          | Initial severity | Resolution and evidence                                                                                                                                                                                                                                                                                         | Owner               | Final state |
| ----------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ----------- |
| SEC-075-001 | High             | Added durable, hashed sessions; password hashing; secure cookie/bearer resolution; rotation; replay/fixation rejection; logout revocation; disabled/locked account checks; idle/absolute expiry; five-session cap; 15-minute single-use password resets and family revocation. API DB integration passed 16/16. | Identity / API      | Closed      |
| SEC-075-002 | High             | Removed caller-controlled admin role trust. Incidents, feature flags and release records now resolve a server-side principal, require `operations_admin`, enforce recent authentication and append immutable audit events. Header-spoof/role tests pass.                                                        | Platform Security   | Closed      |
| SEC-075-003 | Medium           | Added PostgreSQL-atomic IP and authenticated-user limits for auth, normal read, write, scanner create, portfolio recalculate, import/export, backtest, experiment and admin classes. Login identity is separately HMAC-keyed. `Retry-After`, telemetry, body/query and existing domain limits are enforced.     | API Platform        | Closed      |
| SEC-075-004 | Medium           | Added API and web CSP, HSTS, nosniff, referrer, permissions and anti-framing policies. DAST header checks pass.                                                                                                                                                                                                 | Web Platform        | Closed      |
| SEC-075-005 | Medium           | Added explicit CORS allowlist validation, wildcard-with-credentials rejection, Origin verification and double-submit CSRF for cookie-authenticated mutations. Integration and DAST checks pass.                                                                                                                 | Identity / Web      | Closed      |
| SEC-075-006 | Medium           | Added DB-009 security users/sessions/reset tokens/rate buckets plus feature flag, immutable version, operational audit and release-record persistence and admin APIs.                                                                                                                                           | Platform Operations | Closed      |
| SEC-075-007 | Medium           | Added a 400-source-file static security validator, 24-check API/browser DAST runner, JSON/Markdown evidence and scheduled/manual staging workflow.                                                                                                                                                              | AppSec              | Closed      |
| SEC-075-008 | Low              | Added machine-readable license policy, license scanner, secret-rotation/supply-chain response guide, digest-pinned base image and final SBOM/image scans.                                                                                                                                                       | Supply Chain        | Closed      |

## Authentication and session controls

- Session and reset tokens are 256-bit random values; only SHA-256 token hashes are persisted.
- Passwords use versioned `scrypt` parameters and constant-time verification. Unknown-account login follows the same password verification path.
- Session issuance is serialized by user-row lock, rotates identifiers, rejects rotated-token replay, records device/IP context as keyed hashes and revokes excess concurrent sessions.
- Logout invalidates the presented session. Password reset is single-use, expires in 15 minutes, invalidates sibling reset tokens and revokes the user's session family.
- Staging/production session cookies are `Secure`, `HttpOnly`, `SameSite=Strict`; the CSRF cookie is readable only for double-submit validation.
- Disabled or locked accounts are rejected during both login and authenticated-session resolution.
- Sensitive operations require a server-issued admin role and recent authentication; caller identity/role headers are not authoritative.

## Authorization and background actor context

Deny-by-default tests reject forged identity headers for saved scans, scanner runs, alerts, watchlists, notifications, portfolios, transactions, imports/exports, strategies, backtests, experiments, incidents, feature flags and release records. Existing resource-level ownership/IDOR suites remain in place. Scanner, alert, notification, backtest and experiment queue paths propagate only bounded actor/resource identifiers and safe trace context; authoritative ownership and definitions are reloaded from PostgreSQL.

Operational mutations are environment-scoped, confirmation-gated and audited. Feature-flag version records and operational audit events are database-immutable.

## Rate limiting and input abuse

| Class                 | Initial policy | Context                          |
| --------------------- | -------------: | -------------------------------- |
| Auth                  |       5/minute | IP and normalized login identity |
| Normal read           |     300/minute | IP and authenticated user        |
| Write                 |     120/minute | IP and authenticated user        |
| Scanner create        |      10/minute | IP and authenticated user        |
| Portfolio recalculate |       5/minute | IP and authenticated user        |
| Import/export         |      10/minute | IP and authenticated user        |
| Backtest              |      10/minute | IP and authenticated user        |
| Experiment            |       5/minute | IP and authenticated user        |
| Admin                 |      30/minute | IP and authenticated user        |

The middleware also caps ordinary request bodies at 1 MiB, import bodies at 6 MiB and query keys at 32. Existing schemas enforce upload/row, pagination, universe, date-range, decimal and experiment-combination bounds. Tests verify that rotating IPs does not bypass authenticated-user or login-identity limits.

Static and dynamic checks cover SQL injection, command injection, SSRF-shaped values, path traversal, XSS, prototype-pollution keys, malformed JSON, extreme body/query shapes and CSV formula injection. No production `eval`, `new Function`, user SQL, arbitrary-code interface or user-controlled outbound URL/filesystem sink was found. Benchmark-only child-process code is excluded from API and worker production builds and verified absent from both images.

## Browser and transport security

- API CSP: `default-src 'none'`, `frame-ancestors 'none'`, `base-uri 'none'`, `form-action 'none'`, `object-src 'none'`.
- Web CSP is explicit and denies framing/object embedding. HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` and `X-Frame-Options` are present on API and web responses.
- CORS returns credentials only for configured exact origins and never combines credentials with wildcard origin.
- Cookie-authenticated unsafe methods require both an allowed Origin and matching CSRF cookie/header values.

The current Next.js bootstrap requires CSP `script-src 'unsafe-inline'` and inline styles. This is a non-blocking defense-in-depth limitation; Web Platform owns migration to nonce/hash-based CSP when the framework composition supports it. Framing, object, origin and transport protections remain enforced and tested.

## Secrets and supply chain

- Full working-tree plus 195-commit Gitleaks scan: PASS, zero leaks.
- Central logs/traces redact authorization, cookies, session/reset tokens, passwords, provider secrets, connection strings, raw uploads and sensitive notes.
- Production dependency audit: PASS, no known vulnerabilities.
- License policy: PASS, 9 allowed expressions across 173 production packages.
- Base image: Node 22.14.0 Alpine 3.21 pinned by immutable SHA-256 digest; runtime images run as UID 1000.
- API SBOM: SPDX 2.3, 216 packages.
- Worker SBOM: SPDX 2.3, 216 packages.
- Trivy 0.68.2, including unfixed findings: API Critical 0 / High 0; worker Critical 0 / High 0.
- Secret rotation and malicious-package response procedures are documented in `guides/SECRET_ROTATION_AND_SUPPLY_CHAIN_RESPONSE.md`.

Evidence artifacts:

- `reports/security/atlas-api-task-075.spdx.json`
- `reports/security/atlas-api-task-075-vulnerabilities.json`
- `reports/security/atlas-worker-task-075.spdx.json`
- `reports/security/atlas-worker-task-075-vulnerabilities.json`

## Staging-profile DAST

`pnpm dast:staging` exercised real production API and Next.js builds with PostgreSQL and Redis. All 24 checks passed:

- API/web health and security headers
- explicit CORS allow/deny and no wildcard credentials
- forged admin-role denial
- malformed JSON and request/query bounds
- SQL/XSS/prototype-pollution/path/command/SSRF-shaped payload smoke
- brute-force rejection and `Retry-After`

Detailed evidence is in `reports/security/staging-dast.json` and `reports/security/staging-dast.md`. Cookie-auth CSRF is additionally verified by the database-backed integration suite because DAST intentionally has no reusable privileged session secret.

## Verification results

| Command or gate                              | Result                                          |
| -------------------------------------------- | ----------------------------------------------- |
| `pnpm --filter @atlas/api test`              | PASS — 128/128                                  |
| `pnpm --filter @atlas/api test:database`     | PASS — 16/16                                    |
| Root unit suite                              | PASS — 582 tests                                |
| Database migration/integration suite         | PASS — 47/47                                    |
| Worker integration suite                     | PASS — 67/67                                    |
| OpenAPI validation                           | PASS — 1/1                                      |
| `pnpm security:validate`                     | PASS — 400 production files, 8 ownership groups |
| `pnpm license:check`                         | PASS — 173 production packages                  |
| `pnpm dast:staging`                          | PASS — 24/24                                    |
| `pnpm format:check`                          | PASS                                            |
| `pnpm validate:adr`                          | PASS — 25 ADR files                             |
| `pnpm lint`                                  | PASS — 8/8 packages                             |
| `pnpm typecheck`                             | PASS — 8/8 packages                             |
| `pnpm build`                                 | PASS — 8/8 packages                             |
| `pnpm --filter @atlas/database db:check`     | PASS                                            |
| `pnpm secret:scan`                           | PASS — 195 commits, zero leaks                  |
| `pnpm audit --prod --audit-level high`       | PASS — no known vulnerabilities                 |
| Skip/fixme/only scan                         | PASS — 0                                        |
| `git diff --check`                           | PASS                                            |
| API/worker image build and non-root boundary | PASS                                            |
| API/worker SBOM and Critical/High scan       | PASS — 0/0 for both images                      |

## Final findings register

| Severity      | Finding                                                             | Evidence                                                                              | Remediation                                                                                        | Owner               | Disposition            |
| ------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------- | ---------------------- |
| Critical      | None                                                                | All mandatory gates pass                                                              | None                                                                                               | AppSec              | Closed                 |
| High          | None                                                                | IDOR, admin RBAC, secret, DAST and image gates pass                                   | None                                                                                               | AppSec              | Closed                 |
| Low           | Web CSP still permits framework-required inline script/style        | DAST shows an explicit restrictive CSP with `'unsafe-inline'` limited to script/style | Move to per-request nonce/hash policy during a framework-compatible hardening iteration            | Web Platform        | Accepted, non-blocking |
| Informational | No remote staging URL or deployment credential was provided or used | DAST ran locally under the staging profile; remote workflow is scheduled/manual       | Run `.github/workflows/security-dast.yml` against an approved staging URL before release promotion | Release Engineering | Operational follow-up  |

TASK-075 acceptance is satisfied. Critical/High blockers, IDOR, admin RBAC, secret leakage, rate-limit bypass, CORS/CSRF and security-header failures are all zero.
